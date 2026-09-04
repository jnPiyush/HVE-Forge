import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateJsonSchema } from "../../src/adapters/schema-validator.js";
import { canonicalizeJson } from "../../src/core/canonical-json.js";
import { EMPTY_HASH } from "../../src/core/events.js";
import { createSessionEvent, SESSION_EVENT_TYPES } from "../../src/core/session-events.js";
import { validSessionEventPayload } from "../helpers/session-event-fixtures.js";

async function schema(): Promise<unknown> {
  const bytes = await readFile(resolve("schemas/v2/session-event.schema.json"));
  return JSON.parse(canonicalizeJson(bytes));
}

describe("schema-v2 session event parity", () => {
  it("accepts a schema-valid event for every registered event type", async () => {
    const schemaValue = await schema();
    for (const eventType of SESSION_EVENT_TYPES) {
      const event = createSessionEvent(
        "session-1",
        1,
        {
          eventType,
          occurredAt: "2026-09-03T00:00:00.0000000+00:00",
          payload: validSessionEventPayload(eventType)
        },
        EMPTY_HASH
      );
      const result = validateJsonSchema(event, schemaValue);
      expect({ eventType, ...result }).toEqual({ eventType, valid: true, errors: [] });
    }
  });

  it("rejects an unexpected payload field for a typed event", async () => {
    const schemaValue = await schema();
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
    const polluted = { ...event, payload: { ...event.payload, unexpected: true } };
    const result = validateJsonSchema(polluted, schemaValue);
    expect(result.valid).toBe(false);
  });
});
