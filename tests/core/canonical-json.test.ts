import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CanonicalJsonError,
  canonicalizeJson,
  canonicalizeValue,
  sha256Hex
} from "../../src/core/canonical-json.js";

interface Vector {
  readonly name: string;
  readonly input: string;
  readonly expected?: string;
  readonly sha256?: string;
  readonly error?: string;
}

describe("canonical JSON", () => {
  it("matches every frozen valid vector", async () => {
    const path = resolve("tests/fixtures/canonical-json-v1/vectors.json");
    const vectors = JSON.parse(await readFile(path, "utf8")) as {
      valid: Vector[];
    };

    for (const vector of vectors.valid) {
      const actual = canonicalizeJson(vector.input);
      expect(actual, vector.name).toBe(vector.expected);
      expect(sha256Hex(actual), vector.name).toBe(vector.sha256);
    }
  });

  it("returns the frozen error code for every invalid vector", async () => {
    const path = resolve("tests/fixtures/canonical-json-v1/vectors.json");
    const vectors = JSON.parse(await readFile(path, "utf8")) as {
      invalid: Vector[];
    };

    for (const vector of vectors.invalid) {
      expect(() => canonicalizeJson(vector.input), vector.name).toThrowError(
        expect.objectContaining({ code: vector.error })
      );
    }
  });

  it.each([
    ['{"n":9223372036854775808}', "UnsupportedNumber"],
    ['{"n":-9223372036854775809}', "UnsupportedNumber"],
    ['{"n":01}', "MalformedJson"],
    ['{"x":true} trailing', "MalformedJson"]
  ])("rejects invalid numeric or trailing input", (input, code) => {
    expect(() => canonicalizeJson(input)).toThrowError(expect.objectContaining({ code }));
  });

  it("enforces byte and depth limits", () => {
    expect(() => canonicalizeJson('{"value":1}', { maxBytes: 4 })).toThrowError(
      expect.objectContaining({ code: "SizeLimitExceeded" })
    );
    expect(() => canonicalizeJson("[[1]]", { maxDepth: 2 })).toThrowError(
      expect.objectContaining({ code: "DepthLimitExceeded" })
    );
  });

  it("rejects malformed UTF-8", () => {
    expect(() => canonicalizeJson(Uint8Array.from([0xc3, 0x28]))).toThrowError(
      expect.objectContaining({ code: "MalformedJson" })
    );
  });

  it("rejects literal unpaired surrogates before UTF-8 encoding", () => {
    const high = String.fromCharCode(0xd800);
    const low = String.fromCharCode(0xdc00);
    expect(() => canonicalizeJson(`{"value":"${high}"}`)).toThrowError(
      expect.objectContaining({ code: "InvalidUnicode" })
    );
    expect(() => canonicalizeJson(`{"value":"${low}"}`)).toThrowError(
      expect.objectContaining({ code: "InvalidUnicode" })
    );
  });

  it("canonicalizes typed values without precision loss", () => {
    const result = canonicalizeValue({ z: 1n, a: [true, null, -2n] });
    expect(result).toBe('{"a":[true,null,-2],"z":1}');
  });

  it("exposes stable typed errors", () => {
    const error = new CanonicalJsonError("MalformedJson", "bad input");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("MalformedJson");
  });

  it("rejects invalid options and unsupported typed values", () => {
    expect(() => canonicalizeJson("{}", { maxDepth: 0 })).toThrow(RangeError);
    expect(() => canonicalizeJson("{}", { maxBytes: 0 })).toThrow(RangeError);
    expect(() => canonicalizeValue({ value: 1.5 })).toThrowError(
      expect.objectContaining({ code: "UnsupportedNumber" })
    );
    expect(() => canonicalizeValue({ value: Number.MAX_SAFE_INTEGER + 1 })).toThrowError(
      expect.objectContaining({ code: "UnsupportedNumber" })
    );
    expect(() => canonicalizeValue({ value: 1n << 63n })).toThrowError(
      expect.objectContaining({ code: "UnsupportedNumber" })
    );
    expect(() => canonicalizeValue(new Date() as never)).toThrowError(
      expect.objectContaining({ code: "MalformedJson" })
    );
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    expect(() => canonicalizeValue(cyclic as never)).toThrowError(
      expect.objectContaining({ code: "MalformedJson" })
    );
  });

  it.each([
    "tru",
    '{"x" 1}',
    '{"x":1,}',
    '{"x":1 "y":2}',
    "[1,]",
    "[1 2]",
    '"\\x"',
    '"\\u12xz"',
    "1.",
    "1e",
    "-",
    '"unterminated'
  ])("rejects malformed parser input %s", (input) => {
    expect(() => canonicalizeJson(input)).toThrow(CanonicalJsonError);
  });

  it("normalizes standard escapes, Unicode, and insertion-order serialization", async () => {
    const { stringifyJsonValue } = await import("../../src/core/canonical-json.js");
    expect(canonicalizeJson('{"x":"\\b\\f\\n\\r\\t\\/"}')).toContain('"x":"\\b\\f\\n\\r\\t/"');
    expect(canonicalizeJson('{"x":"\\uD83D\\uDE00"}')).toBe('{"x":"\\uD83D\\uDE00"}');
    expect(stringifyJsonValue({ z: 1, a: 2 })).toBe('{"z":1,"a":2}');
  });
});
