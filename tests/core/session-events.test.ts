import { describe, expect, it } from "vitest";
import { EMPTY_HASH } from "../../src/core/events.js";
import {
  createSessionEvent,
  parseSessionEvent,
  SESSION_EVENT_SCHEMA_VERSION,
  SESSION_EVENT_TYPES,
  SessionEventIntegrityError,
  serializeSessionEvent,
  sessionSemanticTraceHash,
  validateSessionEvent
} from "../../src/core/session-events.js";
import { validSessionEventPayload } from "../helpers/session-event-fixtures.js";

describe("session event envelope", () => {
  it("creates a hash-chained event and validates it against the expected chain state", () => {
    const first = createSessionEvent(
      "session-1",
      1,
      {
        eventType: "session.created",
        occurredAt: "2026-09-03T00:00:00.0000000+00:00",
        payload: validSessionEventPayload("session.created")
      },
      EMPTY_HASH
    );
    expect(first.schemaVersion).toBe(SESSION_EVENT_SCHEMA_VERSION);
    expect(() => validateSessionEvent(first, "session-1", 1, EMPTY_HASH)).not.toThrow();
    expect(() => validateSessionEvent(first, "session-2", 1, EMPTY_HASH)).toThrow("does not match");
    expect(() => validateSessionEvent(first, "session-1", 2, EMPTY_HASH)).toThrow(
      "Expected event sequence"
    );
    expect(() => validateSessionEvent(first, "session-1", 1, "b".repeat(64))).toThrow(
      "does not reference the expected chain head"
    );
    const tampered = { ...first, eventHash: "c".repeat(64) };
    expect(() => validateSessionEvent(tampered, "session-1", 1, EMPTY_HASH)).toThrow(
      "hash is invalid"
    );
  });

  it("round-trips through serialization and rejects malformed records", () => {
    const event = createSessionEvent(
      "session-1",
      1,
      {
        eventType: "session.created",
        occurredAt: "2026-09-03T00:00:00.0000000+00:00",
        payload: validSessionEventPayload("session.created")
      },
      EMPTY_HASH
    );
    const serialized = serializeSessionEvent(event);
    expect(parseSessionEvent(serialized)).toEqual(event);
    expect(() => parseSessionEvent("{not json")).toThrow(SessionEventIntegrityError);
    expect(() =>
      parseSessionEvent(JSON.stringify({ ...JSON.parse(serialized), extra: 1 }))
    ).toThrow("Unexpected event property");
  });

  it("rejects unknown event types, schemas, and invalid identifiers", () => {
    expect(() =>
      createSessionEvent(
        "session-1",
        1,
        {
          eventType: "unknown.event",
          occurredAt: "2026-09-03T00:00:00.0000000+00:00",
          payload: {}
        },
        EMPTY_HASH
      )
    ).toThrow("Unsupported session event type");
    expect(() =>
      createSessionEvent(
        "bad id!",
        1,
        {
          eventType: "session.created",
          occurredAt: "2026-09-03T00:00:00.0000000+00:00",
          payload: validSessionEventPayload("session.created")
        },
        EMPTY_HASH
      )
    ).toThrow("unsupported characters");
    const event = createSessionEvent(
      "session-1",
      1,
      {
        eventType: "session.created",
        occurredAt: "2026-09-03T00:00:00.0000000+00:00",
        payload: validSessionEventPayload("session.created")
      },
      EMPTY_HASH
    );
    expect(() =>
      validateSessionEvent({ ...event, schemaVersion: "1.0" }, "session-1", 1, EMPTY_HASH)
    ).toThrow("Unsupported session event schema");
  });

  it("produces a semantic trace hash that excludes only physical fields", () => {
    const event = createSessionEvent(
      "session-1",
      1,
      {
        eventType: "session.created",
        occurredAt: "2026-09-03T00:00:00.0000000+00:00",
        payload: validSessionEventPayload("session.created")
      },
      EMPTY_HASH
    );
    const other = createSessionEvent(
      "session-2",
      1,
      {
        eventType: "session.created",
        occurredAt: "2026-09-03T01:00:00.0000000+00:00",
        payload: validSessionEventPayload("session.created")
      },
      EMPTY_HASH
    );
    expect(sessionSemanticTraceHash([event])).toBe(sessionSemanticTraceHash([other]));
  });

  it("defines exactly the twelve schema-v2 event types", () => {
    expect(SESSION_EVENT_TYPES).toHaveLength(12);
  });
});
