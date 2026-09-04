import { canonicalizeValue, type JsonValue, sha256Hex } from "../core/canonical-json.js";
import type { ToolDescriptor } from "../core/tool-registry.js";
import type { ContentOrigin } from "../core/trust.js";
import type { ModelContextMessage } from "./context-assembler.js";
import type { CancellationSignal } from "./tool-dispatcher.js";

export type ModelFinishReason =
  | "completed"
  | "tool_calls"
  | "length"
  | "cancelled"
  | "content_filter"
  | "error";

export type ModelCostMode = "host_managed" | "metered";

export interface ModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  readonly reasoningTokens: number;
  readonly costMode: ModelCostMode;
  readonly costMinorUnits: number | null;
}

export interface ModelToolCall {
  readonly callId: string;
  readonly toolId: string;
  readonly arguments: JsonValue;
}

export interface ModelTurnRequest {
  readonly schemaVersion: "2.0";
  readonly sessionId: string;
  readonly turnNumber: number;
  readonly messages: readonly ModelContextMessage[];
  readonly tools: readonly ToolDescriptor[];
  readonly maxOutputTokens: number;
  readonly requestHash: string;
}

export interface ModelTurn {
  readonly schemaVersion: "2.0";
  readonly turnId: string;
  readonly assistantText: string;
  readonly toolCalls: readonly ModelToolCall[];
  readonly usage: ModelUsage;
  readonly finishReason: ModelFinishReason;
  readonly providerId: string;
  readonly modelId: string;
  readonly requestHash: string;
  readonly responseHash: string;
}

export interface AtomicModelProvider {
  readonly id: string;
  completeTurn(request: ModelTurnRequest, cancellation: CancellationSignal): Promise<unknown>;
}

export type ModelProviderErrorCode = "CANCELLED" | "INVALID_REQUEST" | "INVALID_TURN" | "TIMEOUT";

export class ModelProviderError extends Error {
  public constructor(
    public readonly code: ModelProviderErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "ModelProviderError";
  }
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TOOL_ID = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const HASH = /^[a-f0-9]{64}$/;
const ORIGINS = new Set<ContentOrigin>([
  "distribution_instruction",
  "operator_task",
  "workspace_instruction",
  "workspace_file",
  "search_result",
  "tool_result",
  "model_output"
]);
const FINISH_REASONS = new Set<ModelFinishReason>([
  "completed",
  "tool_calls",
  "length",
  "cancelled",
  "content_filter",
  "error"
]);
const MAXIMUM_MESSAGES = 1_000;
const MAXIMUM_TOOLS = 64;
const MAXIMUM_TOOL_CALLS = 16;
const MAXIMUM_TEXT_BYTES = 65_536;
const MAXIMUM_TOKENS = 100_000_000;

export function createModelTurnRequest(value: unknown): ModelTurnRequest {
  const root = requireObject(value, "Model turn request");
  const sessionId = requireIdentifier(root["sessionId"], "sessionId");
  const turnNumber = requireInteger(root["turnNumber"], "turnNumber", 1, Number.MAX_SAFE_INTEGER);
  const maxOutputTokens = requireInteger(
    root["maxOutputTokens"],
    "maxOutputTokens",
    1,
    MAXIMUM_TOKENS
  );
  const messagesValue = root["messages"];
  if (
    !Array.isArray(messagesValue) ||
    messagesValue.length === 0 ||
    messagesValue.length > MAXIMUM_MESSAGES
  ) {
    throw new ModelProviderError("INVALID_REQUEST", "Model request messages are invalid.");
  }
  const messages = messagesValue.map(parseMessage);
  if (messages[0]?.origin !== "distribution_instruction") {
    throw new ModelProviderError(
      "INVALID_REQUEST",
      "Model request must start with the distribution instruction."
    );
  }
  const toolsValue = root["tools"];
  if (!Array.isArray(toolsValue) || toolsValue.length > MAXIMUM_TOOLS) {
    throw new ModelProviderError("INVALID_REQUEST", "Model request tools are invalid.");
  }
  const tools = toolsValue.map(parseToolDescriptor);
  if (new Set(tools.map((tool) => tool.toolId)).size !== tools.length) {
    throw new ModelProviderError("INVALID_REQUEST", "Model request tool IDs must be unique.");
  }
  const body = {
    schemaVersion: "2.0" as const,
    sessionId,
    turnNumber,
    messages,
    tools,
    maxOutputTokens
  };
  const requestHash = sha256Hex(canonicalizeValue(body as unknown as JsonValue));
  return Object.freeze({
    ...body,
    messages: Object.freeze(messages),
    tools: Object.freeze(tools),
    requestHash
  });
}

export async function completeValidatedTurn(
  provider: AtomicModelProvider,
  request: ModelTurnRequest,
  cancellation: CancellationSignal,
  timeoutMilliseconds = 120_000
): Promise<ModelTurn> {
  if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1) {
    throw new RangeError("Model timeout must be a positive safe integer.");
  }
  if (isCancelled(cancellation)) {
    throw new ModelProviderError("CANCELLED", "Model request was cancelled before send.");
  }
  const normalizedRequest = createModelTurnRequest(request);
  if (normalizedRequest.requestHash !== request.requestHash) {
    throw new ModelProviderError("INVALID_REQUEST", "Model request hash is invalid.");
  }
  const timeout = AbortSignal.timeout(timeoutMilliseconds);
  const abortSignal =
    cancellation.abortSignal === undefined
      ? timeout
      : AbortSignal.any([cancellation.abortSignal, timeout]);
  const providerCancellation: CancellationSignal = {
    get isCancellationRequested() {
      return cancellation.isCancellationRequested !== false || abortSignal.aborted;
    },
    abortSignal
  };
  let rejectTimeout: ((reason: ModelProviderError) => void) | undefined;
  const timeoutFailure = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const onAbort = () => {
    rejectTimeout?.(
      timeout.aborted
        ? new ModelProviderError("TIMEOUT", "Model request exceeded its timeout.")
        : new ModelProviderError("CANCELLED", "Model request was cancelled.")
    );
  };
  abortSignal.addEventListener("abort", onAbort, { once: true });
  let raw: unknown;
  try {
    raw = await Promise.race([
      provider.completeTurn(normalizedRequest, providerCancellation),
      timeoutFailure
    ]);
  } finally {
    abortSignal.removeEventListener("abort", onAbort);
  }
  if (isCancelled(cancellation)) {
    throw new ModelProviderError("CANCELLED", "Model request was cancelled.");
  }
  return parseModelTurn(raw, normalizedRequest, provider.id);
}

