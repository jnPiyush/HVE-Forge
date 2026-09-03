import { canonicalizeValue, type JsonValue, sha256Hex } from "./canonical-json.js";
import {
  EMPTY_HASH,
  type EventPayload,
  type EventType,
  type RunEvent,
  validateEventPayload,
  validateRunEvent
} from "./events.js";

export const RUN_STATUSES = [
  "queued",
  "preparing",
  "researching",
  "planning",
  "awaiting_approval",
  "executing",
  "verifying",
  "reviewing",
  "completed",
  "blocked",
  "failed",
  "cancelled"
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export interface RunProjection {
  readonly runId: string;
  readonly taskId: string;
  readonly status: RunStatus;
  readonly lastSequence: number;
  readonly eventChainHead: string;
  readonly decisionsUsed: number;
  readonly toolDispatchesUsed: number;
  readonly workspaceMutations: number;
  readonly lastMutationSequence: number;
  readonly verificationRecorded: boolean;
  readonly verificationSequence: number;
  readonly reviewVerdict: string | null;
  readonly evaluationSequence: number;
  readonly terminalReason: string | null;
  readonly updatedAt: string;
}

export class ProjectionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ProjectionError";
  }
}

const TERMINAL = new Set<RunStatus>(["completed", "blocked", "failed", "cancelled"]);
const SINGLETON = new Set<EventType>([
  "run.created",
  "instruction.selected",
  "provider.decision_recorded",
  "policy.decision_recorded",
  "tool.dispatched",
  "tool.completed",
  "checkpoint.recorded",
  "verification.recorded",
  "evaluation.recorded",
  "run.cancelled",
  "run.blocked",
  "run.failed",
  "run.completed"
]);
const ALLOWED: Readonly<Record<RunStatus, ReadonlySet<RunStatus>>> = {
  queued: new Set(["preparing", "cancelled"]),
  preparing: new Set(["researching", "failed", "cancelled"]),
  researching: new Set(["planning", "blocked", "failed", "cancelled"]),
  planning: new Set(["awaiting_approval", "executing", "blocked", "failed", "cancelled"]),
  awaiting_approval: new Set(["executing", "blocked", "cancelled"]),
  executing: new Set(["verifying", "blocked", "failed", "cancelled"]),
  verifying: new Set(["reviewing", "executing", "failed", "cancelled"]),
  reviewing: new Set(["executing", "completed", "blocked", "failed", "cancelled"]),
  completed: new Set(),
  blocked: new Set(),
  failed: new Set(),
  cancelled: new Set()
};

export function emptyProjection(runId: string): RunProjection {
  if (runId.length === 0) throw new TypeError("runId is required.");
  return {
    runId,
    taskId: "",
    status: "queued",
    lastSequence: 0,
    eventChainHead: EMPTY_HASH,
    decisionsUsed: 0,
    toolDispatchesUsed: 0,
    workspaceMutations: 0,
    lastMutationSequence: 0,
    verificationRecorded: false,
    verificationSequence: 0,
    reviewVerdict: null,
    evaluationSequence: 0,
    terminalReason: null,
    updatedAt: "1970-01-01T00:00:00.0000000+00:00"
  };
}

export function projectionHash(projection: RunProjection): string {
  return sha256Hex(
    canonicalizeValue({
      schemaVersion: "1.0",
      runId: projection.runId,
      taskId: projection.taskId,
      status: projection.status,
      lastSequence: projection.lastSequence,
      eventChainHead: projection.eventChainHead,
      decisionsUsed: projection.decisionsUsed,
      toolDispatchesUsed: projection.toolDispatchesUsed,
      workspaceMutations: projection.workspaceMutations,
      lastMutationSequence: projection.lastMutationSequence,
      verificationRecorded: projection.verificationRecorded,
      verificationSequence: projection.verificationSequence,
      reviewVerdict: projection.reviewVerdict,
      evaluationSequence: projection.evaluationSequence,
      terminalReason: projection.terminalReason,
      updatedAt: projection.updatedAt
    })
  );
}

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return ALLOWED[from].has(to);
}

