import { dirname, join, resolve } from "node:path";
import { canonicalizeValue, type JsonValue, sha256Hex } from "../core/canonical-json.js";
import { evaluateCompletion } from "../core/completion.js";
import {
  type EventPayload,
  formatRoundTripUtc,
  type RunEvent,
  semanticTraceHash
} from "../core/events.js";
import {
  canDispatchTool,
  canRequestDecision,
  evaluatePolicy,
  type PolicyDefinition,
  validateRunLimits
} from "../core/policy.js";
import {
  applyRunEvent,
  projectionHash,
  type RunProjection,
  type RunStatus,
  replayRun
} from "../core/runs.js";
import {
  type ActivatedSkill,
  type Clock,
  type EvaluationArtifact,
  type HandoffPacket,
  HarnessError,
  HarnessExitCode,
  type IdGenerator,
  type InstructionSelection,
  type InstructionSelector,
  type PolicySource,
  type ProviderCapabilities,
  type ProviderDecision,
  type ProviderResolver,
  type ReplayResult,
  type RunAssetVersions,
  type RunDescriptor,
  type RunObserver,
  type RunResult,
  type RunStore,
  type RuntimeAssetBundle,
  type RuntimeContractValidator,
  type SkillCatalog,
  type SkillDescriptor,
  type SubmitRunRequest,
  type ToolResult,
  type VerificationArtifact,
  type VerificationService,
  type WorkspaceManager
} from "./contracts.js";
import { computeRunDescriptorHash } from "./descriptor.js";
import type { ReadOnlyEvaluator } from "./evaluator.js";
import { isSupportedContract, isSupportedRubric } from "./evaluator.js";
import type { SecretRedactor } from "./redactor.js";
import type { ToolDispatcher, ToolDispatchResult } from "./tool-dispatcher.js";

interface HarnessDependencies {
  readonly runStore: RunStore;
  readonly workspaceManager: WorkspaceManager;
  readonly instructionSelector: InstructionSelector;
  readonly skillCatalog: SkillCatalog;
  readonly providers: ProviderResolver;
  readonly toolDispatcher: ToolDispatcher;
  readonly policySource: PolicySource;
  readonly contractValidator: RuntimeContractValidator;
  readonly verificationService: VerificationService;
  readonly evaluator: ReadOnlyEvaluator;
  readonly runtimeAssets: RuntimeAssetBundle;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly observer: RunObserver;
  readonly redactor: SecretRedactor;
}

const TERMINAL = new Set<RunStatus>(["completed", "blocked", "failed", "cancelled"]);
const EVIDENCE_MAXIMUM_AGE_MS = 30 * 60_000;

export class HarnessService {
  public constructor(private readonly dependencies: HarnessDependencies) {}

  public async submit(request: SubmitRunRequest): Promise<RunResult> {
    return this.createAndExecute(request, null);
  }

  public async resume(runRoot: string): Promise<RunResult> {
    const descriptor = await this.dependencies.runStore.load(runRoot);
    const policy = await this.dependencies.policySource.load();
    if (
      policy.version !== descriptor.policyVersion ||
      policy.contentHash !== descriptor.policyHash
    ) {
      throw new HarnessError(
        HarnessExitCode.Blocked,
        "The effective policy differs from the run's pinned policy."
      );
    }
    return this.execute(descriptor, policy);
  }

  public async retry(runRoot: string): Promise<RunResult> {
    const current = await this.inspect(runRoot);
    return ["blocked", "failed", "cancelled"].includes(current.projection.status)
      ? this.fork(runRoot)
      : this.resume(runRoot);
  }

  public async fork(runRoot: string): Promise<RunResult> {
    const source = await this.dependencies.runStore.load(runRoot);
    const intent = await this.dependencies.workspaceManager.loadReplacementIntent(source);
    const workContractContent = await this.dependencies.runStore.loadAsset(
      source,
      "work-contract.json"
    );
    const evaluatorRubricContent = await this.dependencies.runStore.loadAsset(
      source,
      "evaluator-rubric.json"
    );
    return this.createAndExecute(
      {
        taskId: source.taskId,
        objective: source.objective,
        sourceFixturePath: source.sourceFixturePath,
        runsRoot: dirname(source.runRoot),
        targetRelativePath: source.targetRelativePath,
        expectedText: intent.expectedText,
        replacementText: intent.replacementText,
        providerId: source.providerId,
        workContractHash: source.workContractHash,
        workContractContent,
        evaluatorRubricContent,
        interruptionPoint: "none",
        limits: source.limits,
        assets: source.assets
      },
      source.runId
    );
  }

  public async pause(runRoot: string): Promise<RunResult> {
    const descriptor = await this.dependencies.runStore.load(runRoot);
    let events = await this.dependencies.runStore.readEvents(descriptor);
    let projection = replayRun(descriptor.runId, events);
    if (TERMINAL.has(projection.status)) {
      return resultFor(exitCodeFor(projection), descriptor, projection, events, [
        "Run is already terminal."
      ]);
    }
    ({ projection, events } = await this.append(descriptor, projection, events, "run.interrupted", {
      point: "operator_pause",
      reason: "PausedByOperator"
    }));
    return resultFor(HarnessExitCode.InterruptedFixture, descriptor, projection, events, [
      "Run paused."
    ]);
  }

