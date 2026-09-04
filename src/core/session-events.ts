import {
  canonicalizeJson,
  canonicalizeValue,
  type JsonValue,
  sha256Hex,
  stringifyJsonValue
} from "./canonical-json.js";
import { EMPTY_HASH, formatRoundTripUtc } from "./events.js";
import { assertSessionEventPayload } from "./session-event-payloads.js";

/**
 * Schema-v2 session event registry. This is deliberately separate from the frozen schema-v1
 * `EVENT_TYPES` in `events.ts`: v1 meanings and replay behavior are never reinterpreted, and
 * multi-turn bounded-loop behavior is owned entirely by this parallel family.
 */
export const SESSION_EVENT_TYPES = [
  "session.created",
  "turn.requested",
  "turn.completed",
  "tool.call_dispatched",
  "tool.call_completed",
  "verification.recorded",
  "evaluation.recorded",
  "loop.stopped",
  "session.completed",
  "session.blocked",
  "session.failed",
  "session.cancelled"
] as const;

export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number];
export type SessionEventIntegrityErrorCode =
  | "MalformedEvent"
  | "UnsupportedSchema"
  | "UnsupportedEventType"
  | "SessionMismatch"
  | "SequenceMismatch"
  | "PreviousHashMismatch"
  | "EventHashMismatch";

export const SESSION_EVENT_SCHEMA_VERSION = "2.0";
const EVENT_TYPE_SET = new Set<string>(SESSION_EVENT_TYPES);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ROUND_TRIP_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}\+00:00$/;

export type SessionEventPayload = Readonly<Record<string, JsonValue>>;

export interface SessionEventDraft {
  readonly eventType: string;
  readonly occurredAt: string | Date;
  readonly payload: SessionEventPayload;
}

export interface SessionEvent {
  readonly schemaVersion: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly eventType: SessionEventType;
  readonly occurredAt: string;
  readonly payload: SessionEventPayload;
  readonly previousHash: string;
  readonly eventHash: string;
}

export class SessionEventIntegrityError extends Error {
  public constructor(
    public readonly code: SessionEventIntegrityErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "SessionEventIntegrityError";
  }
}

export function createSessionEvent(
  sessionId: string,
  sequence: number,
  draft: SessionEventDraft,
  previousHash: string
): SessionEvent {
  validateIdentifier(sessionId, "sessionId");
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new RangeError("sequence must be a positive safe integer.");
  }
  const eventType = parseEventType(draft.eventType);
  validateSessionEventPayload(eventType, draft.payload);
  validateHash(previousHash, "previousHash");
  const occurredAt = normalizeTimestamp(draft.occurredAt);
  const base = {
    schemaVersion: SESSION_EVENT_SCHEMA_VERSION,
    sessionId,
    sequence,
    eventType,
    occurredAt,
    payload: draft.payload,
    previousHash
  } satisfies Omit<SessionEvent, "eventHash">;
  return { ...base, eventHash: computeEventHash(base) };
}

export function validateSessionEvent(
  event: SessionEvent,
  expectedSessionId: string,
  expectedSequence: number,
  expectedPreviousHash: string
): void {
  if (event.schemaVersion !== SESSION_EVENT_SCHEMA_VERSION) {
    throw new SessionEventIntegrityError(
      "UnsupportedSchema",
      `Unsupported session event schema: ${event.schemaVersion}.`
    );
  }
  if (event.sessionId !== expectedSessionId) {
    throw new SessionEventIntegrityError(
      "SessionMismatch",
      "Event session identifier does not match."
    );
  }
  if (event.sequence !== expectedSequence) {
    throw new SessionEventIntegrityError(
      "SequenceMismatch",
      `Expected event sequence ${expectedSequence}, observed ${event.sequence}.`
    );
  }
  if (event.previousHash !== expectedPreviousHash) {
    throw new SessionEventIntegrityError(
      "PreviousHashMismatch",
      `Event ${event.sequence} does not reference the expected chain head.`
    );
  }
  parseEventType(event.eventType);
  validateSessionEventPayload(event.eventType, event.payload);
  validateHash(event.eventHash, "eventHash");
  const actual = computeEventHash(event);
  if (actual !== event.eventHash) {
    throw new SessionEventIntegrityError(
      "EventHashMismatch",
      `Event ${event.sequence} hash is invalid.`
    );
  }
}