export function replayRun(runId: string, events: readonly RunEvent[]): RunProjection {
  let projection = emptyProjection(runId);
  let previousHash = EMPTY_HASH;
  let expectedSequence = 1;
  let providerDecision: RunEvent | undefined;
  let policyDecision: RunEvent | undefined;
  let toolDispatch: RunEvent | undefined;
  let toolCompletion: RunEvent | undefined;
  let verification: RunEvent | undefined;
  let evaluation: RunEvent | undefined;
  let evaluationInterruptionSeen = false;
  const singletonEvents = new Set<EventType>();

  for (const event of events) {
    validateRunEvent(event, runId, expectedSequence, previousHash);
    if (expectedSequence === 1 && event.eventType !== "run.created") {
      throw new ProjectionError("A non-empty run history must begin with run creation.");
    }
    if (TERMINAL.has(projection.status)) {
      throw new ProjectionError("A terminal run cannot accept additional events.");
    }
    if (evaluation !== undefined) {
      const permittedInterruption: boolean =
        event.eventType === "run.interrupted" &&
        !evaluationInterruptionSeen &&
        requiredString(event.payload, "point") === "after_evaluation";
      const terminalDisposition = [
        "run.completed",
        "run.blocked",
        "run.failed",
        "run.cancelled"
      ].includes(event.eventType);
      if (!permittedInterruption && !terminalDisposition) {
        throw new ProjectionError("Only terminal disposition may follow evaluation.");
      }
      evaluationInterruptionSeen ||= permittedInterruption;
    }
    if (SINGLETON.has(event.eventType) && singletonEvents.has(event.eventType)) {
      throw new ProjectionError(`Event type can occur at most once: ${event.eventType}.`);
    }
    singletonEvents.add(event.eventType);

    switch (event.eventType) {
      case "run.created":
        if (event.sequence !== 1 || !isSha256(requiredString(event.payload, "descriptorHash"))) {
          throw new ProjectionError("Run creation must be first and bind a descriptor SHA-256.");
        }
        break;
      case "provider.decision_recorded":
        providerDecision = event;
        break;
      case "policy.decision_recorded":
        if (
          providerDecision === undefined ||
          requiredString(event.payload, "toolName") !==
            requiredString(providerDecision.payload, "toolName")
        ) {
          throw new ProjectionError("Policy decision must follow and match the provider decision.");
        }
        policyDecision = event;
        break;
      case "tool.dispatched":
        if (
          providerDecision === undefined ||
          policyDecision === undefined ||
          requiredString(policyDecision.payload, "outcome") !== "allowed" ||
          requiredString(event.payload, "toolName") !==
            requiredString(providerDecision.payload, "toolName") ||
          requiredString(event.payload, "idempotencyKey") !==
            requiredString(providerDecision.payload, "idempotencyKey")
        ) {
          throw new ProjectionError(
            "Tool dispatch requires a matching allowed policy and provider decision."
          );
        }
        toolDispatch = event;
        break;
      case "tool.completed":
        if (
          toolDispatch === undefined ||
          requiredString(event.payload, "toolCallId") !==
            requiredString(toolDispatch.payload, "toolCallId") ||
          requiredString(event.payload, "idempotencyKey") !==
            requiredString(toolDispatch.payload, "idempotencyKey")
        ) {
          throw new ProjectionError("Tool completion must match a prior dispatch.");
        }
        toolCompletion = event;
        break;
      case "checkpoint.recorded":
        if (
          toolCompletion === undefined ||
          requiredString(toolCompletion.payload, "outcome") !== "succeeded" ||
          requiredString(event.payload, "projectionHash") !== projectionHash(projection) ||
          requiredString(event.payload, "workspaceHash") !==
            requiredString(toolCompletion.payload, "workspaceHashAfter") ||
          requiredString(event.payload, "chainHeadBefore") !== projection.eventChainHead ||
          !isSha256(requiredString(event.payload, "checkpointHash"))
        ) {
          throw new ProjectionError(
            "Checkpoint must bind successful tool completion and the exact pre-checkpoint state."
          );
        }
        break;
      case "verification.recorded":
        if (
          toolCompletion === undefined ||
          requiredString(toolCompletion.payload, "outcome") !== "succeeded"
        ) {
          throw new ProjectionError("Verification requires successful tool completion.");
        }
        verification = event;
        break;
      case "evaluation.recorded":
        if (
          verification === undefined ||
          requiredString(event.payload, "projectionHash") !== projectionHash(projection) ||
          requiredString(event.payload, "eventChainHead") !== projection.eventChainHead ||
          requiredString(event.payload, "workspaceHash") !==
            requiredString(verification.payload, "workspaceHash") ||
          !stringArrayEquals(event.payload, "evidenceHashes", [
            requiredString(verification.payload, "resultHash")
          ])
        ) {
          throw new ProjectionError(
            "Evaluation must bind the exact verified projection, workspace, event head, and evidence."
          );
        }
        evaluation = event;
        break;
      case "run.completed":
        if (
          evaluation === undefined ||
          verification === undefined ||
          requiredString(evaluation.payload, "verdict") !== "approved" ||
          requiredString(event.payload, "evaluationId") !==
            requiredString(evaluation.payload, "evaluationId") ||
          requiredString(event.payload, "projectionHash") !== projectionHash(projection) ||
          requiredString(event.payload, "workspaceHash") !==
            requiredString(evaluation.payload, "workspaceHash") ||
          requiredString(event.payload, "evaluationEventHash") !== evaluation.eventHash ||
          requiredString(event.payload, "evaluationArtifactHash") !==
            requiredString(evaluation.payload, "artifactHash") ||
          requiredString(event.payload, "verificationResultHash") !==
            requiredString(verification.payload, "resultHash")
        ) {
          throw new ProjectionError(
            "Completion must bind the exact approved evaluation, projection, workspace, and verification result."
          );
        }
        break;
    }

    projection = applyRunEvent(projection, event);
    expectedSequence++;
    previousHash = event.eventHash;
  }
  return projection;
}