function isCancelled(cancellation: CancellationSignal): boolean {
  return (
    cancellation.isCancellationRequested !== false || cancellation.abortSignal?.aborted === true
  );
}

function parseModelTurn(
  value: unknown,
  request: ModelTurnRequest,
  expectedProviderId: string
): ModelTurn {
  try {
    const root = requireExactObject(value, [
      "schemaVersion",
      "turnId",
      "assistantText",
      "toolCalls",
      "usage",
      "finishReason",
      "providerId",
      "modelId"
    ]);
    if (root["schemaVersion"] !== "2.0") throw new TypeError("schemaVersion is invalid.");
    const turnId = requireIdentifier(root["turnId"], "turnId");
    const assistantText = requireBoundedText(root["assistantText"], "assistantText");
    const providerId = requireIdentifier(root["providerId"], "providerId");
    if (providerId !== expectedProviderId) throw new TypeError("providerId is inconsistent.");
    const modelId = requireIdentifier(root["modelId"], "modelId");
    const finishReason = root["finishReason"];
    if (
      typeof finishReason !== "string" ||
      !FINISH_REASONS.has(finishReason as ModelFinishReason)
    ) {
      throw new TypeError("finishReason is invalid.");
    }
    const toolCallsValue = root["toolCalls"];
    if (!Array.isArray(toolCallsValue) || toolCallsValue.length > MAXIMUM_TOOL_CALLS) {
      throw new TypeError("toolCalls are invalid.");
    }
    const knownTools = new Set(request.tools.map((tool) => tool.toolId));
    const toolCalls = toolCallsValue.map((call) => parseToolCall(call, knownTools));
    if (new Set(toolCalls.map((call) => call.callId)).size !== toolCalls.length) {
      throw new TypeError("Tool call IDs must be unique.");
    }
    if ((finishReason === "tool_calls") !== toolCalls.length > 0) {
      throw new TypeError("Tool calls and finish reason are inconsistent.");
    }
    const usage = parseUsage(root["usage"], request.maxOutputTokens);
    const responseBody = {
      schemaVersion: "2.0" as const,
      turnId,
      assistantText,
      toolCalls,
      usage,
      finishReason: finishReason as ModelFinishReason,
      providerId,
      modelId
    };
    return Object.freeze({
      ...responseBody,
      toolCalls: Object.freeze(toolCalls),
      usage: Object.freeze(usage),
      requestHash: request.requestHash,
      responseHash: sha256Hex(canonicalizeValue(responseBody as unknown as JsonValue))
    });
  } catch (error) {
    if (error instanceof ModelProviderError) throw error;
    throw new ModelProviderError("INVALID_TURN", "Provider returned an invalid model turn.", {
      cause: error instanceof Error ? error : undefined
    });
  }
}

function parseMessage(value: unknown): ModelContextMessage {
  const root = requireExactObject(value, ["role", "content", "origin", "contentHash"]);
  const role = root["role"];
  if (role !== "user" && role !== "assistant") throw new TypeError("Message role is invalid.");
  const content = requireBoundedText(root["content"], "message content");
  const origin = root["origin"];
  if (typeof origin !== "string" || !ORIGINS.has(origin as ContentOrigin)) {
    throw new TypeError("Message origin is invalid.");
  }
  if ((role === "assistant") !== (origin === "model_output")) {
    throw new TypeError("Message role and origin are inconsistent.");
  }
  const contentHash = root["contentHash"];
  if (typeof contentHash !== "string" || !HASH.test(contentHash)) {
    throw new TypeError("Message content hash is invalid.");
  }
  return Object.freeze({ role, content, origin: origin as ContentOrigin, contentHash });
}