  public async cancel(runRoot: string): Promise<RunResult> {
    const descriptor = await this.dependencies.runStore.load(runRoot);
    let events = await this.dependencies.runStore.readEvents(descriptor);
    let projection = replayRun(descriptor.runId, events);
    if (TERMINAL.has(projection.status)) {
      return resultFor(exitCodeFor(projection), descriptor, projection, events, [
        "Run is already terminal."
      ]);
    }
    ({ projection, events } = await this.append(descriptor, projection, events, "run.cancelled", {
      reason: "CancelledByOperator"
    }));
    return resultFor(HarnessExitCode.Cancelled, descriptor, projection, events, ["Run cancelled."]);
  }

  public async inspect(runRoot: string): Promise<RunResult> {
    const descriptor = await this.dependencies.runStore.load(runRoot);
    await this.validateRuntimeAssets(descriptor);
    const events = await this.dependencies.runStore.readEvents(descriptor);
    const projection = replayRun(descriptor.runId, events);
    return resultFor(HarnessExitCode.Completed, descriptor, projection, events, []);
  }

  public async replay(runRoot: string): Promise<ReplayResult> {
    const descriptor = await this.dependencies.runStore.load(runRoot);
    await this.validateRuntimeAssets(descriptor);
    const events = await this.dependencies.runStore.readEvents(descriptor);
    const projection = replayRun(descriptor.runId, events);
    return {
      projection,
      projectionHash: projectionHash(projection),
      semanticTraceHash: semanticTraceHash(events),
      eventCount: events.length
    };
  }

