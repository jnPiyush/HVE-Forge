import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalizeJson } from "../../src/core/canonical-json.js";
import {
  createRunEvent,
  EMPTY_HASH,
  EVENT_TYPES,
  EventIntegrityError,
  parseRunEvent,
  semanticTraceHash,
  serializeRunEvent,
  validateRunEvent
} from "../../src/core/events.js";
import { validEventPayload } from "../helpers/event-fixtures.js";

const timestamp = "2026-09-01T00:00:00.0000000+00:00";

describe("event integrity", () => {
  it("creates, serializes, parses, and validates an event", () => {
    const event = createRunEvent(
      "run-1",
      1,
      {
        eventType: "run.created",
        occurredAt: timestamp,
        payload: validEventPayload("run.created")
      },
      EMPTY_HASH
    );

    const parsed = parseRunEvent(serializeRunEvent(event));
    expect(() => validateRunEvent(parsed, "run-1", 1, EMPTY_HASH)).not.toThrow();
    expect(parsed).toEqual(event);
  });

  it.each([
    ["schemaVersion", "2.0", "UnsupportedSchema"],
    ["runId", "other", "RunMismatch"],
    ["sequence", 2, "SequenceMismatch"],
    ["previousHash", "b".repeat(64), "PreviousHashMismatch"],
    ["eventHash", "b".repeat(64), "EventHashMismatch"]
  ] as const)("rejects a changed %s", (field, value, code) => {
    const event = createRunEvent(
      "run-1",
      1,
      {
        eventType: "run.created",
        occurredAt: timestamp,
        payload: validEventPayload("run.created")
      },
      EMPTY_HASH
    );
    const changed = { ...event, [field]: value };
    expect(() => validateRunEvent(changed, "run-1", 1, EMPTY_HASH)).toThrowError(
      expect.objectContaining({ code })
    );
  });

  it("rejects unknown event types and malformed envelopes", () => {
    expect(() =>
      createRunEvent(
        "run-1",
        1,
        { eventType: "unknown", occurredAt: timestamp, payload: {} },
        EMPTY_HASH
      )
    ).toThrow(EventIntegrityError);
    expect(() => parseRunEvent("{}")).toThrowError(
      expect.objectContaining({ code: "MalformedEvent" })
    );
  });

  it("computes a semantic trace independent of event hashes and timestamps", () => {
    const first = createRunEvent(
      "run-1",
      1,
      {
        eventType: "run.created",
        occurredAt: timestamp,
        payload: validEventPayload("run.created")
      },
      EMPTY_HASH
    );
    const second = createRunEvent(
      "run-2",
      1,
      {
        eventType: "run.created",
        occurredAt: "2026-09-02T00:00:00.0000000+00:00",
        payload: validEventPayload("run.created", { descriptorHash: "b".repeat(64) })
      },
      EMPTY_HASH
    );

    expect(semanticTraceHash([first])).toBe(semanticTraceHash([second]));
  });

  it.each([
    ["", 1, timestamp, EMPTY_HASH],
    ["bad id", 1, timestamp, EMPTY_HASH],
    ["run-1", 0, timestamp, EMPTY_HASH],
    ["run-1", 1.5, timestamp, EMPTY_HASH],
    ["run-1", 1, "2026-09-01T00:00:00Z", EMPTY_HASH],
    ["run-1", 1, timestamp, "bad"]
  ])("rejects invalid event creation inputs", (runId, sequence, occurredAt, previousHash) => {
    expect(() =>
      createRunEvent(
        runId,
        sequence,
        { eventType: "run.created", occurredAt, payload: {} },
        previousHash
      )
    ).toThrow();
  });

  it("rejects missing, extra, invalid payload, and unsafe sequence envelope values", () => {
    const event = createRunEvent(
      "run-1",
      1,
      {
        eventType: "run.created",
        occurredAt: timestamp,
        payload: validEventPayload("run.created")
      },
      EMPTY_HASH
    );
    const plain = JSON.parse(serializeRunEvent(event)) as Record<string, unknown>;
    const { eventHash: _removed, ...missing } = plain;
    expect(() => parseRunEvent(JSON.stringify(missing))).toThrowError(
      expect.objectContaining({ code: "MalformedEvent" })
    );
    expect(() => parseRunEvent(JSON.stringify({ ...plain, extra: true }))).toThrowError(
      expect.objectContaining({ code: "MalformedEvent" })
    );
    expect(() => parseRunEvent(JSON.stringify({ ...plain, payload: [] }))).toThrowError(
      expect.objectContaining({ code: "MalformedEvent" })
    );
    expect(() => parseRunEvent(JSON.stringify({ ...plain, sequence: 0 }))).toThrowError(
      expect.objectContaining({ code: "MalformedEvent" })
    );
  });

  it.each(EVENT_TYPES)("rejects malformed %s payload fields", (eventType) => {
    const payload = validEventPayload(eventType);
    const entries = Object.entries(payload);
    const [firstName, firstValue] = entries[0] as [string, unknown];
    const missing = Object.fromEntries(entries.slice(1));
    const wrongType = { ...payload, [firstName]: invalidValue(firstValue) };
    expect(() =>
      createRunEvent("run-1", 1, { eventType, occurredAt: timestamp, payload: missing }, EMPTY_HASH)
    ).toThrowError(expect.objectContaining({ code: "MalformedEvent" }));
    expect(() =>
      createRunEvent(
        "run-1",
        1,
        { eventType, occurredAt: timestamp, payload: { ...payload, unexpected: true } },
        EMPTY_HASH
      )
    ).toThrowError(expect.objectContaining({ code: "MalformedEvent" }));
    expect(() =>
      createRunEvent(
        "run-1",
        1,
        { eventType, occurredAt: timestamp, payload: wrongType },
        EMPTY_HASH
      )
    ).toThrowError(expect.objectContaining({ code: "MalformedEvent" }));
  });

  it("validates and canonically reproduces a frozen .NET event", async () => {
    const line = (
      await readFile(resolve("tests/fixtures/dotnet-oracle-v1/state-transition.json"), "utf8")
    ).trimEnd();
    const event = parseRunEvent(line);
    expect(() =>
      validateRunEvent(
        event,
        "run-1355dc83cdda4a01ac28396280d6e02d",
        2,
        "f8f5f26a8b49e29cb328a4fa5ad0da08e1dedafa4dedd1f52cde92bc73481d66"
      )
    ).not.toThrow();
    expect(canonicalizeJson(serializeRunEvent(event))).toBe(canonicalizeJson(line));
  });
});

function invalidValue(value: unknown): null | boolean | string | number {
  if (value === null) return false;
  if (typeof value === "string") return 1;
  if (typeof value === "number") return "invalid";
  if (typeof value === "boolean") return "invalid";
  return "invalid";
}
