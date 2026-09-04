import { canonicalizeValue, type JsonValue, sha256Hex } from "../core/canonical-json.js";
import { formatRoundTripUtc } from "../core/events.js";
import { evaluateSessionCompletion } from "../core/session-completion.js";
import {
  createSessionEvent,
  type SessionEvent,
  type SessionEventPayload,
  sessionSemanticTraceHash
} from "../core/session-events.js";
import {
  applySessionEvent,
  countConsecutiveTurnSignature,
  emptySessionProjection,
  type LoopStopReason,
  type SessionLimits,
  type SessionProjection,
  sessionProjectionHash
} from "../core/sessions.js";
import { createTrustEnvelope, type TrustEnvelope } from "../core/trust.js";
import { assembleModelContext, type ModelContextMessage } from "./context-assembler.js";
import type { AtomicModelProvider, ModelToolCall, ModelTurn } from "./model-provider.js";
import {
  completeValidatedTurn,
  createModelTurnRequest,
  ModelProviderError
} from "./model-provider.js";
import type {
  Clock,
  InstructionSelection,
  RuntimeContractValidator,
  SessionDescriptor,
  SessionEventSink,
  SessionVerificationArtifact,
  SessionVerificationService,
  SessionWorkspaceOps
} from "./session-contracts.js";
import { SessionEvaluator } from "./session-evaluator.js";
import type { CancellationSignal, ToolDispatcher } from "./tool-dispatcher.js";

export interface InstructionSelectorPort {
  select(workspaceRoot: string, targetRelativePath: string): Promise<InstructionSelection>;
}

export interface AgentLoopDependencies {
  readonly toolDispatcher: ToolDispatcher;
  readonly provider: AtomicModelProvider;
  readonly verificationService: SessionVerificationService;
  readonly evaluator?: SessionEvaluator;
  readonly contractValidator: RuntimeContractValidator;
  readonly instructionSelector: InstructionSelectorPort;
  readonly workspaceOps: SessionWorkspaceOps;
  readonly clock: Clock;
  readonly eventSink: SessionEventSink;
}

export interface AgentLoopRequest {
  readonly descriptor: SessionDescriptor;
  readonly workContractContent: string;
  readonly evaluatorRubricContent: string;
  readonly distributionInstructionContent: string;
}

export interface AgentLoopResult {
  readonly events: readonly SessionEvent[];
  readonly projection: SessionProjection;
  readonly semanticTraceHash: string;
}

const EVIDENCE_MAXIMUM_AGE_MS = 30 * 60_000;
const CONTEXT_LIMITS = { maxParts: 1_000, maxTotalBytes: 1_048_576 } as const;
const MAXIMUM_ENVELOPE_BYTES = 65_536;

/**
 * Application-owned bounded multi-turn agent loop (SPEC-004 section 4). Owns every provider
 * call and tool dispatch; the provider and tools never invoke each other directly. Terminates
 * on the first satisfied condition from the fixed six-reason vocabulary in `sessions.ts`.
 */
export class AgentLoop {
  private readonly evaluator: SessionEvaluator;

  public constructor(private readonly deps: AgentLoopDependencies) {
    this.evaluator = deps.evaluator ?? new SessionEvaluator();
  }