  public async stream(runRoot: string, afterSequence: number): Promise<readonly RunEvent[]> {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new RangeError("afterSequence must be a non-negative safe integer.");
    }
    const descriptor = await this.dependencies.runStore.load(runRoot);
    return (await this.dependencies.runStore.readEvents(descriptor)).filter(
      (event) => event.sequence > afterSequence
    );
  }

  public inspectInstructions(workspaceRoot: string, target: string): Promise<InstructionSelection> {
    return this.dependencies.instructionSelector.select(workspaceRoot, target);
  }

  public inspectSkills(skillsRoot: string): Promise<readonly SkillDescriptor[]> {
    return this.dependencies.skillCatalog.inspect(skillsRoot);
  }

  public activateSkill(skillsRoot: string, name: string): Promise<ActivatedSkill> {
    return this.dependencies.skillCatalog.activate(skillsRoot, name);
  }

  public async archive(runRoot: string, destinationPath: string): Promise<void> {
    const descriptor = await this.dependencies.runStore.load(runRoot);
    await this.dependencies.runStore.archive(descriptor, destinationPath);
  }

  public async createHandoff(runRoot: string): Promise<HandoffPacket> {
    const descriptor = await this.dependencies.runStore.load(runRoot);
    const events = await this.dependencies.runStore.readEvents(descriptor);
    const projection = replayRun(descriptor.runId, events);
    const workspaceHash = await this.dependencies.workspaceManager.computeHash(
      descriptor.workspaceRoot
    );
    let activeFindings: string[] = [];
    if (hasEvent(events, "evaluation.recorded")) {
      const evaluation = await this.dependencies.runStore.loadEvaluation(descriptor);
      activeFindings = evaluation.summary.findings.map(
        (finding) => `${finding.severity}:${finding.findingId}`
      );
    }
    const elapsed = Math.max(
      0,
      this.dependencies.clock.now().getTime() - Date.parse(descriptor.createdAt)
    );
    const result =
      projection.status === "blocked"
        ? "blocked"
        : projection.status === "failed"
          ? "failed"
          : projection.status === "cancelled"
            ? "cancelled"
            : "passed";
    return {
      schemaVersion: "1.0",
      handoffId: `handoff-${descriptor.runId}`,
      taskId: descriptor.taskId,
      runId: descriptor.runId,
      objective: descriptor.objective,
      contractReference: `sha256:${descriptor.workContractHash}`,
      completedWork: [...new Set(events.map((event) => event.eventType))],
      workspace: {
        repository: null,
        branch: null,
        commit: null,
        sourceFixtureHash: descriptor.sourceFixtureHash,
        workspaceHash,
        runRoot: descriptor.runRoot
      },
      changedFiles: projection.workspaceMutations > 0 ? [descriptor.targetRelativePath] : [],
      commands: [{ action: "hve run/resume", result, evidenceReference: "state/events.jsonl" }],
      activeFindings,
      assumptions: [
        "Local-only fail-closed mode",
        "No process, network, browser, secret, or remote-write capability",
        "Repository content is untrusted data"
      ],
      budget: {
        remainingDecisions: Math.max(0, descriptor.limits.maxDecisions - projection.decisionsUsed),
        remainingToolDispatches: Math.max(
          0,
          descriptor.limits.maxToolDispatches - projection.toolDispatchesUsed
        ),
        remainingInputTokens: Math.max(
          0,
          descriptor.limits.maxInputTokens - sumUsage(events, "inputTokens")
        ),
        remainingOutputTokens: Math.max(
          0,
          descriptor.limits.maxOutputTokens - sumUsage(events, "outputTokens")
        ),
        remainingCostMinorUnits: Math.max(
          0,
          descriptor.limits.maxCostMinorUnits - sumUsage(events, "costMinorUnits")
        ),
        remainingSeconds: Math.floor(
          Math.max(0, descriptor.limits.maxElapsedMilliseconds - elapsed) / 1_000
        )
      },
      nextAction: TERMINAL.has(projection.status)
        ? "Inspect, archive, or fork the terminal run."
        : "Resume the run from its durable event head.",
      artifactReferences: [
        "state/events.jsonl",
        "state/projection.json",
        "state/checkpoint.json",
        "state/evidence/verification-final.json",
        "state/evaluations/evaluation-final.json"
      ],
      sourceEventHead: projection.eventChainHead,
      createdAt: formatRoundTripUtc(this.dependencies.clock.now())
    };
  }

  public async resumeFromHandoff(handoff: HandoffPacket): Promise<RunResult> {
    if (handoff.schemaVersion !== "1.0") {
      throw new HarnessError(HarnessExitCode.ReplayIntegrityFailure, "Unsupported handoff schema.");
    }
    const descriptor = await this.dependencies.runStore.load(handoff.workspace.runRoot);
    const events = await this.dependencies.runStore.readEvents(descriptor);
    const projection = replayRun(descriptor.runId, events);
    const workspaceHash = await this.dependencies.workspaceManager.computeHash(
      descriptor.workspaceRoot
    );
    if (
      handoff.runId !== descriptor.runId ||
      handoff.taskId !== descriptor.taskId ||
      handoff.sourceEventHead !== projection.eventChainHead ||
      handoff.workspace.sourceFixtureHash !== descriptor.sourceFixtureHash ||
      handoff.workspace.workspaceHash !== workspaceHash
    ) {
      throw new HarnessError(
        HarnessExitCode.ReplayIntegrityFailure,
        "Handoff packet no longer matches the durable run state."
      );
    }
    return this.resume(descriptor.runRoot);
  }

  private async createAndExecute(
    request: SubmitRunRequest,
    parentRunId: string | null
  ): Promise<RunResult> {
    await this.validateSubmitRequest(request);
    const limits = validateRunLimits(request.limits);
    const policy = await this.dependencies.policySource.load();
    const provider = this.dependencies.providers.getRequired(request.providerId);
    const runId = this.dependencies.idGenerator.newRunId();
    const runRoot = join(resolve(request.runsRoot), runId);
    const sourceHashBefore = await this.dependencies.workspaceManager.computeHash(
      request.sourceFixturePath
    );
    const prepared = await this.dependencies.workspaceManager.prepare(
      request.sourceFixturePath,
      runRoot
    );
    const argumentsHash = computeArgumentsHash({
      relativePath: request.targetRelativePath,
      expectedText: request.expectedText,
      replacementText: request.replacementText
    });
    await this.dependencies.workspaceManager.saveReplacementIntent(
      runRoot,
      prepared.workspaceRoot,
      runId,
      {
        relativePath: request.targetRelativePath,
        expectedText: request.expectedText,
        replacementText: request.replacementText,
        argumentsHash
      }
    );
    const capabilities = provider.capabilities;
    const descriptor: RunDescriptor = {
      schemaVersion: "1.0",
      runId,
      parentRunId,
      taskId: request.taskId,
      objective: request.objective,
      runRoot,
      workspaceRoot: prepared.workspaceRoot,
      stateRoot: join(runRoot, "state"),
      sourceFixturePath: prepared.sourceRoot,
      sourceFixtureHash: prepared.sourceFixtureHash,
      targetRelativePath: request.targetRelativePath,
      expectedTextHash: sha256Hex(request.expectedText),
      replacementTextHash: sha256Hex(request.replacementText),
      providerId: request.providerId,
      providerAdapterVersion: capabilities.adapterVersion,
      providerRequestedModel: capabilities.requestedModel,
      providerServedModel: capabilities.servedModel,
      providerDiscoveredAt: capabilities.discoveredAt,
      providerContextWindowTokens: capabilities.contextWindowTokens,
      providerMaxOutputTokens: capabilities.maxOutputTokens,
      providerCapabilitiesHash: capabilities.contentHash,
      workContractHash: request.workContractHash,
      policyVersion: policy.version,
      policyHash: policy.contentHash,
      interruptionPoint: request.interruptionPoint,
      limits,
      assets: this.dependencies.runtimeAssets.versions,
      createdAt: formatRoundTripUtc(this.dependencies.clock.now())
    };
    await this.dependencies.runStore.saveAsset(
      descriptor,
      "work-contract.json",
      request.workContractContent
    );
    await this.dependencies.runStore.saveAsset(
      descriptor,
      "evaluator-rubric.json",
      request.evaluatorRubricContent
    );
    await this.dependencies.runStore.saveAsset(
      descriptor,
      "prompt.md",
      this.dependencies.runtimeAssets.promptContent
    );
    for (const [index, content] of this.dependencies.runtimeAssets.skillContents.entries()) {
      await this.dependencies.runStore.saveAsset(descriptor, `skill-${index}.md`, content);
    }
    await this.dependencies.runStore.create(descriptor);
    const result = await this.execute(descriptor, policy);
    await this.dependencies.workspaceManager.assertUnchanged(
      request.sourceFixturePath,
      sourceHashBefore
    );
    return result;
  }

  private async execute(descriptor: RunDescriptor, policy: PolicyDefinition): Promise<RunResult> {
    await this.validateRuntimeAssets(descriptor);
    const messages: string[] = [];
    let events = await this.dependencies.runStore.readEvents(descriptor);
    let projection = replayRun(descriptor.runId, events);
    const intent = await this.dependencies.workspaceManager.loadReplacementIntent(descriptor);
    if (TERMINAL.has(projection.status) && events.length > 0) {
      return resultFor(exitCodeFor(projection), descriptor, projection, events, [
        "Run is already terminal."
      ]);
    }
    if (events.length > 0 && this.elapsedExceeded(descriptor)) {
      return this.block(
        HarnessExitCode.LimitExceeded,
        descriptor,
        projection,
        events,
        "ElapsedTimeLimitExceeded"
      );
    }
    if (!hasEvent(events, "run.created")) {
      ({ projection, events } = await this.append(descriptor, projection, events, "run.created", {
        taskId: descriptor.taskId,
        descriptorHash: computeRunDescriptorHash(descriptor),
        parentRunId: descriptor.parentRunId,
        sourceFixtureHash: descriptor.sourceFixtureHash,
        policyVersion: descriptor.policyVersion,
        policyHash: descriptor.policyHash,
        workContractHash: descriptor.workContractHash,
        maxDecisions: descriptor.limits.maxDecisions,
        maxToolDispatches: descriptor.limits.maxToolDispatches,
        assets: assetsPayload(descriptor)
      }));
    }
    ({ projection, events } = await this.transition(
      descriptor,
      projection,
      events,
      "queued",
      "preparing",
      "Prepare isolated workspace"
    ));
    ({ projection, events } = await this.transition(
      descriptor,
      projection,
      events,
      "preparing",
      "researching",
      "Discover scoped instructions"
    ));
    const instruction = await this.dependencies.instructionSelector.select(
      descriptor.workspaceRoot,
      descriptor.targetRelativePath
    );
    const existingInstruction = lastEvent(events, "instruction.selected");
    if (existingInstruction === undefined) {
      ({ projection, events } = await this.append(
        descriptor,
        projection,
        events,
        "instruction.selected",
        {
          relativePath: instruction.relativePath,
          contentHash: instruction.contentHash,
          byteLength: instruction.byteLength
        }
      ));
    } else if (existingInstruction.payload["contentHash"] !== instruction.contentHash) {
      throw new HarnessError(
        HarnessExitCode.ReplayIntegrityFailure,
        "Scoped instructions changed after the run started."
      );
    }
    ({ projection, events } = await this.transition(
      descriptor,
      projection,
      events,
      "researching",
      "planning",
      "Request a bounded fixture decision"
    ));

    const provider = this.dependencies.providers.getRequired(descriptor.providerId);
    const capabilities = provider.capabilities;
    if (!capabilitiesMatch(descriptor, capabilities)) {
      return this.block(
        HarnessExitCode.LimitExceeded,
        descriptor,
        projection,
        events,
        "ProviderCapabilityLimitExceeded"
      );
    }
    let decision: ProviderDecision;
    const decisionEvent = lastEvent(events, "provider.decision_recorded");
    if (decisionEvent === undefined) {
      if (!canRequestDecision(projection, descriptor.limits)) {
        return this.block(
          HarnessExitCode.LimitExceeded,
          descriptor,
          projection,
          events,
          "DecisionLimitExceeded"
        );
      }
      decision = await provider.decide({
        taskId: descriptor.taskId,
        objective: descriptor.objective,
        targetRelativePath: descriptor.targetRelativePath,
        expectedText: intent.expectedText,
        replacementText: intent.replacementText,
        projection
      });
      validateDecision(descriptor, intent, decision);
      const argumentsHash = computeArgumentsHash(decision.arguments);
      const workspaceHash = await this.dependencies.workspaceManager.computeHash(
        descriptor.workspaceRoot
      );
      ({ projection, events } = await this.append(
        descriptor,
        projection,
        events,
        "provider.decision_recorded",
        {
          decisionId: decision.decisionId,
          toolName: decision.toolName,
          argumentsHash,
          idempotencyKey: decision.idempotencyKey,
          actionSignature: sha256Hex(
            canonicalizeValue({ toolName: decision.toolName, argumentsHash, workspaceHash })
          ),
          inputTokens: decision.inputTokens,
          outputTokens: decision.outputTokens,
          costMinorUnits: decision.costMinorUnits
        }
      ));
      messages.push(this.dependencies.redactor.redact(decision.sensitiveDiagnostics));
    } else {
      decision = expectedDecision(descriptor, intent);
      if (decisionEvent.payload["argumentsHash"] !== computeArgumentsHash(decision.arguments)) {
        throw new HarnessError(
          HarnessExitCode.ReplayIntegrityFailure,
          "Persisted provider decision does not match pinned run input."
        );
      }
    }
    if (usageExceeds(events, descriptor, capabilities) || this.elapsedExceeded(descriptor)) {
      return this.block(
        HarnessExitCode.LimitExceeded,
        descriptor,
        projection,
        events,
        "UsageLimitExceeded"
      );
    }
    const decisionInterruption = await this.interruptIfConfigured(
      descriptor,
      "after-decision",
      "after_decision",
      projection,
      events
    );
    if (decisionInterruption !== null) return decisionInterruption;

    ({ projection, events } = await this.transition(
      descriptor,
      projection,
      events,
      "planning",
      "executing",
      "Execute policy-approved workspace action"
    ));
    const admission = this.dependencies.toolDispatcher.getAdmission(decision.toolName);
    const policyDecision = evaluatePolicy(policy, decision.toolName, admission.actionClass);
    if (!hasEvent(events, "policy.decision_recorded")) {
      ({ projection, events } = await this.append(
        descriptor,
        projection,
        events,
        "policy.decision_recorded",
        {
          policyDecisionId: "policy-final",
          toolName: decision.toolName,
          actionClass: admission.actionClass,
          outcome: policyDecision.isAllowed ? "allowed" : "denied",
          ruleIds: policyDecision.ruleIds
        }
      ));
    }
    if (!policyDecision.isAllowed) {
      return this.block(
        HarnessExitCode.PolicyDenied,
        descriptor,
        projection,
        events,
        "PolicyDenied"
      );
    }

    let toolResult: ToolResult;
    const completedTool = lastEvent(events, "tool.completed");
    if (completedTool === undefined) {
      if (!hasEvent(events, "tool.dispatched")) {
        if (!canDispatchTool(projection, descriptor.limits)) {
          return this.block(
            HarnessExitCode.LimitExceeded,
            descriptor,
            projection,
            events,
            "ToolDispatchLimitExceeded"
          );
        }
        ({ projection, events } = await this.append(
          descriptor,
          projection,
          events,
          "tool.dispatched",
          {
            toolCallId: "tool-final",
            toolName: decision.toolName,
            idempotencyKey: decision.idempotencyKey,
            workspaceHashBefore: await this.dependencies.workspaceManager.computeHash(
              descriptor.workspaceRoot
            )
          }
        ));
      }
      const dispatched = await this.dependencies.toolDispatcher.dispatch(
        {
          workspaceRoot: descriptor.workspaceRoot,
          stateRoot: descriptor.stateRoot,
          cancellation: { isCancellationRequested: false }
        },
        {
          toolId: decision.toolName,
          idempotencyKey: decision.idempotencyKey,
          arguments: decision.arguments
        },
        policy
      );
      toolResult = legacyToolResult(dispatched);
      const toolInterruption = await this.interruptIfConfigured(
        descriptor,
        "after-tool-commit",
        "after_tool_commit",
        projection,
        events
      );
      if (toolInterruption !== null) return toolInterruption;
      events = await this.dependencies.runStore.readEvents(descriptor);
      projection = replayRun(descriptor.runId, events);
      const workspaceHashAfter =
        toolResult.workspaceHash === ""
          ? await this.dependencies.workspaceManager.computeHash(descriptor.workspaceRoot)
          : toolResult.workspaceHash;
      ({ projection, events } = await this.append(
        descriptor,
        projection,
        events,
        "tool.completed",
        {
          toolCallId: "tool-final",
          idempotencyKey: decision.idempotencyKey,
          outcome: toolResult.isSuccess ? "succeeded" : "failed",
          errorCode: toolResult.errorCode,
          beforeFileHash: toolResult.beforeFileHash,
          afterFileHash: toolResult.afterFileHash,
          workspaceHashAfter
        }
      ));
      if (!toolResult.isSuccess) {
        return this.block(
          HarnessExitCode.Blocked,
          descriptor,
          projection,
          events,
          toolResult.errorCode ?? "ToolFailed"
        );
      }
    } else {
      toolResult = toolResultFromEvent(completedTool);
    }

    if (!hasEvent(events, "checkpoint.recorded")) {
      const checkpointHash = await this.dependencies.runStore.saveCheckpoint(
        descriptor,
        projection,
        toolResult.workspaceHash,
        events
      );
      ({ projection, events } = await this.append(
        descriptor,
        projection,
        events,
        "checkpoint.recorded",
        {
          checkpointHash,
          projectionHash: projectionHash(projection),
          workspaceHash: toolResult.workspaceHash,
          chainHeadBefore: projection.eventChainHead
        }
      ));
    }
    ({ projection, events } = await this.transition(
      descriptor,
      projection,
      events,
      "executing",
      "verifying",
      "Verify final workspace state"
    ));

    let verification: VerificationArtifact;
    const verificationEvent = lastEvent(events, "verification.recorded");
    if (verificationEvent === undefined) {
      verification = await this.dependencies.verificationService.verify(
        descriptor,
        projection,
        instruction,
        decision,
        toolResult
      );
      const artifactHash = hashArtifact(verification);
      await this.dependencies.runStore.saveVerification(descriptor, verification);
      ({ projection, events } = await this.append(
        descriptor,
        projection,
        events,
        "verification.recorded",
        {
          evidenceId: verification.summary.evidenceId,
          resultHash: verification.resultHash,
          artifactHash,
          workspaceHash: verification.summary.workspaceHash,
          discoveredChecks: verification.summary.discoveredChecks,
          passedChecks: verification.summary.passedChecks
        }
      ));
    } else {
      verification = await this.dependencies.runStore.loadVerification(descriptor);
      if (
        verificationEvent.payload["artifactHash"] !== hashArtifact(verification) ||
        verificationEvent.payload["resultHash"] !== verification.resultHash ||
        verificationEvent.payload["workspaceHash"] !== verification.summary.workspaceHash
      ) {
        throw new HarnessError(
          HarnessExitCode.ReplayIntegrityFailure,
          "Verification artifact does not match its durable event binding."
        );
      }
    }
    const verificationInterruption = await this.interruptIfConfigured(
      descriptor,
      "after-verification",
      "after_verification",
      projection,
      events
    );
    if (verificationInterruption !== null) return verificationInterruption;

    ({ projection, events } = await this.transition(
      descriptor,
      projection,
      events,
      "verifying",
      "reviewing",
      "Run independent read-only evaluation"
    ));
    let evaluation: EvaluationArtifact;
    let evaluationEvent = lastEvent(events, "evaluation.recorded");
    if (evaluationEvent === undefined) {
      const evaluatedProjection = projection;
      const workspaceHash = await this.dependencies.workspaceManager.computeHash(
        descriptor.workspaceRoot
      );
      const contractContent = await this.dependencies.runStore.loadAsset(
        descriptor,
        "work-contract.json"
      );
      const rubricContent = await this.dependencies.runStore.loadAsset(
        descriptor,
        "evaluator-rubric.json"
      );
      const contract = await this.dependencies.contractValidator.parseWorkContract(contractContent);
      const rubric = await this.dependencies.contractValidator.parseEvaluatorRubric(rubricContent);
      evaluation = this.dependencies.evaluator.evaluate(
        descriptor,
        contract,
        rubric,
        projection,
        verification,
        workspaceHash,
        descriptor.workContractHash,
        sha256Hex(contractContent),
        descriptor.assets.evaluatorRubricHash,
        sha256Hex(rubricContent),
        formatRoundTripUtc(this.dependencies.clock.now())
      );
      const completion = evaluateCompletion(
        evaluatedProjection,
        verification.summary,
        evaluation.summary,
        workspaceHash,
        projectionHash(evaluatedProjection),
        this.dependencies.clock.now(),
        EVIDENCE_MAXIMUM_AGE_MS
      );
      const artifactHash = hashArtifact(evaluation);
      await this.dependencies.runStore.saveEvaluation(descriptor, evaluation);
      ({ projection, events } = await this.append(
        descriptor,
        projection,
        events,
        "evaluation.recorded",
        {
          evaluationId: evaluation.summary.evaluationId,
          verdict: evaluation.summary.verdict,
          artifactHash,
          projectionHash: evaluation.summary.projectionHash,
          workspaceHash: evaluation.summary.workspaceHash,
          eventChainHead: evaluation.summary.eventChainHead,
          evidenceHashes: [verification.resultHash]
        }
      ));
      evaluationEvent = events.at(-1);
      if (!completion.isAllowed) {
        return this.block(
          HarnessExitCode.EvaluationRejected,
          descriptor,
          projection,
          events,
          "EvaluationRejected",
          completion.reasons
        );
      }
    } else {
      const evaluationIndex = events.findIndex(
        (event) => event.eventType === "evaluation.recorded"
      );
      const evaluatedProjection = replayRun(descriptor.runId, events.slice(0, evaluationIndex));
      evaluation = await this.dependencies.runStore.loadEvaluation(descriptor);
      validateEvaluationBinding(evaluationEvent, evaluation);
      const workspaceHash = await this.dependencies.workspaceManager.computeHash(
        descriptor.workspaceRoot
      );
      const completion = evaluateCompletion(
        evaluatedProjection,
        verification.summary,
        evaluation.summary,
        workspaceHash,
        projectionHash(evaluatedProjection),
        this.dependencies.clock.now(),
        EVIDENCE_MAXIMUM_AGE_MS
      );
      if (!completion.isAllowed) {
        return this.block(
          HarnessExitCode.EvaluationRejected,
          descriptor,
          projection,
          events,
          "EvaluationInvalidated",
          completion.reasons
        );
      }
    }
    const evaluationInterruption = await this.interruptIfConfigured(
      descriptor,
      "after-evaluation",
      "after_evaluation",
      projection,
      events
    );
    if (evaluationInterruption !== null) return evaluationInterruption;
    if (!hasEvent(events, "run.completed")) {
      if (evaluationEvent === undefined) throw new Error("Evaluation event is missing.");
      ({ projection, events } = await this.append(descriptor, projection, events, "run.completed", {
        projectionHash: projectionHash(projection),
        workspaceHash: evaluation.summary.workspaceHash,
        evaluationId: evaluation.summary.evaluationId,
        evaluationEventHash: evaluationEvent.eventHash,
        evaluationArtifactHash: requiredEventString(evaluationEvent, "artifactHash"),
        verificationResultHash: verification.resultHash
      }));
    }
    await this.dependencies.workspaceManager.assertUnchanged(
      descriptor.sourceFixturePath,
      descriptor.sourceFixtureHash
    );
    messages.push("Run completed with fresh verification and read-only evaluation.");
    return resultFor(HarnessExitCode.Completed, descriptor, projection, events, messages);
  }

  private async validateSubmitRequest(request: SubmitRunRequest): Promise<void> {
    if (
      request.taskId.trim() === "" ||
      request.objective.trim() === "" ||
      request.expectedText === "" ||
      !/^[a-f0-9]{64}$/.test(request.workContractHash)
    ) {
      throw new HarnessError(HarnessExitCode.InvalidInvocation, "Run request is incomplete.");
    }
    if (
      sha256Hex(request.workContractContent) !== request.workContractHash ||
      sha256Hex(request.evaluatorRubricContent) !==
        this.dependencies.runtimeAssets.versions.evaluatorRubricHash ||
      !assetVersionsEqual(request.assets, this.dependencies.runtimeAssets.versions)
    ) {
      throw new HarnessError(HarnessExitCode.InvalidInvocation, "Run asset hashes do not match.");
    }
    const contract = await this.dependencies.contractValidator.parseWorkContract(
      request.workContractContent
    );
    const rubric = await this.dependencies.contractValidator.parseEvaluatorRubric(
      request.evaluatorRubricContent
    );
    if (
      !isSupportedContract(contract, request.taskId) ||
      !isSupportedRubric(rubric, this.dependencies.runtimeAssets.versions.evaluatorRubricVersion)
    ) {
      throw new HarnessError(
        HarnessExitCode.InvalidInvocation,
        "Run contract or rubric is unsupported."
      );
    }
  }

  private async validateRuntimeAssets(descriptor: RunDescriptor): Promise<void> {
    try {
      if (!assetVersionsEqual(descriptor.assets, this.dependencies.runtimeAssets.versions)) {
        throw new Error("Runtime asset versions differ from the trusted composition.");
      }
      const promptContent = await this.dependencies.runStore.loadAsset(descriptor, "prompt.md");
      if (
        promptContent !== this.dependencies.runtimeAssets.promptContent ||
        sha256Hex(promptContent) !== descriptor.assets.promptHash
      ) {
        throw new Error("Prompt asset does not match its pinned hash.");
      }
      if (
        descriptor.assets.skillHashes.length !==
        this.dependencies.runtimeAssets.skillContents.length
      ) {
        throw new Error("Skill asset count does not match the trusted composition.");
      }
      for (const [
        index,
        expectedContent
      ] of this.dependencies.runtimeAssets.skillContents.entries()) {
        const content = await this.dependencies.runStore.loadAsset(descriptor, `skill-${index}.md`);
        if (
          content !== expectedContent ||
          sha256Hex(content) !== descriptor.assets.skillHashes[index]
        ) {
          throw new Error(`Skill asset ${index} does not match its pinned hash.`);
        }
      }
    } catch (error) {
      throw new HarnessError(HarnessExitCode.Blocked, "Pinned runtime asset validation failed.", {
        cause: error
      });
    }
  }

  private async transition(
    descriptor: RunDescriptor,
    projection: RunProjection,
    events: readonly RunEvent[],
    expected: RunStatus,
    next: RunStatus,
    reason: string
  ): Promise<{ projection: RunProjection; events: readonly RunEvent[] }> {
    return projection.status !== expected
      ? { projection, events }
      : this.append(descriptor, projection, events, "state.transitioned", {
          from: expected,
          to: next,
          reason
        });
  }

  private async append(
    descriptor: RunDescriptor,
    projection: RunProjection,
    events: readonly RunEvent[],
    eventType: string,
    payload: EventPayload
  ): Promise<{ projection: RunProjection; events: readonly RunEvent[] }> {
    const event = await this.dependencies.runStore.append(
      descriptor,
      eventType,
      payload,
      formatRoundTripUtc(this.dependencies.clock.now()),
      projection.lastSequence + 1,
      projection.eventChainHead
    );
    await this.dependencies.observer.eventAppended(event);
    return { projection: applyRunEvent(projection, event), events: [...events, event] };
  }

  private async block(
    exitCode: HarnessExitCode,
    descriptor: RunDescriptor,
    projection: RunProjection,
    events: readonly RunEvent[],
    reason: string,
    priorMessages: readonly string[] = []
  ): Promise<RunResult> {
    const messages = [...priorMessages, reason];
    if (!TERMINAL.has(projection.status)) {
      ({ projection, events } = await this.append(descriptor, projection, events, "run.blocked", {
        reason
      }));
    }
    return resultFor(exitCode, descriptor, projection, events, messages);
  }

  private async interruptIfConfigured(
    descriptor: RunDescriptor,
    configured: RunDescriptor["interruptionPoint"],
    wirePoint: string,
    projection: RunProjection,
    events: readonly RunEvent[]
  ): Promise<RunResult | null> {
    if (
      descriptor.interruptionPoint !== configured ||
      events.some(
        (event) => event.eventType === "run.interrupted" && event.payload["point"] === wirePoint
      )
    ) {
      return null;
    }
    ({ projection, events } = await this.append(descriptor, projection, events, "run.interrupted", {
      point: wirePoint,
      reason: "InjectedFixtureInterruption"
    }));
    return resultFor(HarnessExitCode.InterruptedFixture, descriptor, projection, events, [
      "Fixture interrupted at a durable boundary."
    ]);
  }

  private elapsedExceeded(descriptor: RunDescriptor): boolean {
    return (
      this.dependencies.clock.now().getTime() - Date.parse(descriptor.createdAt) >
      descriptor.limits.maxElapsedMilliseconds
    );
  }
}

