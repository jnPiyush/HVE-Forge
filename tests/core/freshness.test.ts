import { describe, expect, it } from "vitest";
import { assertFresh, freshnessMessage, gradeFreshness } from "../../src/core/freshness.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

describe("gradeFreshness", () => {
  it("grades MISSING when no evidence fingerprint was recorded", () => {
    expect(gradeFreshness(null, HASH_A)).toBe("MISSING");
  });

  it("grades FRESH when the recorded fingerprint matches the current one", () => {
    expect(gradeFreshness(HASH_A, HASH_A)).toBe("FRESH");
  });

  it("grades STALE when the recorded fingerprint no longer matches", () => {
    expect(gradeFreshness(HASH_A, HASH_B)).toBe("STALE");
  });

  it("rejects malformed hashes", () => {
    expect(() => gradeFreshness("not-a-hash", HASH_A)).toThrow("recordedFingerprint");
    expect(() => gradeFreshness(HASH_A, "not-a-hash")).toThrow("currentFingerprint");
  });
});

describe("freshnessMessage and assertFresh", () => {
  it("returns a distinct actionable message per grade", () => {
    const messages = new Set(
      ["FRESH", "STALE", "MISSING"].map((grade) => freshnessMessage(grade as never))
    );
    expect(messages.size).toBe(3);
  });

  it("only FRESH passes assertFresh", () => {
    expect(() => assertFresh("FRESH")).not.toThrow();
    expect(() => assertFresh("STALE")).toThrow();
    expect(() => assertFresh("MISSING")).toThrow();
  });
});
