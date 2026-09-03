import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalizeJson, canonicalizeValue, type JsonValue } from "../core/canonical-json.js";

export const MCP_PROTOCOL_VERSION = "2026-07-28";
const MAXIMUM_REQUEST_BYTES = 1_048_576;
const MAXIMUM_STATE_BYTES = 65_536;
const CORE_METHODS = new Set([
  "server/discover",
  "resources/list",
  "resources/read",
  "prompts/list",
  "prompts/get",
  "tools/list",
  "tools/call",
  "inputResponses/submit",
  "subscriptions/listen",
  "notifications/progress",
  "notifications/cancelled",
  "elicitation/create"
]);
const DEPRECATED_METHODS = new Set(["roots/list", "sampling/createMessage", "logging/setLevel"]);
const TASK_METHODS = new Set(["tasks/get"]);

export interface McpValidationResult {
  readonly valid: boolean;
  readonly errorCode: string | null;
  readonly message: string | null;
}

export interface McpRequestOptions {
  readonly tasksEnabled?: boolean;
}

export interface McpCursor {
  readonly value: string;
  readonly expiresAtUnixMilliseconds: number;
  readonly cacheScope: string;
}

export class McpStateIntegrityError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "McpStateIntegrityError";
  }
}

export function validateMcpRequest(
  input: string | Uint8Array,
  options: McpRequestOptions = {}
): McpValidationResult {
  const parsed = parseBounded(input, "REQUEST_SIZE");
  if ("error" in parsed) return parsed.error;
  const root = parsed.value;
  if (!isObject(root) || root["jsonrpc"] !== "2.0" || typeof root["method"] !== "string") {
    return invalid("INVALID_ENVELOPE", "JSON-RPC 2.0 and a method are required.");
  }
  const method = root["method"];
  if (DEPRECATED_METHODS.has(method)) {
    return invalid("DEPRECATED_METHOD", `MCP method is deprecated: ${method}.`);
  }
  const isTaskMethod = TASK_METHODS.has(method);
  if ((!CORE_METHODS.has(method) && !isTaskMethod) || (isTaskMethod && !options.tasksEnabled)) {
    return invalid("UNSUPPORTED_METHOD", `MCP method is not negotiated: ${method}.`);
  }
  const metadata = root["_meta"];
  if (
    !isObject(metadata) ||
    metadata["protocolVersion"] !== MCP_PROTOCOL_VERSION ||
    !isObject(metadata["capabilities"])
  ) {
    return invalid(
      "MISSING_REQUEST_META",
      "Each request must declare protocolVersion and capabilities in _meta."
    );
  }
  const capabilities = metadata["capabilities"];
  if (isTaskMethod && capabilities["tasks"] !== true) {
    return invalid(
      "CAPABILITY_NOT_NEGOTIATED",
      "MCP task requests require the tasks capability in request metadata."
    );
  }
  if (method === "inputResponses/submit") {
    const parameters = root["params"];
    if (
      !isObject(parameters) ||
      typeof parameters["requestState"] !== "string" ||
      !Array.isArray(parameters["inputResponses"])
    ) {
      return invalid(
        "INVALID_INPUT_RESPONSE",
        "Input responses require requestState and an inputResponses array."
      );
    }
  }
  if (containsRemoteReference(root)) {
    return invalid("REMOTE_REF_DISABLED", "Remote JSON Schema references are disabled.");
  }
  return valid();
}

export function validateMcpResponse(input: string | Uint8Array): McpValidationResult {
  const parsed = parseBounded(input, "RESPONSE_SIZE");
  if ("error" in parsed) return parsed.error;
  const root = parsed.value;
  if (!isObject(root) || root["jsonrpc"] !== "2.0") {
    return invalid("INVALID_ENVELOPE", "JSON-RPC 2.0 is required.");
  }
  const hasResult = Object.hasOwn(root, "result");
  const hasError = Object.hasOwn(root, "error");
  if (hasResult === hasError) {
    return invalid("INVALID_RESPONSE", "Response requires exactly one result or error.");
  }
  const result = root["result"];
  if (
    hasResult &&
    (!isObject(result) || typeof result["resultType"] !== "string" || result["resultType"] === "")
  ) {
    return invalid("MISSING_RESULT_TYPE", "Successful responses require resultType.");
  }
  const error = root["error"];
  if (
    hasError &&
    (!isObject(error) || !Number.isFinite(error["code"]) || typeof error["message"] !== "string")
  ) {
    return invalid("INVALID_ERROR", "Error responses require numeric code and string message.");
  }
  return valid();
}