function assetsPayload(descriptor: RunDescriptor): EventPayload {
  return {
    promptVersion: descriptor.assets.promptVersion,
    promptHash: descriptor.assets.promptHash,
    skillHashes: descriptor.assets.skillHashes,
    evaluatorRubricVersion: descriptor.assets.evaluatorRubricVersion,
    evaluatorRubricHash: descriptor.assets.evaluatorRubricHash,
    mcpProtocolVersion: descriptor.assets.mcpProtocolVersion,
    telemetryVersion: descriptor.assets.telemetryVersion,
    toolSchemaVersion: descriptor.assets.toolSchemaVersion,
    sandboxProfile: descriptor.assets.sandboxProfile
  };
}

function assetVersionsEqual(left: RunAssetVersions, right: RunAssetVersions): boolean {
  return (
    left.promptVersion === right.promptVersion &&
    left.promptHash === right.promptHash &&
    left.skillHashes.length === right.skillHashes.length &&
    left.skillHashes.every((hash, index) => hash === right.skillHashes[index]) &&
    left.evaluatorRubricVersion === right.evaluatorRubricVersion &&
    left.evaluatorRubricHash === right.evaluatorRubricHash &&
    left.mcpProtocolVersion === right.mcpProtocolVersion &&
    left.telemetryVersion === right.telemetryVersion &&
    left.toolSchemaVersion === right.toolSchemaVersion &&
    left.sandboxProfile === right.sandboxProfile
  );
}

