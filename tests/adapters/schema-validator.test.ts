import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertJsonSchema, validateJsonSchema } from "../../src/adapters/schema-validator.js";

async function schema(name: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(`schemas/v1/${name}.schema.json`), "utf8"));
}

describe("JSON Schema boundary validator", () => {
  it("accepts the versioned work contract fixture", async () => {
    const contract = JSON.parse(
      await readFile(resolve("config/contracts/exact-text-replacement.v1.json"), "utf8")
    ) as unknown;
    expect(validateJsonSchema(contract, await schema("work-contract"))).toEqual({
      valid: true,
      errors: []
    });
  });

  it("rejects unknown fields and invalid event payloads", async () => {
    const hash = "a".repeat(64);
    const event = {
      schemaVersion: "1.0",
      runId: "run-1",
      sequence: 1,
      eventType: "run.created",
      occurredAt: "2026-09-01T00:00:00Z",
      payload: {
        taskId: "task-1",
        descriptorHash: hash,
        parentRunId: null,
        sourceFixtureHash: hash,
        policyVersion: "1.0.0",
        policyHash: hash,
        workContractHash: hash,
        maxDecisions: 1,
        maxToolDispatches: 1,
        assets: {
          promptVersion: "1",
          promptHash: hash,
          skillHashes: [],
          evaluatorRubricVersion: "1",
          evaluatorRubricHash: hash,
          mcpProtocolVersion: "1",
          telemetryVersion: "1",
          toolSchemaVersion: "1",
          sandboxProfile: "local"
        },
        unexpected: true
      },
      previousHash: "0".repeat(64),
      eventHash: hash
    };
    const result = validateJsonSchema(event, await schema("event"));
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("unexpected"))).toBe(true);
  });

  it("fails closed on remote schema references", () => {
    expect(() => validateJsonSchema({}, { $ref: "https://example.invalid/schema.json" })).toThrow(
      "Remote or unsupported schema reference"
    );
  });

  it("validates finite fractional numbers without crashing", () => {
    expect(validateJsonSchema(1.5, { type: "number", minimum: 1, maximum: 2 })).toEqual({
      valid: true,
      errors: []
    });
    expect(validateJsonSchema(0.5, { type: "number", minimum: 1 }).valid).toBe(false);
  });

  it("supports local references, anyOf, allOf, and conditionals", () => {
    const activeConditional: Record<string, unknown> = {
      if: { properties: { kind: { const: "active" } } }
    };
    // biome-ignore lint/suspicious/noThenProperty: JSON Schema defines this keyword.
    activeConditional["then"] = { properties: { count: { minimum: 1 } } };
    const schemaValue = {
      $defs: {
        "a/b": { type: "string", pattern: "^ok$" },
        "tilde~name": { type: "integer" }
      },
      type: "object",
      additionalProperties: false,
      required: ["kind", "value", "count"],
      properties: {
        kind: { enum: ["active", "passive"] },
        value: { $ref: "#/$defs/a~1b" },
        count: { $ref: "#/$defs/tilde~0name" }
      },
      allOf: [activeConditional]
    };
    expect(validateJsonSchema({ kind: "active", value: "ok", count: 1 }, schemaValue).valid).toBe(
      true
    );
    expect(validateJsonSchema({ kind: "active", value: "bad", count: 0 }, schemaValue).valid).toBe(
      false
    );
    expect(
      validateJsonSchema("x", { anyOf: [{ type: "string" }, { type: "integer" }] }).valid
    ).toBe(true);
    expect(
      validateJsonSchema(true, { anyOf: [{ type: "string" }, { type: "integer" }] }).valid
    ).toBe(false);
    expect(() => validateJsonSchema("x", { $ref: "#/$defs/missing", $defs: {} })).toThrow(
      "not found"
    );
  });

  it("validates string, array, numeric, and object constraints", () => {
    expect(validateJsonSchema("x", { type: "string", minLength: 2 }).valid).toBe(false);
    expect(validateJsonSchema("xxx", { type: "string", maxLength: 2 }).valid).toBe(false);
    expect(validateJsonSchema("bad", { type: "string", pattern: "^ok$" }).valid).toBe(false);
    expect(validateJsonSchema("not-a-date", { type: "string", format: "date-time" }).valid).toBe(
      false
    );
    expect(validateJsonSchema(0, { type: "integer", minimum: 1 }).valid).toBe(false);
    expect(validateJsonSchema(3, { type: "integer", maximum: 2 }).valid).toBe(false);
    expect(validateJsonSchema([], { type: "array", minItems: 1 }).valid).toBe(false);
    expect(validateJsonSchema([1, 2], { type: "array", maxItems: 1 }).valid).toBe(false);
    expect(
      validateJsonSchema([{ a: 1 }, { a: 1 }], { type: "array", uniqueItems: true }).valid
    ).toBe(false);
    expect(validateJsonSchema(["x"], { type: "array", items: { type: "integer" } }).valid).toBe(
      false
    );
    expect(
      validateJsonSchema({}, { type: "object", required: ["x"], properties: { x: {} } }).valid
    ).toBe(false);
    expect(
      validateJsonSchema(
        { extra: true },
        { type: "object", additionalProperties: false, properties: {} }
      ).valid
    ).toBe(false);
    expect(validateJsonSchema({}, { type: "object", minProperties: 1 }).valid).toBe(false);
    expect(validateJsonSchema(null, { type: ["null", "string"] }).valid).toBe(true);
    expect(validateJsonSchema("x", { const: "y" }).valid).toBe(false);
    expect(validateJsonSchema("x", { enum: ["y", "z"] }).valid).toBe(false);
  });

  it("asserts invalid schemas with aggregated errors", () => {
    expect(() => assertJsonSchema({}, { type: "object", required: ["id"] })).toThrow(
      "required property"
    );
    expect(() => validateJsonSchema(1, { type: "unsupported" })).toThrow(
      "Unsupported JSON Schema type"
    );
  });
});