export function serializeSessionEvent(event: SessionEvent): string {
  return stringifyJsonValue({
    schemaVersion: event.schemaVersion,
    sessionId: event.sessionId,
    sequence: event.sequence,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    payload: event.payload,
    previousHash: event.previousHash,
    eventHash: event.eventHash
  });
}

export function parseSessionEvent(input: string | Uint8Array): SessionEvent {
  try {
    const value = JSON.parse(canonicalizeJson(input)) as unknown;
    const root = requireExactObject(value, [
      "schemaVersion",
      "sessionId",
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
      throw new SessionEventIntegrityError(
        "MalformedEvent",
        "Event timestamp is not an invariant round-trip UTC timestamp."
      );
    }
    const payload = requireObject(root["payload"], "payload") as SessionEventPayload;
    const event: SessionEvent = {
      schemaVersion: requireString(root["schemaVersion"], "schemaVersion"),
      sessionId: requireString(root["sessionId"], "sessionId"),
      sequence,
      eventType: parseEventType(requireString(root["eventType"], "eventType")),
      occurredAt,
      payload,
      previousHash: requireString(root["previousHash"], "previousHash"),
      eventHash: requireString(root["eventHash"], "eventHash")
    };
    validateSessionEventPayload(event.eventType, event.payload);
    return event;
  } catch (error) {
    if (error instanceof SessionEventIntegrityError) throw error;
    throw new SessionEventIntegrityError("MalformedEvent", "Event record is malformed.", {
      cause: error
    });
  }
}

export function sessionSemanticTraceHash(events: readonly SessionEvent[]): string {
  const trace = events.map((event) => ({
    sequence: event.sequence,
    eventType: event.eventType,
    payload: semanticPayload(event)
  }));
  return sha256Hex(canonicalizeValue(trace));
}

export function validateSessionEventPayload(
  eventType: SessionEventType,
  payload: SessionEventPayload
): void {
  try {
    assertSessionEventPayload(eventType, payload);
  } catch (error) {
    if (error instanceof SessionEventIntegrityError) throw error;
    throw new SessionEventIntegrityError(
      "MalformedEvent",
      `Event payload does not match the ${eventType} contract.`,
      { cause: error }
    );
  }
}

function computeEventHash(event: Omit<SessionEvent, "eventHash"> | SessionEvent): string {
  return sha256Hex(
    canonicalizeValue({
      schemaVersion: SESSION_EVENT_SCHEMA_VERSION,
      sessionId: event.sessionId,
      sequence: event.sequence,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      payload: event.payload,
      previousHash: event.previousHash
    })
  );
}

function semanticPayload(event: SessionEvent): SessionEventPayload {
  const exclusions: Partial<Record<SessionEventType, readonly string[]>> = {
    "session.created": ["descriptorHash"],
    "evaluation.recorded": ["projectionHash", "artifactHash", "eventChainHead"],
    "session.completed": [
      "projectionHash",
      "artifactHash",
      "evaluationEventHash",
      "evaluationArtifactHash"
    ]
  };
  const excluded = new Set(exclusions[event.eventType] ?? []);
  return Object.fromEntries(
    Object.entries(event.payload).filter(([name]) => !excluded.has(name))
  ) as SessionEventPayload;
}

function normalizeTimestamp(value: string | Date): string {
  const timestamp = value instanceof Date ? formatRoundTripUtc(value) : value;
  if (!ROUND_TRIP_UTC.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
    throw new SessionEventIntegrityError(
      "MalformedEvent",
      "Event timestamp must be an invariant round-trip UTC timestamp."
    );
  }
  return timestamp;
}

function parseEventType(value: string): SessionEventType {
  if (!EVENT_TYPE_SET.has(value)) {
    throw new SessionEventIntegrityError(
      "UnsupportedEventType",
      `Unsupported session event type: ${value}.`
    );
  }
  return value as SessionEventType;
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
      throw new SessionEventIntegrityError("MalformedEvent", `Unexpected event property: ${name}.`);
    }
  }
  if (expected.size > 0) {
    throw new SessionEventIntegrityError(
      "MalformedEvent",
      `Missing event properties: ${[...expected].sort().join(", ")}.`
    );
  }
  return object;
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SessionEventIntegrityError("MalformedEvent", `${name} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new SessionEventIntegrityError("MalformedEvent", `${name} must be a non-empty string.`);
  }
  return value;
}

function requireSafeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new SessionEventIntegrityError(
      "MalformedEvent",
      `${name} must be a positive safe integer.`
    );
  }
  return value as number;
}

export { EMPTY_HASH };