function expectedDecision(
  descriptor: RunDescriptor,
  intent: { readonly expectedText: string; readonly replacementText: string }
): ProviderDecision {
  return {
    decisionId: "decision-1",
    toolName: "workspace.replace_exact_text",
    arguments: {
      relativePath: descriptor.targetRelativePath,
      expectedText: intent.expectedText,
      replacementText: intent.replacementText
    },
    idempotencyKey: "replace-1",
    sensitiveDiagnostics: "",
    inputTokens: 0,
    outputTokens: 0,
    costMinorUnits: 0
  };
}

function computeArgumentsHash(argumentsValue: {
  readonly relativePath: string;
  readonly expectedText: string;
  readonly replacementText: string;
}): string {
  return sha256Hex(
    canonicalizeValue({
      relativePath: argumentsValue.relativePath,
      expectedText: argumentsValue.expectedText,
      replacementText: argumentsValue.replacementText
    })
  );
}

function legacyToolResult(result: ToolDispatchResult): ToolResult {
  return {
    isSuccess: result.isSuccess,
    errorCode: result.error?.code ?? null,
    message: result.message,
    beforeFileHash: result.mutation?.beforeFileHash ?? null,
    afterFileHash: result.mutation?.afterFileHash ?? null,
    workspaceHash: result.mutation?.workspaceHash ?? "",
    replayedReceipt: result.mutation?.replayedReceipt ?? false
  };
}