  public async run(
    request: AgentLoopRequest,
    cancellation: CancellationSignal
  ): Promise<AgentLoopResult> {
    const { descriptor } = request;
    const events: SessionEvent[] = [];
    let projection = emptySessionProjection(descriptor.sessionId);

    const append = async (
      eventType: SessionEvent["eventType"],
      payload: SessionEventPayload
    ): Promise<SessionEvent> => {
      const event = createSessionEvent(
        descriptor.sessionId,
        projection.lastSequence + 1,
        {
          eventType,
          occurredAt: formatRoundTripUtc(this.deps.clock.now()),
          payload
        },
        projection.eventChainHead
      );
      // Validate before persisting: `applySessionEvent` is pure and throws on any invariant
      // violation, so computing the next projection first guarantees a rejected event is never
      // written to the durable JSONL log. Only a projection the reducer actually accepted is
      // ever appended to `eventSink`.
      const next = applySessionEvent(projection, event);
      await this.deps.eventSink.append(event);
      events.push(event);
      projection = next;
      return event;
    };
    const stop = async (reason: LoopStopReason, blockReason: string): Promise<void> => {
      await append("loop.stopped", {
        reason,
        turnsUsed: projection.turnsUsed,
        toolDispatchesUsed: projection.toolDispatchesUsed
      });
      if (reason === "cancelled") {
        await append("session.cancelled", { reason: blockReason });
      } else if (reason !== "provider_completed") {
        await append("session.blocked", { reason: blockReason });
      }
    };

    await append("session.created", {
      taskId: descriptor.taskId,
      descriptorHash: sha256Hex(canonicalizeValue(sessionDescriptorPayload(descriptor))),
      parentSessionId: descriptor.parentSessionId,
      sourceFixtureHash: descriptor.sourceFixtureHash,
      policyVersion: descriptor.policyVersion,
      policyHash: descriptor.policyHash,
      workContractHash: descriptor.workContractHash,
      limits: descriptor.limits as unknown as SessionEventPayload,
      assets: descriptor.assets as unknown as SessionEventPayload
    });

    const instruction = await this.deps.instructionSelector.select(
      descriptor.workspaceRoot,
      descriptor.targetRelativePath
    );
    const conversation: TrustEnvelope[] = [
      createTrustEnvelope({
        origin: "distribution_instruction",
        sourceReference: "package:prompt",
        content: request.distributionInstructionContent,
        maximumBytes: MAXIMUM_ENVELOPE_BYTES
      }),
      createTrustEnvelope({
        origin: "operator_task",
        sourceReference: "operator:objective",
        content: descriptor.objective,
        maximumBytes: MAXIMUM_ENVELOPE_BYTES
      })
    ];
    if (instruction.relativePath !== null) {
      conversation.push(
        createTrustEnvelope({
          origin: "workspace_instruction",
          sourceReference: instruction.relativePath,
          content: instruction.content,
          maximumBytes: MAXIMUM_ENVELOPE_BYTES
        })
      );
    }

    let stopped = false;
    let lastVerificationArtifact: SessionVerificationArtifact | undefined;
    while (!stopped) {
      const preTurn = this.preTurnStopReason(
        projection,
        descriptor.limits,
        descriptor.createdAt,
        cancellation
      );
      if (preTurn !== null) {
        await stop(preTurn, blockingMessageFor(preTurn));
        stopped = true;
        break;
      }

      const turnNumber = projection.turnsUsed + 1;
      const workspaceHashBeforeTurn = await this.deps.workspaceOps.computeHash(
        descriptor.workspaceRoot
      );
      const turnRequest = createModelTurnRequest({
        sessionId: descriptor.sessionId,
        turnNumber,
        messages: assembleModelContext(conversation, CONTEXT_LIMITS).messages,
        tools: this.deps.toolDispatcher.list(),
        maxOutputTokens: descriptor.limits.maxOutputTokensPerTurn
      });
      await append("turn.requested", { turnNumber, requestHash: turnRequest.requestHash });

      let turn: ModelTurn;
      try {
        turn = await completeValidatedTurn(this.deps.provider, turnRequest, cancellation);
      } catch (error) {
        const code = error instanceof ModelProviderError ? error.code : "UNKNOWN";
        if (code === "CANCELLED") {
          await stop("cancelled", "ProviderCancelled");
        } else {
          await append("session.failed", { reason: `ProviderError:${code}` });
        }
        stopped = true;
        break;
      }

      const actionSignature = computeActionSignature(turn.toolCalls, workspaceHashBeforeTurn);
      await append("turn.completed", {
        turnNumber,
        requestHash: turnRequest.requestHash,
        responseHash: turn.responseHash,
        actionSignature,
        finishReason: turn.finishReason,
        toolCallCount: turn.toolCalls.length,
        inputTokens: turn.usage.inputTokens,
        outputTokens: turn.usage.outputTokens,
        cachedTokens: turn.usage.cachedTokens,
        reasoningTokens: turn.usage.reasoningTokens,
        costMode: turn.usage.costMode,
        costMinorUnits: turn.usage.costMinorUnits
      });
      conversation.push(
        createTrustEnvelope({
          origin: "model_output",
          sourceReference: turn.turnId,
          content: turn.assistantText,
          maximumBytes: MAXIMUM_ENVELOPE_BYTES
        })
      );

      if (turn.finishReason === "error" || turn.finishReason === "content_filter") {
        await append("session.failed", { reason: `ProviderFinishReason:${turn.finishReason}` });
        stopped = true;
        break;
      }

      if (
        turn.toolCalls.length > 0 &&
        countConsecutiveTurnSignature(events, actionSignature) >=
          descriptor.limits.repeatedSignatureThreshold
      ) {
        await stop("oscillation_detected", "RepeatedActionSignature");
        stopped = true;
        break;
      }

      const mutationsBeforeTurn = projection.workspaceMutations;
      let dispatchHalted = false;
      for (const [callIndex, call] of turn.toolCalls.entries()) {
        if (projection.toolDispatchesUsed >= descriptor.limits.maxToolDispatches) {
          await stop("decision_budget_exhausted", "ToolDispatchBudgetExceeded");
          dispatchHalted = true;
          stopped = true;
          break;
        }
        const callId = `t${turnNumber}-c${callIndex}`;
        const workspaceHashBefore = await this.deps.workspaceOps.computeHash(
          descriptor.workspaceRoot
        );
        await append("tool.call_dispatched", {
          turnNumber,
          callIndex,
          callId: call.callId,
          toolId: call.toolId,
          idempotencyKey: callId,
          workspaceHashBefore
        });
        const dispatched = await this.deps.toolDispatcher.dispatch(
          {
            workspaceRoot: descriptor.workspaceRoot,
            stateRoot: descriptor.stateRoot,
            cancellation
          },
          { toolId: call.toolId, idempotencyKey: callId, arguments: call.arguments }
        );
        const workspaceHashAfter = dispatched.mutation?.workspaceHash ?? workspaceHashBefore;
        const outcome = dispatched.isSuccess
          ? "succeeded"
          : dispatched.error?.code === "CANCELLED"
            ? "cancelled"
            : "failed";
        await append("tool.call_completed", {
          turnNumber,
          callIndex,
          callId: call.callId,
          idempotencyKey: callId,
          outcome,
          errorCode: dispatched.error?.code ?? null,
          beforeFileHash: dispatched.mutation?.beforeFileHash ?? null,
          afterFileHash: dispatched.mutation?.afterFileHash ?? null,
          outputHash: dispatched.outputHash,
          workspaceHashAfter
        });
        conversation.push(
          dispatched.output ??
            createTrustEnvelope({
              origin: "tool_result",
              sourceReference: call.toolId,
              content: canonicalizeValue({
                error: dispatched.error?.code ?? "TOOL_FAILED",
                message: dispatched.message
              }),
              maximumBytes: MAXIMUM_ENVELOPE_BYTES
            })
        );
        if (!dispatched.isSuccess) {
          if (outcome === "cancelled") {
            await stop("cancelled", "ToolDispatchCancelled");
          } else {
            await append("session.blocked", { reason: dispatched.error?.code ?? "ToolFailed" });
          }
          dispatchHalted = true;
          stopped = true;
          break;
        }
      }
      if (dispatchHalted) break;

      if (turn.toolCalls.length > 0 && projection.workspaceMutations > mutationsBeforeTurn) {
        const oscillating = hasRepeatedFingerprint(projection.fingerprintHistory);
        if (oscillating) {
          await stop("oscillation_detected", "WorkspaceStateOscillation");
          stopped = true;
          break;
        }
        const verificationArtifact = await this.recordVerification(
          descriptor,
          instruction,
          projection,
          turnNumber,
          append
        );
        lastVerificationArtifact = verificationArtifact;
        if (
          verificationArtifact.summary.passedChecks !==
            verificationArtifact.summary.discoveredChecks &&
          projection.consecutiveFailedFixes >= descriptor.limits.maxConsecutiveFailedFixes
        ) {
          await stop("failed_fix_exhausted", "InvestigationRequired");
          stopped = true;
          break;
        }
      }

      if (turn.finishReason === "completed" && turn.toolCalls.length === 0) {
        await append("loop.stopped", {
          reason: "provider_completed",
          turnsUsed: projection.turnsUsed,
          toolDispatchesUsed: projection.toolDispatchesUsed
        });
        stopped = true;
        break;
      }
    }

    if (projection.status === "evaluating") {
      if (!projection.verificationRecorded) {
        const instruction = await this.deps.instructionSelector.select(
          descriptor.workspaceRoot,
          descriptor.targetRelativePath
        );
        lastVerificationArtifact = await this.recordVerification(
          descriptor,
          instruction,
          projection,
          projection.currentTurnNumber,
          append
        );
      }
      if (lastVerificationArtifact === undefined) {
        throw new Error("Evaluating session has no verification artifact bound.");
      }
      await this.finalize(request, projection, lastVerificationArtifact, append);
    }

    return {
      events,
      projection,
      semanticTraceHash: sessionSemanticTraceHash(events)
    };
  }

