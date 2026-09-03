import { createHash } from "node:crypto";

export type CanonicalJsonErrorCode =
  | "MalformedJson"
  | "DuplicateProperty"
  | "UnsupportedNumber"
  | "InvalidUnicode"
  | "DepthLimitExceeded"
  | "SizeLimitExceeded";

export interface CanonicalJsonOptions {
  readonly maxDepth?: number;
  readonly maxBytes?: number;
}

export type JsonScalar = null | boolean | string | number | bigint;
export type JsonValue = JsonScalar | readonly JsonValue[] | { readonly [key: string]: JsonValue };

const DEFAULT_MAX_DEPTH = 64;
const DEFAULT_MAX_BYTES = 1_048_576;
const MIN_INT64 = -(1n << 63n);
const MAX_INT64 = (1n << 63n) - 1n;

export class CanonicalJsonError extends Error {
  public constructor(
    public readonly code: CanonicalJsonErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "CanonicalJsonError";
  }
}

export function canonicalizeJson(
  input: string | Uint8Array,
  options: CanonicalJsonOptions = {}
): string {
  const limits = validateOptions(options);
  if (typeof input === "string") validateUnicodeString(input);
  const bytes = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  if (bytes.byteLength > limits.maxBytes) {
    throw new CanonicalJsonError(
      "SizeLimitExceeded",
      `Input exceeds the ${limits.maxBytes}-byte canonical JSON limit.`
    );
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new CanonicalJsonError("MalformedJson", "Input is not valid UTF-8 JSON.", {
      cause: error
    });
  }

  const value = new Parser(text, limits.maxDepth).parse();
  return serialize(value, true, limits);
}

export function canonicalizeValue(value: JsonValue, options: CanonicalJsonOptions = {}): string {
  return serialize(value, true, validateOptions(options));
}

export function stringifyJsonValue(value: JsonValue, options: CanonicalJsonOptions = {}): string {
  return serialize(value, false, validateOptions(options));
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function validateOptions(options: CanonicalJsonOptions): Required<CanonicalJsonOptions> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1) {
    throw new RangeError("maxDepth must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError("maxBytes must be a positive safe integer.");
  }
  return { maxDepth, maxBytes };
}

function serialize(
  value: JsonValue,
  sortKeys: boolean,
  options: Required<CanonicalJsonOptions>
): string {
  const active = new Set<object>();
  const output = serializeValue(value, 1, options.maxDepth, sortKeys, active);
  if (Buffer.byteLength(output, "utf8") > options.maxBytes) {
    throw new CanonicalJsonError(
      "SizeLimitExceeded",
      `Canonical output exceeds the ${options.maxBytes}-byte limit.`
    );
  }
  return output;
}

function serializeValue(
  value: JsonValue,
  depth: number,
  maxDepth: number,
  sortKeys: boolean,
  active: Set<object>
): string {
  if (depth > maxDepth) {
    throw new CanonicalJsonError(
      "DepthLimitExceeded",
      `JSON depth exceeds the configured limit of ${maxDepth}.`
    );
  }
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return escapeString(value);
  if (typeof value === "bigint") return serializeInteger(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new CanonicalJsonError(
        "UnsupportedNumber",
        "Canonical JSON v1 supports signed 64-bit integers only."
      );
    }
    return serializeInteger(BigInt(value));
  }
  if (typeof value !== "object") {
    throw new CanonicalJsonError("MalformedJson", "Unsupported JSON value.");
  }
  if (active.has(value)) {
    throw new CanonicalJsonError("MalformedJson", "Cyclic values are not valid JSON.");
  }

  active.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value
        .map((item) => serializeValue(item, depth + 1, maxDepth, sortKeys, active))
        .join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CanonicalJsonError("MalformedJson", "Only plain JSON objects are supported.");
    }
    const record = value as Readonly<Record<string, JsonValue>>;
    const keys = Object.keys(record);
    if (sortKeys) keys.sort(compareOrdinal);
    return `{${keys
      .map(
        (key) =>
          `${escapeString(key)}:${serializeValue(
            record[key] as JsonValue,
            depth + 1,
            maxDepth,
            sortKeys,
            active
          )}`
      )
      .join(",")}}`;
  } finally {
    active.delete(value);
  }
}

function serializeInteger(value: bigint): string {
  if (value < MIN_INT64 || value > MAX_INT64) {
    throw new CanonicalJsonError(
      "UnsupportedNumber",
      "Canonical JSON v1 supports signed 64-bit integers only."
    );
  }
  return value.toString(10);
}

