import { canonicalizeValue, type JsonValue } from "../core/canonical-json.js";
import { parseTrustEnvelope, type TrustEnvelope } from "../core/trust.js";

export interface ModelContextMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly origin: TrustEnvelope["origin"];
  readonly contentHash: string;
}

export interface ContextAssemblyResult {
  readonly messages: readonly ModelContextMessage[];
  readonly omittedReferences: readonly string[];
  readonly totalInputBytes: number;
  readonly truncated: boolean;
}

export interface ContextAssemblyLimits {
  readonly maxParts: number;
  readonly maxTotalBytes: number;
}

const MAXIMUM_PARTS = 1_000;
const MAXIMUM_TOTAL_BYTES = 4_194_304;

export function assembleModelContext(
  values: readonly unknown[],
  limitsValue: ContextAssemblyLimits
): ContextAssemblyResult {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAXIMUM_PARTS) {
    throw new TypeError(`Context must contain 1 to ${MAXIMUM_PARTS} parts.`);
  }
  const limits = parseLimits(limitsValue);
  const parts = values.map((value) => parseTrustEnvelope(value));
  if (parts[0]?.origin !== "distribution_instruction") {
    throw new TypeError("The first context part must be a distribution instruction.");
  }
  if (parts.slice(1).some((part) => part.origin === "distribution_instruction")) {
    throw new TypeError("Context may contain only one distribution instruction.");
  }

  const messages: ModelContextMessage[] = [];
  const omittedReferences: string[] = [];
  let totalInputBytes = 0;
  for (const part of parts) {
    const message = toMessage(part);
    const messageBytes = Buffer.byteLength(message.content, "utf8");
    if (
      messages.length >= limits.maxParts ||
      totalInputBytes + messageBytes > limits.maxTotalBytes
    ) {
      if (part.origin === "distribution_instruction") {
        throw new RangeError("Distribution instruction exceeds the model context budget.");
      }
      omittedReferences.push(part.sourceReference);
      continue;
    }
    messages.push(Object.freeze(message));
    totalInputBytes += messageBytes;
  }
  return Object.freeze({
    messages: Object.freeze([...messages]),
    omittedReferences: Object.freeze([...omittedReferences]),
    totalInputBytes,
    truncated: omittedReferences.length > 0 || parts.some((part) => part.truncated)
  });
}

function toMessage(part: TrustEnvelope): ModelContextMessage {
  if (part.origin === "distribution_instruction") {
    return {
      role: "user",
      content: `DISTRIBUTION_INSTRUCTION\n${part.content}`,
      origin: part.origin,
      contentHash: part.contentHash
    };
  }
  const serialized = canonicalizeValue({
    origin: part.origin,
    trust: part.trust,
    sourceReference: part.sourceReference,
    contentHash: part.contentHash,
    includedHash: part.includedHash,
    byteLength: part.byteLength,
    includedByteLength: part.includedByteLength,
    truncated: part.truncated,
    content: part.content
  } satisfies JsonValue);
  if (part.origin === "model_output") {
    return {
      role: "assistant",
      content: `MODEL_OUTPUT_DATA_START\n${serialized}\nMODEL_OUTPUT_DATA_END`,
      origin: part.origin,
      contentHash: part.contentHash
    };
  }
  const marker = part.origin === "operator_task" ? "OPERATOR_TASK_DATA" : "UNTRUSTED_DATA";
  return {
    role: "user",
    content: `${marker}_START\n${serialized}\n${marker}_END`,
    origin: part.origin,
    contentHash: part.contentHash
  };
}

function parseLimits(value: ContextAssemblyLimits): ContextAssemblyLimits {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Context assembly limits must be an object.");
  }
  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    !keys.includes("maxParts") ||
    !keys.includes("maxTotalBytes") ||
    !Number.isSafeInteger(value.maxParts) ||
    value.maxParts < 1 ||
    value.maxParts > MAXIMUM_PARTS ||
    !Number.isSafeInteger(value.maxTotalBytes) ||
    value.maxTotalBytes < 1 ||
    value.maxTotalBytes > MAXIMUM_TOTAL_BYTES
  ) {
    throw new TypeError("Context assembly limits are invalid.");
  }
  return Object.freeze({ maxParts: value.maxParts, maxTotalBytes: value.maxTotalBytes });
}