export class McpRequestStateProtector {
  private readonly key: Buffer;

  public constructor(key: Uint8Array) {
    if (key.byteLength < 32)
      throw new RangeError("Request-state key must contain at least 32 bytes.");
    this.key = Buffer.from(key);
  }

  public protect(state: JsonValue): string {
    const payload = Buffer.from(canonicalizeValue(state), "utf8");
    if (payload.byteLength > MAXIMUM_STATE_BYTES) {
      throw new RangeError("Request state exceeds 64 KiB.");
    }
    const signature = createHmac("sha256", this.key).update(payload).digest();
    return `${payload.toString("base64url")}.${signature.toString("base64url")}`;
  }

  public unprotect(token: string): unknown {
    const parts = token.split(".");
    if (parts.length !== 2) throw new McpStateIntegrityError("Request-state token is malformed.");
    let payload: Buffer;
    let signature: Buffer;
    try {
      payload = decodeCanonicalBase64Url(parts[0] as string);
      signature = decodeCanonicalBase64Url(parts[1] as string);
    } catch (error) {
      throw new McpStateIntegrityError("Request-state token encoding is invalid.", {
        cause: error
      });
    }
    if (payload.byteLength > MAXIMUM_STATE_BYTES) {
      throw new McpStateIntegrityError("Request-state token exceeds the size limit.");
    }
    const expected = createHmac("sha256", this.key).update(payload).digest();
    if (signature.byteLength !== expected.byteLength || !timingSafeEqual(expected, signature)) {
      throw new McpStateIntegrityError("Request-state token signature is invalid.");
    }
    try {
      return JSON.parse(canonicalizeJson(payload)) as unknown;
    } catch (error) {
      throw new McpStateIntegrityError("Request-state payload is invalid JSON.", { cause: error });
    }
  }
}

export class McpCursorCodec {
  public constructor(private readonly protector: McpRequestStateProtector) {}

  public encode(cursor: McpCursor): string {
    if (cursor.value.trim() === "" || cursor.cacheScope.trim() === "") {
      throw new TypeError("Cursor value and cache scope are required.");
    }
    return this.protector.protect({
      value: cursor.value,
      expiresAtUnixMilliseconds: cursor.expiresAtUnixMilliseconds,
      cacheScope: cursor.cacheScope
    });
  }

  public decode(token: string, expectedCacheScope: string, now: Date): McpCursor {
    const value = this.protector.unprotect(token);
    if (!isObject(value)) throw new McpStateIntegrityError("Cursor state is invalid.");
    const cursor = value["value"];
    const cacheScope = value["cacheScope"];
    const expiresAt = value["expiresAtUnixMilliseconds"];
    if (
      typeof cursor !== "string" ||
      typeof cacheScope !== "string" ||
      !Number.isSafeInteger(expiresAt)
    ) {
      throw new McpStateIntegrityError("Cursor fields are missing or invalid.");
    }
    if (cacheScope !== expectedCacheScope) {
      throw new McpStateIntegrityError("Cursor cache scope does not match the request.");
    }
    if ((expiresAt as number) <= now.getTime()) {
      throw new McpStateIntegrityError("Cursor has expired.");
    }
    return {
      value: cursor,
      expiresAtUnixMilliseconds: expiresAt as number,
      cacheScope
    };
  }
}

function decodeCanonicalBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid base64url alphabet.");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new Error("Non-canonical base64url encoding.");
  }
  return decoded;
}

function parseBounded(
  input: string | Uint8Array,
  sizeCode: string
): { readonly value: unknown } | { readonly error: McpValidationResult } {
  const bytes = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_REQUEST_BYTES) {
    return { error: invalid(sizeCode, "Message is empty or exceeds 1 MiB.") };
  }
  try {
    return { value: JSON.parse(canonicalizeJson(bytes)) as unknown };
  } catch {
    return { error: invalid("MALFORMED_JSON", "Message is not valid bounded JSON.") };
  }
}

function containsRemoteReference(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsRemoteReference);
  if (!isObject(value)) return false;
  return Object.entries(value).some(
    ([name, item]) =>
      (name === "$ref" && typeof item === "string" && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(item)) ||
      containsRemoteReference(item)
  );
}

function valid(): McpValidationResult {
  return { valid: true, errorCode: null, message: null };
}

function invalid(errorCode: string, message: string): McpValidationResult {
  return { valid: false, errorCode, message };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
