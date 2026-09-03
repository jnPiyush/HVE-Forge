import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonicalizeJson } from "../../src/core/canonical-json.js";

describe("canonical JSON properties", () => {
  it("is idempotent for bounded JSON-compatible values", () => {
    const jsonValue: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
      value: fc.oneof(
        { depthSize: "small" },
        fc.constant(null),
        fc.boolean(),
        fc.string(),
        fc.integer(),
        fc.array(tie("value"), { maxLength: 5 }),
        fc.dictionary(fc.string(), tie("value"), { maxKeys: 5 })
      )
    })).value;
    fc.assert(
      fc.property(jsonValue, (value) => {
        const once = canonicalizeJson(JSON.stringify(value));
        expect(canonicalizeJson(once)).toBe(once);
      }),
      { numRuns: 500, seed: 20260901 }
    );
  });
});