function compareOrdinal(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function escapeString(value: string): string {
  let output = '"';
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (low < 0xdc00 || low > 0xdfff) {
        throw new CanonicalJsonError("InvalidUnicode", "JSON contains an unpaired surrogate.");
      }
      output += unicodeEscape(code) + unicodeEscape(low);
      index++;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      throw new CanonicalJsonError("InvalidUnicode", "JSON contains an unpaired surrogate.");
    }
    switch (code) {
      case 0x08:
        output += "\\b";
        break;
      case 0x09:
        output += "\\t";
        break;
      case 0x0a:
        output += "\\n";
        break;
      case 0x0c:
        output += "\\f";
        break;
      case 0x0d:
        output += "\\r";
        break;
      case 0x22:
        output += "\\u0022";
        break;
      case 0x5c:
        output += "\\\\";
        break;
      default:
        if (
          code < 0x20 ||
          code > 0x7e ||
          code === 0x26 ||
          code === 0x27 ||
          code === 0x2b ||
          code === 0x3c ||
          code === 0x3e
        ) {
          output += unicodeEscape(code);
        } else {
          output += String.fromCharCode(code);
        }
    }
  }
  return `${output}"`;
}

function unicodeEscape(code: number): string {
  return `\\u${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

function validateUnicodeString(value: string): void {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xdc00 && code <= 0xdfff) {
      throw new CanonicalJsonError("InvalidUnicode", "JSON contains an unpaired surrogate.");
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (low < 0xdc00 || low > 0xdfff) {
        throw new CanonicalJsonError("InvalidUnicode", "JSON contains an unpaired surrogate.");
      }
      index++;
    }
  }
}

class Parser {
  private index = 0;

  public constructor(
    private readonly text: string,
    private readonly maxDepth: number
  ) {}

  public parse(): JsonValue {
    try {
      this.skipWhitespace();
      const result = this.parseValue(1);
      this.skipWhitespace();
      if (this.index !== this.text.length) this.malformed("Unexpected trailing content.");
      return result;
    } catch (error) {
      if (error instanceof CanonicalJsonError) throw error;
      throw new CanonicalJsonError("MalformedJson", "Input is not valid JSON.", { cause: error });
    }
  }

  private parseValue(depth: number): JsonValue {
    if (depth > this.maxDepth) {
      throw new CanonicalJsonError(
        "DepthLimitExceeded",
        `JSON depth exceeds the configured limit of ${this.maxDepth}.`
      );
    }
    const current = this.text[this.index];
    switch (current) {
      case "{":
        return this.parseObject(depth);
      case "[":
        return this.parseArray(depth);
      case '"':
        return this.parseString();
      case "t":
        this.consumeKeyword("true");
        return true;
      case "f":
        this.consumeKeyword("false");
        return false;
      case "n":
        this.consumeKeyword("null");
        return null;
      default:
        if (current === "-" || isDigit(current)) return this.parseNumber();
        return this.malformed("Unexpected JSON token.");
    }
  }

  private parseObject(depth: number): Readonly<Record<string, JsonValue>> {
    this.index++;
    this.skipWhitespace();
    const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    const names = new Set<string>();
    if (this.text[this.index] === "}") {
      this.index++;
      return result;
    }
    while (true) {
      if (this.text[this.index] !== '"') this.malformed("Object property name is required.");
      const key = this.parseString();
      if (names.has(key)) {
        throw new CanonicalJsonError("DuplicateProperty", `Duplicate JSON property: ${key}.`);
      }
      names.add(key);
      this.skipWhitespace();
      if (this.text[this.index] !== ":") this.malformed("Object property separator is required.");
      this.index++;
      this.skipWhitespace();
      result[key] = this.parseValue(depth + 1);
      this.skipWhitespace();
      const current = this.text[this.index];
      if (current === "}") {
        this.index++;
        return result;
      }
      if (current !== ",") this.malformed("Object item separator is required.");
      this.index++;
      this.skipWhitespace();
      if (this.text[this.index] === "}") this.malformed("Trailing commas are not allowed.");
    }
  }

  private parseArray(depth: number): readonly JsonValue[] {
    this.index++;
    this.skipWhitespace();
    const result: JsonValue[] = [];
    if (this.text[this.index] === "]") {
      this.index++;
      return result;
    }
    while (true) {
      result.push(this.parseValue(depth + 1));
      this.skipWhitespace();
      const current = this.text[this.index];
      if (current === "]") {
        this.index++;
        return result;
      }
      if (current !== ",") this.malformed("Array item separator is required.");
      this.index++;
      this.skipWhitespace();
      if (this.text[this.index] === "]") this.malformed("Trailing commas are not allowed.");
    }
  }

  private parseString(): string {
    this.index++;
    let result = "";
    while (this.index < this.text.length) {
      const current = this.text[this.index++];
      if (current === '"') return result;
      if (current === undefined || current.charCodeAt(0) < 0x20) {
        this.malformed("Unescaped control character in JSON string.");
      }
      if (current !== "\\") {
        const code = current.charCodeAt(0);
        if (code >= 0xd800 && code <= 0xdbff) {
          const low = this.text.charCodeAt(this.index);
          if (low < 0xdc00 || low > 0xdfff) this.invalidUnicode();
          result += current + this.text[this.index++];
        } else if (code >= 0xdc00 && code <= 0xdfff) {
          this.invalidUnicode();
        } else {
          result += current;
        }
        continue;
      }

      const escaped = this.text[this.index++];
      switch (escaped) {
        case '"':
        case "\\":
        case "/":
          result += escaped;
          break;
        case "b":
          result += "\b";
          break;
        case "f":
          result += "\f";
          break;
        case "n":
          result += "\n";
          break;
        case "r":
          result += "\r";
          break;
        case "t":
          result += "\t";
          break;
        case "u": {
          const code = this.readHexCodeUnit();
          if (code >= 0xdc00 && code <= 0xdfff) this.invalidUnicode();
          if (code >= 0xd800 && code <= 0xdbff) {
            if (this.text.slice(this.index, this.index + 2) !== "\\u") this.invalidUnicode();
            this.index += 2;
            const low = this.readHexCodeUnit();
            if (low < 0xdc00 || low > 0xdfff) this.invalidUnicode();
            result += String.fromCharCode(code, low);
          } else {
            result += String.fromCharCode(code);
          }
          break;
        }
        default:
          this.malformed("Unsupported JSON string escape.");
      }
    }
    return this.malformed("Unterminated JSON string.");
  }

  private readHexCodeUnit(): number {
    const value = this.text.slice(this.index, this.index + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(value)) this.malformed("Invalid Unicode escape.");
    this.index += 4;
    return Number.parseInt(value, 16);
  }

  private parseNumber(): bigint {
    const start = this.index;
    if (this.text[this.index] === "-") this.index++;
    if (this.text[this.index] === "0") {
      this.index++;
      if (isDigit(this.text[this.index])) this.malformed("Leading zeros are not allowed.");
    } else if (isNonZeroDigit(this.text[this.index])) {
      while (isDigit(this.text[this.index])) this.index++;
    } else {
      return this.malformed("Invalid JSON number.");
    }

    if (this.text[this.index] === ".") {
      this.index++;
      if (!isDigit(this.text[this.index])) this.malformed("Invalid JSON fraction.");
      while (isDigit(this.text[this.index])) this.index++;
      this.consumeExponentIfPresent();
      throw new CanonicalJsonError(
        "UnsupportedNumber",
        "Canonical JSON v1 supports signed 64-bit integers only."
      );
    }
    if (this.text[this.index] === "e" || this.text[this.index] === "E") {
      this.consumeExponentIfPresent();
      throw new CanonicalJsonError(
        "UnsupportedNumber",
        "Canonical JSON v1 supports signed 64-bit integers only."
      );
    }

    const value = BigInt(this.text.slice(start, this.index));
    if (value < MIN_INT64 || value > MAX_INT64) {
      throw new CanonicalJsonError(
        "UnsupportedNumber",
        "Canonical JSON v1 supports signed 64-bit integers only."
      );
    }
    return value;
  }

  private consumeExponentIfPresent(): void {
    if (this.text[this.index] !== "e" && this.text[this.index] !== "E") return;
    this.index++;
    if (this.text[this.index] === "+" || this.text[this.index] === "-") this.index++;
    if (!isDigit(this.text[this.index])) this.malformed("Invalid JSON exponent.");
    while (isDigit(this.text[this.index])) this.index++;
  }

  private consumeKeyword(keyword: string): void {
    if (this.text.slice(this.index, this.index + keyword.length) !== keyword) {
      this.malformed("Invalid JSON keyword.");
    }
    this.index += keyword.length;
  }

  private skipWhitespace(): void {
    while (isJsonWhitespace(this.text.charCodeAt(this.index))) this.index++;
  }

  private malformed(message: string): never {
    throw new CanonicalJsonError("MalformedJson", `${message} Offset ${this.index}.`);
  }

  private invalidUnicode(): never {
    throw new CanonicalJsonError("InvalidUnicode", "JSON contains an unpaired surrogate.");
  }
}

function isDigit(value: string | undefined): boolean {
  return value !== undefined && value >= "0" && value <= "9";
}

function isNonZeroDigit(value: string | undefined): boolean {
  return value !== undefined && value >= "1" && value <= "9";
}

function isJsonWhitespace(code: number): boolean {
  return code === 0x09 || code === 0x0a || code === 0x0d || code === 0x20;
}