export function applyRunEvent(current: RunProjection, event: RunEvent): RunProjection {
  if (current.runId !== event.runId) throw new ProjectionError("Event belongs to a different run.");
  if (event.sequence !== current.lastSequence + 1) {
    throw new ProjectionError("Event sequence is not contiguous.");
  }
  validateEventPayload(event.eventType, event.payload);
  validatePrerequisites(current, event);

  let next: RunProjection;
  switch (event.eventType) {
    case "run.created":
      if (current.lastSequence !== 0) throw new ProjectionError("A run can be created only once.");
      next = { ...current, taskId: requiredString(event.payload, "taskId"), status: "queued" };
      break;
    case "state.transitioned":
      next = applyTransition(current, event.payload);
      break;
    case "provider.decision_recorded":
      next = { ...current, decisionsUsed: checkedIncrement(current.decisionsUsed) };
      break;
    case "tool.dispatched":
      next = { ...current, toolDispatchesUsed: checkedIncrement(current.toolDispatchesUsed) };
      break;
    case "tool.completed":
      next =
        requiredString(event.payload, "outcome") === "succeeded"
          ? {
              ...current,
              workspaceMutations: checkedIncrement(current.workspaceMutations),
              lastMutationSequence: event.sequence
            }
          : current;
      break;
    case "verification.recorded":
      next = { ...current, verificationRecorded: true, verificationSequence: event.sequence };
      break;
    case "evaluation.recorded":
      next = {
        ...current,
        reviewVerdict: requiredString(event.payload, "verdict"),
        evaluationSequence: event.sequence
      };
      break;
    case "run.interrupted":
      next = { ...current, terminalReason: requiredString(event.payload, "reason") };
      break;
    case "run.cancelled":
      next = applyTerminal(current, "cancelled", event.payload);
      break;
    case "run.blocked":
      next = applyTerminal(current, "blocked", event.payload);
      break;
    case "run.failed":
      next = applyTerminal(current, "failed", event.payload);
      break;
    case "run.completed":
      next = applyCompleted(current);
      break;
    case "instruction.selected":
    case "policy.decision_recorded":
    case "checkpoint.recorded":
      next = current;
      break;
  }
  return {
    ...next,
    lastSequence: event.sequence,
    eventChainHead: event.eventHash,
    updatedAt: event.occurredAt
  };
}