function validateDecision(
  descriptor: RunDescriptor,
  intent: { readonly expectedText: string; readonly replacementText: string },
  decision: ProviderDecision
): void {
  const expected = expectedDecision(descriptor, intent);
  if (
    decision.toolName !== expected.toolName ||
    decision.idempotencyKey !== expected.idempotencyKey ||
    computeArgumentsHash(decision.arguments) !== computeArgumentsHash(expected.arguments)
  ) {
    throw new HarnessError(
      HarnessExitCode.PolicyDenied,
      "Fixture provider attempted to expand the bounded work contract."
    );
  }
}

function capabilitiesMatch(descriptor: RunDescriptor, capabilities: ProviderCapabilities): boolean {
  return (
    capabilities.providerId === descriptor.providerId &&
    capabilities.adapterVersion === descriptor.providerAdapterVersion &&
    capabilities.requestedModel === descriptor.providerRequestedModel &&
    capabilities.servedModel === descriptor.providerServedModel &&
    capabilities.discoveredAt === descriptor.providerDiscoveredAt &&
    capabilities.contextWindowTokens === descriptor.providerContextWindowTokens &&
    capabilities.maxOutputTokens === descriptor.providerMaxOutputTokens &&
    capabilities.contentHash === descriptor.providerCapabilitiesHash &&
    capabilities.strictStructuredOutput &&
    descriptor.limits.maxInputTokens <= capabilities.contextWindowTokens &&
    descriptor.limits.maxOutputTokens <= capabilities.maxOutputTokens
  );
}