function parseToolDescriptor(value: unknown): ToolDescriptor {
  const root = requireExactObject(value, ["toolId", "version", "capabilityClass", "bounds"]);
  const toolId = root["toolId"];
  const version = root["version"];
  const capabilityClass = root["capabilityClass"];
  if (typeof toolId !== "string" || !TOOL_ID.test(toolId))
    throw new TypeError("toolId is invalid.");
  if (typeof version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(version)) {
    throw new TypeError("Tool version is invalid.");
  }
  if (
    capabilityClass !== "read" &&
    capabilityClass !== "search" &&
    capabilityClass !== "write" &&
    capabilityClass !== "network" &&
    capabilityClass !== "execute"
  ) {
    throw new TypeError("Tool capability class is invalid.");
  }
  const bounds = requireExactObject(root["bounds"], ["maxOutputBytes", "maxResultCount"]);
  return Object.freeze({
    toolId,
    version,
    capabilityClass,
    bounds: Object.freeze({
      maxOutputBytes: requireInteger(bounds["maxOutputBytes"], "maxOutputBytes", 1, 4_194_304),
      maxResultCount: requireInteger(bounds["maxResultCount"], "maxResultCount", 1, 10_000)
    })
  });
}

function parseToolCall(value: unknown, knownTools: ReadonlySet<string>): ModelToolCall {
  const root = requireExactObject(value, ["callId", "toolId", "arguments"]);
  const callId = requireIdentifier(root["callId"], "callId");
  const toolId = root["toolId"];
  if (typeof toolId !== "string" || !knownTools.has(toolId)) {
    throw new TypeError("Tool call references an unknown tool.");
  }
  return Object.freeze({
    callId,
    toolId,
    arguments: normalizeJsonValue(root["arguments"], 0, { nodes: 0 })
  });
}

function parseUsage(value: unknown, maximumOutputTokens: number): ModelUsage {
  const root = requireExactObject(value, [
    "inputTokens",
    "outputTokens",
    "cachedTokens",
    "reasoningTokens",
    "costMode",
    "costMinorUnits"
  ]);
  const inputTokens = requireInteger(root["inputTokens"], "inputTokens", 0, MAXIMUM_TOKENS);
  const outputTokens = requireInteger(root["outputTokens"], "outputTokens", 0, maximumOutputTokens);
  const cachedTokens = requireInteger(root["cachedTokens"], "cachedTokens", 0, inputTokens);
  const reasoningTokens = requireInteger(
    root["reasoningTokens"],
    "reasoningTokens",
    0,
    MAXIMUM_TOKENS
  );
  const costMode = root["costMode"];
  const costMinorUnits = root["costMinorUnits"];
  if (costMode === "host_managed") {
    if (costMinorUnits !== null) throw new TypeError("Host-managed cost must be null.");
  } else if (costMode === "metered") {
    requireInteger(costMinorUnits, "costMinorUnits", 0, Number.MAX_SAFE_INTEGER);
  } else {
    throw new TypeError("costMode is invalid.");
  }
  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    reasoningTokens,
    costMode,
    costMinorUnits: costMinorUnits as number | null
  };
}

function normalizeJsonValue(value: unknown, depth: number, state: { nodes: number }): JsonValue {
  state.nodes += 1;
  if (depth > 16 || state.nodes > 10_000) throw new TypeError("JSON value exceeds its bounds.");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > MAXIMUM_TEXT_BYTES) {
      throw new TypeError("JSON string exceeds its byte limit.");
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("JSON number must be a safe integer.");
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 1_000) throw new TypeError("JSON array exceeds its item limit.");
    return Object.freeze(value.map((item) => normalizeJsonValue(item, depth + 1, state)));
  }
  if (typeof value !== "object") throw new TypeError("Value is not JSON-compatible.");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("JSON object must have a plain prototype.");
  }
  const entries = Object.keys(value as object).sort();
  if (entries.length > 100) throw new TypeError("JSON object exceeds its field limit.");
  const source = value as Record<string, unknown>;
  const normalized: { [key: string]: JsonValue } = {};
  for (const key of entries) normalized[key] = normalizeJsonValue(source[key], depth + 1, state);
  return Object.freeze(normalized);
}

function requireExactObject(value: unknown, fields: readonly string[]): Record<string, unknown> {
  const root = requireObject(value, "Value");
  if (Object.keys(root).sort().join("|") !== [...fields].sort().join("|")) {
    throw new TypeError("Object fields are invalid.");
  }
  return root;
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ModelProviderError("INVALID_REQUEST", `${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireIdentifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new TypeError(`${name} is invalid.`);
  }
  return value;
}

function requireBoundedText(value: unknown, name: string): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAXIMUM_TEXT_BYTES) {
    throw new TypeError(`${name} exceeds its byte limit.`);
  }
  return value;
}

function requireInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new TypeError(`${name} must be an integer in ${minimum}..${maximum}.`);
  }
  return value as number;
}