  private preTurnStopReason(
    projection: SessionProjection,
    limits: SessionLimits,
    createdAt: string,
    cancellation: CancellationSignal
  ): LoopStopReason | null {
    if (cancellation.isCancellationRequested) return "cancelled";
    if (projection.turnsUsed >= limits.maxTurns) return "decision_budget_exhausted";
    if (this.deps.clock.now().getTime() - Date.parse(createdAt) >= limits.maxElapsedMilliseconds) {
      return "wall_clock_exhausted";
    }
    return null;
  }

  private async recordVerification(
    descriptor: SessionDescriptor,
    instruction: InstructionSelection,
    projection: SessionProjection,
    turnNumber: number,
    append: (
      eventType: SessionEvent["eventType"],
      payload: SessionEventPayload
    ) => Promise<SessionEvent>
  ): Promise<SessionVerificationArtifact> {
    const artifact = await this.deps.verificationService.verify({
      descriptor,
      instruction,
      eventChainHead: projection.eventChainHead,
      turnNumber,
      attemptNumber: projection.verificationAttempts + 1
    });
    await append("verification.recorded", {
      turnNumber,
      attemptNumber: projection.verificationAttempts + 1,
      evidenceId: artifact.summary.evidenceId,
      resultHash: artifact.resultHash,
      artifactHash: hashArtifact(artifact),
      workspaceHash: artifact.summary.workspaceHash,
      discoveredChecks: artifact.summary.discoveredChecks,
      passedChecks: artifact.summary.passedChecks
    });
    return artifact;
  }

