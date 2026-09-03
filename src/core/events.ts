import {
  canonicalizeJson,
  canonicalizeValue,
  type JsonValue,
  sha256Hex,
  stringifyJsonValue
} from "./canonical-json.js";
import { assertEventPayload } from "./event-payloads.js";

export const EVENT_TYPES = [
  "run.created",
  "state.transitioned",
  "instruction.selected",
  "provider.decision_recorded",
  "policy.decision_recorded",
  "tool.dispatched",
  "tool.completed",
  "checkpoint.recorded",
  "verification.recorded",
  "evaluation.recorded",
  "run.interrupted",
  "run.cancelled",
  "run.blocked",
  "run.failed",
  "run.completed"
] as const;

export type EventType = (typeof EVENT_TYPES)[number];
export type EventIntegrityErrorCode =
  | "MalformedEvent"
  | "UnsupportedSchema"
  | "UnsupportedEventType"
  | "RunMismatch"
  | "SequenceMismatch"
  | "PreviousHashMismatch"
  | "EventHashMismatch";

export const EVENT_SCHEMA_VERSION = "1.0";
export const EMPTY_HASH = "0".repeat(64);
const EVENT_TYPE_SET = new Set<string>(EVENT_TYPES);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ROUND_TRIP_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}\+00:00$/;

export type EventPayload = Readonly<Record<string, JsonValue>>;

export interface EventDraft {
  readonly eventType: string;
  readonly occurredAt: string | Date;
  readonly payload: EventPayload;
}

export interface RunEvent {
  readonly schemaVersion: string;
  readonly runId: string;
  readonly sequence: number;
  readonly eventType: EventType;
  readonly occurredAt: string;
  readonly payload: EventPayload;
  readonly previousHash: string;
  readonly eventHash: string;
}

export class EventIntegrityError extends Error {
  public constructor(
    public readonly code: EventIntegrityErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "EventIntegrityError";
  }
}

export function createRunEvent(
  runId: string,
  sequence: number,
  draft: EventDraft,
  previousHash: string
): RunEvent {
  validateIdentifier(runId, "runId");
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new RangeError("sequence must be a positive safe integer.");
  }
  const eventType = parseEventType(draft.eventType);
  validateEventPayload(eventType, draft.payload);
  validateHash(previousHash, "previousHash");
  const occurredAt = normalizeTimestamp(draft.occurredAt);
  const base = {
    schemaVersion: EVENT_SCHEMA_VERSION,
    runId,
    sequence,
    eventType,
    occurredAt,
    payload: draft.payload,
    previousHash
  } satisfies Omit<RunEvent, "eventHash">;
  return { ...base, eventHash: computeEventHash(base) };
}

export function validateRunEvent(
  event: RunEvent,
  expectedRunId: string,
  expectedSequence: number,
  expectedPreviousHash: string
): void {
  if (event.schemaVersion !== EVENT_SCHEMA_VERSION) {
    throw new EventIntegrityError(
      "UnsupportedSchema",
      `Unsupported event schema: ${event.schemaVersion}.`
    );
  }
  if (event.runId !== expectedRunId) {
    throw new EventIntegrityError("RunMismatch", "Event run identifier does not match.");
  }
  if (event.sequence !== expectedSequence) {
    throw new EventIntegrityError(
      "SequenceMismatch",
      `Expected event sequence ${expectedSequence}, observed ${event.sequence}.`
    );
  }
  if (event.previousHash !== expectedPreviousHash) {
    throw new EventIntegrityError(
      "PreviousHashMismatch",
      `Event ${event.sequence} does not reference the expected chain head.`
    );
  }
  parseEventType(event.eventType);
  validateEventPayload(event.eventType, event.payload);
  validateHash(event.eventHash, "eventHash");
  const actual = computeEventHash(event);
  if (actual !== event.eventHash) {
    throw new EventIntegrityError("EventHashMismatch", `Event ${event.sequence} hash is invalid.`);
  }
}

export function serializeRunEvent(event: RunEvent): string {
  return stringifyJsonValue({
    schemaVersion: event.schemaVersion,
    runId: event.runId,
    sequence: event.sequence,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    payload: event.payload,
    previousHash: event.previousHash,
    eventHash: event.eventHash
  });
}