function usageExceeds(
  events: readonly RunEvent[],
  descriptor: RunDescriptor,
  capabilities: ProviderCapabilities
): boolean {
  const input = sumUsage(events, "inputTokens");
  const output = sumUsage(events, "outputTokens");
  const cost = sumUsage(events, "costMinorUnits");
  return (
    input < 0 ||
    output < 0 ||
    cost < 0 ||
    input > descriptor.limits.maxInputTokens ||
    output > descriptor.limits.maxOutputTokens ||
    cost > descriptor.limits.maxCostMinorUnits ||
    output > capabilities.maxOutputTokens ||
    input > capabilities.contextWindowTokens - output
  );
}

function sumUsage(events: readonly RunEvent[], property: string): number {
  return events
    .filter((event) => event.eventType === "provider.decision_recorded")
    .reduce((total, event) => {
      const value = event.payload[property];
      return total + (typeof value === "number" ? value : 0);
    }, 0);
}

function toolResultFromEvent(event: RunEvent): ToolResult {
  return {
    isSuccess: event.payload["outcome"] === "succeeded",
    errorCode: optionalEventString(event, "errorCode"),
    message: "Recovered from durable tool result.",
    beforeFileHash: optionalEventString(event, "beforeFileHash"),
    afterFileHash: optionalEventString(event, "afterFileHash"),
    workspaceHash: requiredEventString(event, "workspaceHashAfter"),
    replayedReceipt: true
  };
}