function applyTransition(current: RunProjection, payload: EventPayload): RunProjection {
  const from = parseRunStatus(requiredString(payload, "from"));
  const to = parseRunStatus(requiredString(payload, "to"));
  if (current.status !== from) {
    throw new ProjectionError(`Transition expected ${from}, but projection is ${current.status}.`);
  }
  if (!canTransition(from, to)) {
    throw new ProjectionError(`Transition from ${from} to ${to} is not allowed.`);
  }
  return { ...current, status: to, terminalReason: null };
}

function applyTerminal(
  current: RunProjection,
  status: RunStatus,
  payload: EventPayload
): RunProjection {
  if (TERMINAL.has(current.status)) {
    throw new ProjectionError("A terminal run cannot accept another terminal event.");
  }
  return { ...current, status, terminalReason: requiredString(payload, "reason") };
}

function applyCompleted(current: RunProjection): RunProjection {
  if (current.status !== "reviewing") {
    throw new ProjectionError("A run can complete only from reviewing state.");
  }
  if (
    !current.verificationRecorded ||
    current.reviewVerdict !== "approved" ||
    current.evaluationSequence <= current.verificationSequence ||
    current.verificationSequence <= current.lastMutationSequence
  ) {
    throw new ProjectionError(
      "Completion requires verification after mutation and a later approved evaluation."
    );
  }
  return { ...current, status: "completed", terminalReason: null };
}

function validatePrerequisites(current: RunProjection, event: RunEvent): void {
  switch (event.eventType) {
    case "provider.decision_recorded":
      if (current.status !== "planning") {
        throw new ProjectionError("Provider decisions are allowed only while planning.");
      }
      break;
    case "policy.decision_recorded":
    case "tool.dispatched":
      if (current.status !== "executing") {
        throw new ProjectionError("Policy and tool dispatch are allowed only while executing.");
      }
      break;
    case "tool.completed":
      if (current.status !== "executing" || current.toolDispatchesUsed < 1) {
        throw new ProjectionError("Tool completion requires a prior dispatch while executing.");
      }
      break;
    case "verification.recorded":
      if (current.status !== "verifying" || current.workspaceMutations < 1) {
        throw new ProjectionError(
          "Verification requires a committed mutation and verifying state."
        );
      }
      break;
    case "evaluation.recorded":
      if (current.status !== "reviewing" || !current.verificationRecorded) {
        throw new ProjectionError("Evaluation requires recorded verification and reviewing state.");
      }
      break;
    case "checkpoint.recorded":
      if (current.workspaceMutations < 1) {
        throw new ProjectionError("Checkpoint requires a committed workspace mutation.");
      }
      break;
  }
}

function parseRunStatus(value: string): RunStatus {
  if (!(RUN_STATUSES as readonly string[]).includes(value)) {
    throw new ProjectionError(`Unknown run status: ${value}.`);
  }
  return value as RunStatus;
}

function requiredString(payload: EventPayload, name: string): string {
  const value = payload[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProjectionError(`Event payload property ${name} is required.`);
  }
  return value;
}

function stringArrayEquals(
  payload: EventPayload,
  name: string,
  expected: readonly string[]
): boolean {
  const value = payload[name];
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item: JsonValue, index: number) => item === expected[index])
  );
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function checkedIncrement(value: number): number {
  if (!Number.isSafeInteger(value) || value >= Number.MAX_SAFE_INTEGER) {
    throw new ProjectionError("Projection counter overflowed.");
  }
  return value + 1;
}
