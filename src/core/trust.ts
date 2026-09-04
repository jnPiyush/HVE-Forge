import { sha256Hex } from "./canonical-json.js";

export type ContentOrigin =
  | "distribution_instruction"
  | "operator_task"
  | "workspace_instruction"
  | "workspace_file"
  | "search_result"
  | "tool_result"
  | "model_output";

export type TrustClassification =
  | "trusted_distribution"
  | "operator_request"
  | "untrusted_repository"
  | "untrusted_tool"
  | "untrusted_model";

export interface TrustEnvelope {
  readonly schemaVersion: "2.0";
  readonly origin: ContentOrigin;
  readonly trust: TrustClassification;
  readonly sourceReference: string;
  readonly contentHash: string;
  readonly includedHash: string;
  readonly byteLength: number;
  readonly includedByteLength: number;
  readonly truncated: boolean;
  readonly content: string;
}

export interface TrustEnvelopeInput {
  readonly origin: ContentOrigin;
  readonly sourceReference: string;
  readonly content: string;
  readonly maximumBytes: number;
}

const MAXIMUM_SOURCE_BYTES = 4_194_304;
const MAXIMUM_INCLUDED_BYTES = 1_048_576;
const HASH = /^[a-f0-9]{64}$/;
const ORIGIN_TRUST: Readonly<Record<ContentOrigin, TrustClassification>> = Object.freeze({
  distribution_instruction: "trusted_distribution",
  operator_task: "operator_request",
  workspace_instruction: "untrusted_repository",
  workspace_file: "untrusted_repository",
  search_result: "untrusted_repository",
  tool_result: "untrusted_tool",
  model_output: "untrusted_model"
});
const FIELDS = [
  "schemaVersion",
  "origin",
  "trust",
  "sourceReference",
  "contentHash",
  "includedHash",
  "byteLength",
  "includedByteLength",
  "truncated",
  "content"
] as const;
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

export function createTrustEnvelope(input: TrustEnvelopeInput): TrustEnvelope {
  const origin = requireOrigin(input.origin);
  const sourceReference = requireSourceReference(input.sourceReference);
  if (typeof input.content !== "string") throw new TypeError("Trust content must be a string.");
  const maximumBytes = requireMaximumBytes(input.maximumBytes);
  const bytes = Buffer.from(input.content, "utf8");
  if (bytes.byteLength > MAXIMUM_SOURCE_BYTES) {
    throw new RangeError(`Trust content exceeds ${MAXIMUM_SOURCE_BYTES} bytes.`);
  }
  const included = validUtf8Prefix(bytes, maximumBytes);
  return freezeEnvelope({
    schemaVersion: "2.0",
    origin,
    trust: ORIGIN_TRUST[origin],
    sourceReference,
    contentHash: sha256Hex(bytes),
    includedHash: sha256Hex(included),
    byteLength: bytes.byteLength,
    includedByteLength: included.byteLength,
    truncated: included.byteLength < bytes.byteLength,
    content: STRICT_UTF8.decode(included)
  });
}

export function parseTrustEnvelope(value: unknown, expectedOrigin?: ContentOrigin): TrustEnvelope {
  const root = requireObject(value);
  requireExactFields(root);
  if (root["schemaVersion"] !== "2.0") throw new TypeError("Trust schema version is invalid.");
  const origin = requireOrigin(root["origin"]);
  if (expectedOrigin !== undefined && origin !== expectedOrigin) {
    throw new TypeError(`Trust envelope origin must be ${expectedOrigin}.`);
  }
  const expectedTrust = ORIGIN_TRUST[origin];
  const trust = root["trust"];
  if (trust !== expectedTrust) {
    throw new TypeError("Trust classification does not match content origin.");
  }
  const sourceReference = requireSourceReference(root["sourceReference"]);
  const contentHash = requireHash(root["contentHash"], "contentHash");
  const includedHash = requireHash(root["includedHash"], "includedHash");
  const byteLength = requireInteger(root["byteLength"], "byteLength", 0, MAXIMUM_SOURCE_BYTES);
  const includedByteLength = requireInteger(
    root["includedByteLength"],
    "includedByteLength",
    0,
    MAXIMUM_INCLUDED_BYTES
  );
  if (typeof root["truncated"] !== "boolean") throw new TypeError("truncated must be boolean.");
  if (typeof root["content"] !== "string") throw new TypeError("content must be a string.");
  const content = root["content"];
  const included = Buffer.from(content, "utf8");
  if (included.byteLength !== includedByteLength || sha256Hex(included) !== includedHash) {
    throw new TypeError("Included trust content identity is invalid.");
  }
  if (includedByteLength > byteLength || root["truncated"] !== includedByteLength < byteLength) {
    throw new TypeError("Trust content lengths and truncation flag are inconsistent.");
  }
  if (!root["truncated"] && contentHash !== includedHash) {
    throw new TypeError("Complete trust content hash is invalid.");
  }
  return freezeEnvelope({
    schemaVersion: "2.0",
    origin,
    trust: expectedTrust,
    sourceReference,
    contentHash,
    includedHash,
    byteLength,
    includedByteLength,
    truncated: root["truncated"],
    content
  });
}

function validUtf8Prefix(bytes: Uint8Array, maximumBytes: number): Uint8Array {
  if (bytes.byteLength <= maximumBytes) return bytes;
  let end = maximumBytes;
  while (end > 0) {
    const candidate = bytes.subarray(0, end);
    try {
      STRICT_UTF8.decode(candidate);
      return candidate;
    } catch {
      end -= 1;
    }
  }
  return bytes.subarray(0, 0);
}

function freezeEnvelope(envelope: TrustEnvelope): TrustEnvelope {
  return Object.freeze({ ...envelope });
}

function requireObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Trust envelope must be an object.");
  }
  return value as Record<string, unknown>;
}

function requireExactFields(value: Record<string, unknown>): void {
  const expected = new Set<string>(FIELDS);
  for (const key of Object.keys(value)) {
    if (!expected.delete(key)) throw new TypeError(`Unexpected trust envelope field: ${key}.`);
  }
  if (expected.size > 0) throw new TypeError(`Missing trust envelope fields: ${[...expected]}.`);
}

function requireOrigin(value: unknown): ContentOrigin {
  if (typeof value !== "string" || !Object.hasOwn(ORIGIN_TRUST, value)) {
    throw new TypeError(`Unknown content origin: ${String(value)}.`);
  }
  return value as ContentOrigin;
}

function requireSourceReference(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 1_024 ||
    [...value].some((character) => character.charCodeAt(0) < 0x20)
  ) {
    throw new TypeError("sourceReference must contain 1 to 1024 printable characters.");
  }
  return value;
}

function requireMaximumBytes(value: unknown): number {
  return requireInteger(value, "maximumBytes", 1, MAXIMUM_INCLUDED_BYTES);
}

function requireHash(value: unknown, name: string): string {
  if (typeof value !== "string" || !HASH.test(value)) throw new TypeError(`${name} is invalid.`);
  return value;
}

function requireInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new TypeError(`${name} must be an integer in ${minimum}..${maximum}.`);
  }
  return value as number;
}