function validateEvaluationBinding(event: RunEvent, artifact: EvaluationArtifact): void {
  if (
    event.payload["artifactHash"] !== hashArtifact(artifact) ||
    event.payload["verdict"] !== artifact.summary.verdict ||
    event.payload["projectionHash"] !== artifact.summary.projectionHash ||
    event.payload["workspaceHash"] !== artifact.summary.workspaceHash ||
    event.payload["eventChainHead"] !== artifact.summary.eventChainHead ||
    !arrayEquals(event.payload["evidenceHashes"], artifact.evidenceHashes)
  ) {
    throw new HarnessError(
      HarnessExitCode.ReplayIntegrityFailure,
      "Evaluation artifact does not match its durable event binding."
    );
  }
}

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

function resultFor(
  exitCode: HarnessExitCode,
  descriptor: RunDescriptor,
  projection: RunProjection,
  events: readonly RunEvent[],
  messages: readonly string[]
): RunResult {
  return {
    exitCode,
    descriptor,
    projection,
    semanticTraceHash: semanticTraceHash(events),
    messages
  };
}

function exitCodeFor(projection: RunProjection): HarnessExitCode {
  switch (projection.status) {
    case "completed":
      return HarnessExitCode.Completed;
    case "cancelled":
      return HarnessExitCode.Cancelled;
    case "blocked":
      return HarnessExitCode.Blocked;
    case "failed":
      return HarnessExitCode.InternalFailure;
    default:
      return HarnessExitCode.Completed;
  }
}

function hasEvent(events: readonly RunEvent[], eventType: string): boolean {
  return events.some((event) => event.eventType === eventType);
}

function lastEvent(events: readonly RunEvent[], eventType: string): RunEvent | undefined {
  return events.findLast((event) => event.eventType === eventType);
}

function requiredEventString(event: RunEvent, name: string): string {
  const value = event.payload[name];
  if (typeof value !== "string" || value === "") {
    throw new HarnessError(
      HarnessExitCode.ReplayIntegrityFailure,
      `Event field ${name} is missing.`
    );
  }
  return value;
}

function optionalEventString(event: RunEvent, name: string): string | null {
  const value = event.payload[name];
  return typeof value === "string" ? value : null;
}

function arrayEquals(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  );
}