export function parseRunEvent(input: string | Uint8Array): RunEvent {
  try {
    const value = JSON.parse(canonicalizeJson(input)) as unknown;
    const root = requireExactObject(value, [
      "schemaVersion",
      "runId",
      "sequence",
      "eventType",
      "occurredAt",
      "payload",
      "previousHash",
      "eventHash"
    ]);
    const sequence = requireSafeInteger(root["sequence"], "sequence");
    const occurredAt = requireString(root["occurredAt"], "occurredAt");
    if (!ROUND_TRIP_UTC.test(occurredAt) || Number.isNaN(Date.parse(occurredAt))) {
      throw new EventIntegrityError(
        "MalformedEvent",
        "Event timestamp is not an invariant round-trip UTC timestamp."
      );
    }
    const payload = requireObject(root["payload"], "payload") as EventPayload;
    const event: RunEvent = {
      schemaVersion: requireString(root["schemaVersion"], "schemaVersion"),
      runId: requireString(root["runId"], "runId"),
      sequence,
      eventType: parseEventType(requireString(root["eventType"], "eventType")),
      occurredAt,
      payload,
      previousHash: requireString(root["previousHash"], "previousHash"),
      eventHash: requireString(root["eventHash"], "eventHash")
    };
    validateEventPayload(event.eventType, event.payload);
    return event;
  } catch (error) {
    if (error instanceof EventIntegrityError) throw error;
    throw new EventIntegrityError("MalformedEvent", "Event record is malformed.", {
      cause: error
    });
  }
}

export function semanticTraceHash(events: readonly RunEvent[]): string {
  const trace = events.map((event) => ({
    sequence: event.sequence,
    eventType: event.eventType,
    payload: semanticPayload(event)
  }));
  return sha256Hex(canonicalizeValue(trace));
}

export function formatRoundTripUtc(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new RangeError("Timestamp is invalid.");
  return value.toISOString().replace("Z", "0000+00:00");
}

export function validateEventPayload(eventType: EventType, payload: EventPayload): void {
  try {
    assertEventPayload(eventType, payload);
  } catch (error) {
    if (error instanceof EventIntegrityError) throw error;
    throw new EventIntegrityError(
      "MalformedEvent",
      `Event payload does not match the ${eventType} contract.`,
      { cause: error }
    );
  }
}

function computeEventHash(event: Omit<RunEvent, "eventHash"> | RunEvent): string {
  return sha256Hex(
    canonicalizeValue({
      schemaVersion: EVENT_SCHEMA_VERSION,
      runId: event.runId,
      sequence: event.sequence,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      payload: event.payload,
      previousHash: event.previousHash
    })
  );
}

function semanticPayload(event: RunEvent): EventPayload {
  const exclusions: Partial<Record<EventType, readonly string[]>> = {
    "run.created": ["descriptorHash"],
    "checkpoint.recorded": ["checkpointHash", "projectionHash", "chainHeadBefore"],
    "verification.recorded": ["artifactHash"],
    "evaluation.recorded": [
      "projectionHash",
      "artifactHash",
      "eventChainHead",
      "evaluationEventHash",
      "evaluationArtifactHash"
    ],
    "run.completed": [
      "projectionHash",
      "artifactHash",
      "eventChainHead",
      "evaluationEventHash",
      "evaluationArtifactHash"
    ]
  };
  const excluded = new Set(exclusions[event.eventType] ?? []);
  return Object.fromEntries(
    Object.entries(event.payload).filter(([name]) => !excluded.has(name))
  ) as EventPayload;
}

function normalizeTimestamp(value: string | Date): string {
  const timestamp = value instanceof Date ? formatRoundTripUtc(value) : value;
  if (!ROUND_TRIP_UTC.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
    throw new EventIntegrityError(
      "MalformedEvent",
      "Event timestamp must be an invariant round-trip UTC timestamp."
    );
  }
  return timestamp;
}

function parseEventType(value: string): EventType {
  if (!EVENT_TYPE_SET.has(value)) {
    throw new EventIntegrityError("UnsupportedEventType", `Unsupported event type: ${value}.`);
  }
  return value as EventType;
}

function validateIdentifier(value: string, name: string): void {
  if (!IDENTIFIER.test(value)) throw new TypeError(`${name} contains unsupported characters.`);
}

function validateHash(value: string, name: string): void {
  if (!SHA256.test(value)) {
    throw new TypeError(`${name} must contain 64 lowercase hexadecimal characters.`);
  }
}

function requireExactObject(
  value: unknown,
  properties: readonly string[]
): Record<string, unknown> {
  const object = requireObject(value, "event");
  const expected = new Set(properties);
  for (const name of Object.keys(object)) {
    if (!expected.delete(name)) {
      throw new EventIntegrityError("MalformedEvent", `Unexpected event property: ${name}.`);
    }
  }
  if (expected.size > 0) {
    throw new EventIntegrityError(
      "MalformedEvent",
      `Missing event properties: ${[...expected].sort().join(", ")}.`
    );
  }
  return object;
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new EventIntegrityError("MalformedEvent", `${name} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new EventIntegrityError("MalformedEvent", `${name} must be a non-empty string.`);
  }
  return value;
}

function requireSafeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new EventIntegrityError("MalformedEvent", `${name} must be a positive safe integer.`);
  }
  return value as number;
}