  /**
   * Runs the final read-only evaluation and completion gate. The caller guarantees
   * `verificationRecorded` is true and `carriedVerification` is the exact artifact bound to that
   * recorded `verification.recorded` event, so evaluation never re-verifies with a new attempt
   * number and hash for a workspace state that has not changed.
   */
  private async finalize(
    request: AgentLoopRequest,
    projection: SessionProjection,
    carriedVerification: SessionVerificationArtifact,
    append: (
      eventType: SessionEvent["eventType"],
      payload: SessionEventPayload
    ) => Promise<SessionEvent>
  ): Promise<void> {
    const { descriptor } = request;
    const verificationArtifact = carriedVerification;
    const workspaceHash = await this.deps.workspaceOps.computeHash(descriptor.workspaceRoot);
    const contract = await this.deps.contractValidator.parseWorkContract(
      request.workContractContent
    );
    const rubric = await this.deps.contractValidator.parseEvaluatorRubric(
      request.evaluatorRubricContent
    );
    const evaluatedAt = formatRoundTripUtc(this.deps.clock.now());
    const evaluation = this.evaluator.evaluate(
      descriptor,
      contract,
      rubric,
      projection,
      verificationArtifact,
      workspaceHash,
      descriptor.workContractHash,
      sha256Hex(request.workContractContent),
      descriptor.assets.evaluatorRubricHash,
      sha256Hex(request.evaluatorRubricContent),
      evaluatedAt
    );
    const evaluationArtifactHash = hashArtifact(evaluation);
    const evaluationEvent = await append("evaluation.recorded", {
      evaluationId: evaluation.summary.evaluationId,
      verdict: evaluation.summary.verdict,
      artifactHash: evaluationArtifactHash,
      projectionHash: evaluation.summary.projectionHash,
      workspaceHash: evaluation.summary.workspaceHash,
      eventChainHead: evaluation.summary.eventChainHead,
      evidenceHashes: [verificationArtifact.resultHash]
    });
    const completion = evaluateSessionCompletion(
      projection,
      verificationArtifact.summary,
      evaluation.summary,
      workspaceHash,
      sessionProjectionHash(projection),
      this.deps.clock.now(),
      EVIDENCE_MAXIMUM_AGE_MS
    );
    if (completion.isAllowed) {
      await append("session.completed", {
        projectionHash: sessionProjectionHash(projection),
        workspaceHash: evaluation.summary.workspaceHash,
        evaluationId: evaluation.summary.evaluationId,
        evaluationEventHash: evaluationEvent.eventHash,
        evaluationArtifactHash,
        verificationResultHash: verificationArtifact.resultHash
      });
    } else {
      await append("session.blocked", { reason: `EvaluationRejected:${completion.reasons[0]}` });
    }
  }
}

