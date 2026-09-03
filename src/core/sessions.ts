import { canonicalizeValue, sha256Hex } from "./canonical-json.js";
import { EMPTY_HASH } from "./events.js";
import {
  type SessionEvent,
  type SessionEventPayload,
  validateSessionEvent,
  validateSessionEventPayload
} from "./session-events.js";

export const SESSION_STATUSES = [
  "queued",
  "running",
  "evaluating",
  "completed",
  "blocked",
  "failed",
  "cancelled"
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export interface SessionLimits {
  readonly maxTurns: number;
  readonly maxToolDispatches: number;
  readonly maxElapsedMilliseconds: number;
  readonly maxOutputTokensPerTurn: number;
  readonly maxTotalOutputTokens: number;
  readonly maxTotalCostMinorUnits: number;
  readonly repeatedSignatureThreshold: number;
  readonly oscillationWindow: number;
  readonly maxConsecutiveFailedFixes: number;
}

export interface SessionAssetVersions {
  readonly promptVersion: string;
  readonly promptHash: string;
  readonly skillHashes: readonly string[];
  readonly evaluatorRubricVersion: string;
  readonly evaluatorRubricHash: string;
  readonly toolSchemaVersion: string;
  readonly providerAdapterVersion: string;
  readonly sandboxProfile: string;
}

/** Fails closed on non-positive or non-integer limits before a session is ever created. */
export function validateSessionLimits(limits: SessionLimits): SessionLimits {
  requirePositiveInteger(limits.maxTurns, "maxTurns");
  requireInteger(limits.maxToolDispatches, "maxToolDispatches", 0);
  requirePositiveInteger(limits.maxElapsedMilliseconds, "maxElapsedMilliseconds");
  requirePositiveInteger(limits.maxOutputTokensPerTurn, "maxOutputTokensPerTurn");
  requirePositiveInteger(limits.maxTotalOutputTokens, "maxTotalOutputTokens");
  requireInteger(limits.maxTotalCostMinorUnits, "maxTotalCostMinorUnits", 0);
  requirePositiveInteger(limits.repeatedSignatureThreshold, "repeatedSignatureThreshold");
  requirePositiveInteger(limits.oscillationWindow, "oscillationWindow");
  requirePositiveInteger(limits.maxConsecutiveFailedFixes, "maxConsecutiveFailedFixes");
  return limits;
}

function requirePositiveInteger(value: number, name: string): void {
  requireInteger(value, name, 1);
}

function requireInteger(value: number, name: string, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be a safe integer greater than or equal to ${minimum}.`);
  }
}

/** The six loop-owned termination reasons from SPEC-004 section 4.1, in checked priority order. */
export const LOOP_STOP_REASONS = [
  "provider_completed",
  "decision_budget_exhausted",
  "wall_clock_exhausted",
  "oscillation_detected",
  "failed_fix_exhausted",
  "cancelled"
] as const;
export type LoopStopReason = (typeof LOOP_STOP_REASONS)[number];

const TERMINAL = new Set<SessionStatus>(["completed", "blocked", "failed", "cancelled"]);
const BLOCKING_STOP_REASONS = new Set<LoopStopReason>([
  "decision_budget_exhausted",
  "wall_clock_exhausted",
  "oscillation_detected",
  "failed_fix_exhausted"
]);

export interface SessionProjection {
  readonly sessionId: string;
  readonly taskId: string;
  readonly status: SessionStatus;
  readonly lastSequence: number;
  readonly eventChainHead: string;
  readonly limits: SessionLimits | null;
  readonly turnsUsed: number;
  readonly toolDispatchesUsed: number;
  readonly totalOutputTokens: number;
  readonly totalCostMinorUnits: number;
  readonly workspaceMutations: number;
  readonly lastMutationSequence: number;
  readonly consecutiveFailedFixes: number;
  readonly fingerprintHistory: readonly string[];
  readonly lastActionSignature: string | null;
  readonly consecutiveSignatureRepeats: number;
  readonly lastFinishReason: string | null;
  readonly currentTurnNumber: number;
  readonly currentTurnToolCallTarget: number;
  readonly currentTurnCallsCompleted: number;
  readonly verificationAttempts: number;
  readonly verificationRecorded: boolean;
  readonly verificationSequence: number;
  readonly reviewVerdict: string | null;
  readonly evaluationSequence: number;
  readonly stopReason: LoopStopReason | null;
  readonly terminalReason: string | null;
  readonly updatedAt: string;
}

export class SessionProjectionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SessionProjectionError";
  }
}

export function emptySessionProjection(sessionId: string): SessionProjection {
  if (sessionId.length === 0) throw new TypeError("sessionId is required.");
  return {
    sessionId,
    taskId: "",
    status: "queued",
    lastSequence: 0,
    eventChainHead: EMPTY_HASH,
    limits: null,
    turnsUsed: 0,
    toolDispatchesUsed: 0,
    totalOutputTokens: 0,
    totalCostMinorUnits: 0,
    workspaceMutations: 0,
    lastMutationSequence: 0,
    consecutiveFailedFixes: 0,
    fingerprintHistory: [],
    lastActionSignature: null,
    consecutiveSignatureRepeats: 0,
    lastFinishReason: null,
    currentTurnNumber: 0,
    currentTurnToolCallTarget: 0,
    currentTurnCallsCompleted: 0,
    verificationAttempts: 0,
    verificationRecorded: false,
    verificationSequence: 0,
    reviewVerdict: null,
    evaluationSequence: 0,
    stopReason: null,
    terminalReason: null,
    updatedAt: "1970-01-01T00:00:00.0000000+00:00"
  };
}

export function sessionProjectionHash(projection: SessionProjection): string {
  return sha256Hex(
    canonicalizeValue({
      schemaVersion: "2.0",
      sessionId: projection.sessionId,
      taskId: projection.taskId,
      status: projection.status,
      lastSequence: projection.lastSequence,
      eventChainHead: projection.eventChainHead,
      turnsUsed: projection.turnsUsed,
      toolDispatchesUsed: projection.toolDispatchesUsed,
      totalOutputTokens: projection.totalOutputTokens,
      totalCostMinorUnits: projection.totalCostMinorUnits,
      workspaceMutations: projection.workspaceMutations,
      lastMutationSequence: projection.lastMutationSequence,
      consecutiveFailedFixes: projection.consecutiveFailedFixes,
      verificationRecorded: projection.verificationRecorded,
      verificationSequence: projection.verificationSequence,
      reviewVerdict: projection.reviewVerdict,
      evaluationSequence: projection.evaluationSequence,
      stopReason: projection.stopReason,
      terminalReason: projection.terminalReason,
      updatedAt: projection.updatedAt
    })
  );
}

export function replaySession(
  sessionId: string,
  events: readonly SessionEvent[]
): SessionProjection {
  let projection = emptySessionProjection(sessionId);
  let previousHash = EMPTY_HASH;
  let expectedSequence = 1;
  let verification: SessionEvent | undefined;
  let evaluation: SessionEvent | undefined;

  for (const event of events) {
    validateSessionEvent(event, sessionId, expectedSequence, previousHash);
    if (expectedSequence === 1 && event.eventType !== "session.created") {
      throw new SessionProjectionError("A non-empty session history must begin with creation.");
    }
    if (TERMINAL.has(projection.status)) {
      throw new SessionProjectionError("A terminal session cannot accept additional events.");
    }
    validatePrerequisites(projection, event);

    if (event.eventType === "verification.recorded") verification = event;
    if (event.eventType === "evaluation.recorded") {
      if (verification === undefined) {
        throw new SessionProjectionError("Evaluation requires prior verification.");
      }
      if (
        requiredString(event.payload, "eventChainHead") !== projection.eventChainHead ||
        !stringArrayEquals(event.payload, "evidenceHashes", [
          requiredString(verification.payload, "resultHash")
        ])
      ) {
        throw new SessionProjectionError(
          "Evaluation must bind the exact pre-evaluation event head and verification evidence."
        );
      }
      evaluation = event;
    }
    if (event.eventType === "session.completed") {
      if (
        verification === undefined ||
        evaluation === undefined ||
        requiredString(evaluation.payload, "verdict") !== "approved" ||
        requiredString(event.payload, "evaluationId") !==
          requiredString(evaluation.payload, "evaluationId") ||
        requiredString(event.payload, "evaluationEventHash") !== evaluation.eventHash ||
        requiredString(event.payload, "evaluationArtifactHash") !==
          requiredString(evaluation.payload, "artifactHash") ||
        requiredString(event.payload, "verificationResultHash") !==
          requiredString(verification.payload, "resultHash")
      ) {
        throw new SessionProjectionError(
          "Completion must bind the exact approved evaluation and verification result."
        );
      }
    }

    projection = applySessionEvent(projection, event);
    expectedSequence++;
    previousHash = event.eventHash;
  }
  return projection;
}

export function applySessionEvent(
  current: SessionProjection,
  event: SessionEvent
): SessionProjection {
  if (current.sessionId !== event.sessionId) {
    throw new SessionProjectionError("Event belongs to a different session.");
  }
  if (event.sequence !== current.lastSequence + 1) {
    throw new SessionProjectionError("Event sequence is not contiguous.");
  }
  validateSessionEventPayload(event.eventType, event.payload);
  validatePrerequisites(current, event);

  let next: SessionProjection;
  switch (event.eventType) {
    case "session.created":
      if (current.lastSequence !== 0) {
        throw new SessionProjectionError("A session can be created only once.");
      }
      next = {
        ...current,
        taskId: requiredString(event.payload, "taskId"),
        status: "running",
        limits: parseLimits(event.payload)
      };
      break;
    case "turn.requested":
      next = {
        ...current,
        currentTurnNumber: requiredInteger(event.payload, "turnNumber"),
        currentTurnToolCallTarget: 0,
        currentTurnCallsCompleted: 0
      };
      break;
    case "turn.completed": {
      const actionSignature = requiredString(event.payload, "actionSignature");
      next = {
        ...current,
        turnsUsed: checkedIncrement(current.turnsUsed),
        lastFinishReason: requiredString(event.payload, "finishReason"),
        currentTurnToolCallTarget: requiredInteger(event.payload, "toolCallCount"),
        lastActionSignature: actionSignature,
        consecutiveSignatureRepeats:
          current.lastActionSignature === actionSignature
            ? current.consecutiveSignatureRepeats + 1
            : 1,
        totalOutputTokens: checkedAdd(
          current.totalOutputTokens,
          requiredInteger(event.payload, "outputTokens")
        ),
        totalCostMinorUnits: checkedAdd(
          current.totalCostMinorUnits,
          typeof event.payload["costMinorUnits"] === "number" ? event.payload["costMinorUnits"] : 0
        )
      };
      break;
    }
    case "tool.call_dispatched":
      next = { ...current, toolDispatchesUsed: checkedIncrement(current.toolDispatchesUsed) };
      break;
    case "tool.call_completed": {
      const outcome = requiredString(event.payload, "outcome");
      const mutated = outcome === "succeeded" && event.payload["afterFileHash"] !== null;
      const fingerprint = requiredString(event.payload, "workspaceHashAfter");
      const window = current.limits?.oscillationWindow ?? Number.MAX_SAFE_INTEGER;
      next = {
        ...current,
        currentTurnCallsCompleted: current.currentTurnCallsCompleted + 1,
        workspaceMutations: mutated
          ? checkedIncrement(current.workspaceMutations)
          : current.workspaceMutations,
        lastMutationSequence: mutated ? event.sequence : current.lastMutationSequence,
        fingerprintHistory: mutated
          ? [...current.fingerprintHistory, fingerprint].slice(-window)
          : current.fingerprintHistory
      };
      break;
    }
    case "verification.recorded":
      next = {
        ...current,
        verificationRecorded: true,
        verificationSequence: event.sequence,
        verificationAttempts: checkedIncrement(current.verificationAttempts),
        consecutiveFailedFixes:
          requiredInteger(event.payload, "passedChecks") ===
          requiredInteger(event.payload, "discoveredChecks")
            ? 0
            : checkedIncrement(current.consecutiveFailedFixes)
      };
      break;
    case "evaluation.recorded":
      next = {
        ...current,
        reviewVerdict: requiredString(event.payload, "verdict"),
        evaluationSequence: event.sequence
      };
      break;
    case "loop.stopped": {
      const reason = requiredString(event.payload, "reason") as LoopStopReason;
      next = {
        ...current,
        stopReason: reason,
        status: reason === "provider_completed" ? "evaluating" : current.status
      };
      break;
    }
    case "session.cancelled":
      next = applyTerminal(current, "cancelled", event.payload);
      break;
    case "session.blocked":
      next = applyTerminal(current, "blocked", event.payload);
      break;
    case "session.failed":
      next = applyTerminal(current, "failed", event.payload);
      break;
    case "session.completed":
      next = applyCompleted(current);
      break;
  }
  return {
    ...next,
    lastSequence: event.sequence,
    eventChainHead: event.eventHash,
    updatedAt: event.occurredAt
  };
}

function validatePrerequisites(current: SessionProjection, event: SessionEvent): void {
  if (TERMINAL.has(current.status)) {
    throw new SessionProjectionError("A terminal session cannot accept additional events.");
  }
  const limits = current.limits;
  switch (event.eventType) {
    case "turn.requested":
      if (current.status !== "running") {
        throw new SessionProjectionError("Turns may be requested only while running.");
      }
      if (requiredInteger(event.payload, "turnNumber") !== current.turnsUsed + 1) {
        throw new SessionProjectionError("Turn number must be the next sequential turn.");
      }
      if (current.currentTurnCallsCompleted !== current.currentTurnToolCallTarget) {
        throw new SessionProjectionError("A new turn cannot start before the prior turn resolves.");
      }
      break;
    case "turn.completed":
      if (requiredInteger(event.payload, "turnNumber") !== current.currentTurnNumber) {
        throw new SessionProjectionError("Turn completion does not match the requested turn.");
      }
      break;
    case "tool.call_dispatched":
      if (current.status !== "running") {
        throw new SessionProjectionError("Tool calls may be dispatched only while running.");
      }
      if (
        requiredInteger(event.payload, "turnNumber") !== current.currentTurnNumber ||
        requiredInteger(event.payload, "callIndex") !== current.currentTurnCallsCompleted
      ) {
        throw new SessionProjectionError("Tool call dispatch is out of sequence for its turn.");
      }
      break;
    case "tool.call_completed":
      if (
        requiredInteger(event.payload, "turnNumber") !== current.currentTurnNumber ||
        requiredInteger(event.payload, "callIndex") !== current.currentTurnCallsCompleted
      ) {
        throw new SessionProjectionError("Tool call completion is out of sequence for its turn.");
      }
      break;
    case "verification.recorded":
      if (current.status !== "running" && current.status !== "evaluating") {
        throw new SessionProjectionError("Verification requires an active session.");
      }
      if (current.workspaceMutations < 1) {
        throw new SessionProjectionError("Verification requires at least one committed mutation.");
      }
      if (requiredInteger(event.payload, "attemptNumber") !== current.verificationAttempts + 1) {
        throw new SessionProjectionError("Verification attempt number is out of sequence.");
      }
      break;
    case "evaluation.recorded":
      if (current.status !== "evaluating" || !current.verificationRecorded) {
        throw new SessionProjectionError(
          "Evaluation requires recorded verification while evaluating."
        );
      }
      break;
    case "loop.stopped": {
      if (current.status !== "running") {
        throw new SessionProjectionError("The loop can stop only while running.");
      }
      const reason = requiredString(event.payload, "reason") as LoopStopReason;
      if (reason === "provider_completed" && current.lastFinishReason !== "completed") {
        throw new SessionProjectionError("provider_completed requires a completed final turn.");
      }
      if (
        reason === "decision_budget_exhausted" &&
        !(limits !== null && current.turnsUsed >= limits.maxTurns)
      ) {
        throw new SessionProjectionError("decision_budget_exhausted is not yet true.");
      }
      if (
        reason === "oscillation_detected" &&
        new Set(current.fingerprintHistory).size === current.fingerprintHistory.length &&
        !(
          limits !== null &&
          current.consecutiveSignatureRepeats >= limits.repeatedSignatureThreshold
        )
      ) {
        throw new SessionProjectionError(
          "oscillation_detected requires a repeated fingerprint or action signature."
        );
      }
      if (
        reason === "failed_fix_exhausted" &&
        !(limits !== null && current.consecutiveFailedFixes >= limits.maxConsecutiveFailedFixes)
      ) {
        throw new SessionProjectionError("failed_fix_exhausted is not yet true.");
      }
      break;
    }
    case "session.blocked":
      if (
        current.stopReason !== null &&
        current.stopReason !== "cancelled" &&
        !BLOCKING_STOP_REASONS.has(current.stopReason) &&
        current.status !== "evaluating"
      ) {
        throw new SessionProjectionError(
          "session.blocked reason is inconsistent with the loop stop."
        );
      }
      break;
    case "session.cancelled":
      if (current.stopReason !== null && current.stopReason !== "cancelled") {
        throw new SessionProjectionError("session.cancelled requires a cancellation stop reason.");
      }
      break;
  }
}

function applyTerminal(
  current: SessionProjection,
  status: SessionStatus,
  payload: SessionEventPayload
): SessionProjection {
  if (TERMINAL.has(current.status)) {
    throw new SessionProjectionError("A terminal session cannot accept another terminal event.");
  }
  return { ...current, status, terminalReason: requiredString(payload, "reason") };
}

function applyCompleted(current: SessionProjection): SessionProjection {
  if (current.status !== "evaluating") {
    throw new SessionProjectionError("A session can complete only while evaluating.");
  }
  if (
    !current.verificationRecorded ||
    current.reviewVerdict !== "approved" ||
    current.evaluationSequence <= current.verificationSequence ||
    current.verificationSequence <= current.lastMutationSequence
  ) {
    throw new SessionProjectionError(
      "Completion requires verification after mutation and a later approved evaluation."
    );
  }
  return { ...current, status: "completed", terminalReason: null };
}

function parseLimits(payload: SessionEventPayload): SessionLimits {
  const value = payload["limits"];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SessionProjectionError("Session limits payload is invalid.");
  }
  const limits = value as Record<string, number>;
  return Object.freeze({
    maxTurns: limits["maxTurns"] as number,
    maxToolDispatches: limits["maxToolDispatches"] as number,
    maxElapsedMilliseconds: limits["maxElapsedMilliseconds"] as number,
    maxOutputTokensPerTurn: limits["maxOutputTokensPerTurn"] as number,
    maxTotalOutputTokens: limits["maxTotalOutputTokens"] as number,
    maxTotalCostMinorUnits: limits["maxTotalCostMinorUnits"] as number,
    repeatedSignatureThreshold: limits["repeatedSignatureThreshold"] as number,
    oscillationWindow: limits["oscillationWindow"] as number,
    maxConsecutiveFailedFixes: limits["maxConsecutiveFailedFixes"] as number
  });
}

function requiredString(payload: SessionEventPayload, name: string): string {
  const value = payload[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SessionProjectionError(`Event payload property ${name} is required.`);
  }
  return value;
}

function requiredInteger(payload: SessionEventPayload, name: string): number {
  const value = payload[name];
  if (!Number.isSafeInteger(value)) {
    throw new SessionProjectionError(`Event payload property ${name} must be a safe integer.`);
  }
  return value as number;
}

function stringArrayEquals(
  payload: SessionEventPayload,
  name: string,
  expected: readonly string[]
): boolean {
  const value = payload[name];
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  );
}

function checkedIncrement(value: number): number {
  if (!Number.isSafeInteger(value) || value >= Number.MAX_SAFE_INTEGER) {
    throw new SessionProjectionError("Projection counter overflowed.");
  }
  return value + 1;
}

function checkedAdd(value: number, addend: number): number {
  const result = value + addend;
  if (!Number.isSafeInteger(result))
    throw new SessionProjectionError("Projection counter overflowed.");
  return result;
}

/**
 * Counts how many of the most recent completed turns share the given action signature,
 * scanning backward from the newest turn. Mirrors `countConsecutiveActionSignature` in
 * `policy.ts` for the schema-v2 turn-scoped event family. The action signature captures only
 * the model's proposed tool calls against the pre-turn workspace state, not conversation
 * history, so it can meaningfully repeat when the model proposes the same fix twice.
 */
export function countConsecutiveTurnSignature(
  events: readonly SessionEvent[],
  signature: string
): number {
  if (signature.trim().length === 0) throw new TypeError("signature is required.");
  let count = 0;
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event?.eventType !== "turn.completed") continue;
    const value = event.payload["actionSignature"];
    if (typeof value !== "string")
      throw new TypeError("Turn completion is missing its action signature.");
    if (value !== signature) break;
    count++;
  }
  return count;
}