function sessionDescriptorPayload(descriptor: SessionDescriptor): JsonValue {
  return {
    schemaVersion: descriptor.schemaVersion,
    sessionId: descriptor.sessionId,
    parentSessionId: descriptor.parentSessionId,
    taskId: descriptor.taskId,
    objective: descriptor.objective,
    targetRelativePath: descriptor.targetRelativePath,
    sourceFixtureHash: descriptor.sourceFixtureHash,
    workContractHash: descriptor.workContractHash,
    limits: { ...descriptor.limits },
    assets: { ...descriptor.assets, skillHashes: [...descriptor.assets.skillHashes] }
  };
}

function computeActionSignature(
  toolCalls: readonly ModelToolCall[],
  workspaceHashBeforeTurn: string
): string {
  return sha256Hex(
    canonicalizeValue({
      toolCalls: toolCalls.map((call) => ({
        toolId: call.toolId,
        argumentsHash: sha256Hex(canonicalizeValue(call.arguments))
      })),
      workspaceHashBeforeTurn
    })
  );
}

function hasRepeatedFingerprint(history: readonly string[]): boolean {
  return new Set(history).size !== history.length;
}

/** Hashes an evidence artifact for event binding, converting `Date` fields to UTC strings first. */
function hashArtifact(value: unknown): string {
  return sha256Hex(canonicalizeValue(toPlain(value) as JsonValue));
}

function toPlain(value: unknown): unknown {
  if (value instanceof Date) return formatRoundTripUtc(value);
  if (Array.isArray(value)) return value.map(toPlain);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toPlain(item)]));
  }
  return value;
}

function blockingMessageFor(reason: LoopStopReason): string {
  switch (reason) {
    case "decision_budget_exhausted":
      return "TurnBudgetExceeded";
    case "wall_clock_exhausted":
      return "ElapsedTimeLimitExceeded";
    case "cancelled":
      return "CancelledByOperator";
    default:
      return "LoopStopped";
  }
}

export type { ModelContextMessage };
