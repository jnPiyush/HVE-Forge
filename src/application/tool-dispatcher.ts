import { canonicalizeValue, type JsonValue, sha256Hex } from "../core/canonical-json.js";
import { evaluatePolicy, type PolicyDefinition } from "../core/policy.js";
import {
  type ToolAdmission,
  type ToolDescriptor,
  type ToolRegistry,
  ToolRegistryError
} from "../core/tool-registry.js";
import { createTrustEnvelope, type TrustEnvelope } from "../core/trust.js";

export interface CancellationSignal {
  readonly isCancellationRequested: boolean;
  readonly abortSignal?: AbortSignal;
}

export interface ToolHandlerContext {
  readonly workspaceRoot: string;
  readonly stateRoot: string;
  readonly idempotencyKey: string;
  readonly argumentsHash: string;
  readonly cancellation: CancellationSignal;
}

export interface ToolMutation {
  readonly beforeFileHash: string | null;
  readonly afterFileHash: string | null;
  readonly workspaceHash: string;
  readonly replayedReceipt: boolean;
}

export interface ToolHandlerOutput {
  readonly data: JsonValue;
  readonly resultCount: number;
  readonly truncated: boolean;
  readonly mutation: ToolMutation | null;
}

export interface ToolHandler {
  readonly descriptor: ToolDescriptor;
  parseInput(value: unknown): JsonValue;
  invoke(context: ToolHandlerContext, value: JsonValue): Promise<ToolHandlerOutput>;
}

export interface ToolDispatchContext {
  readonly workspaceRoot: string;
  readonly stateRoot: string;
  readonly cancellation: CancellationSignal;
}

export interface ToolError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface ToolDispatchResult {
  readonly isSuccess: boolean;
  readonly error: ToolError | null;
  readonly message: string;
  readonly output: TrustEnvelope | null;
  readonly outputHash: string | null;
  readonly outputBytes: number;
  readonly resultCount: number;
  readonly truncated: boolean;
  readonly mutation: ToolMutation | null;
}

export class ToolHandlerError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "ToolHandlerError";
  }
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;

export class ToolDispatcher {
  private readonly handlers: ReadonlyMap<string, ToolHandler>;

  public constructor(
    private readonly registry: ToolRegistry,
    private readonly policy: PolicyDefinition,
    handlers: readonly ToolHandler[]
  ) {
    const byId = new Map<string, ToolHandler>();
    for (const handler of handlers) {
      const toolId = handler.descriptor.toolId;
      if (byId.has(toolId)) throw new TypeError(`Duplicate tool handler: ${toolId}.`);
      const admission = this.getAdmission(toolId);
      if (!descriptorsEqual(admission.descriptor, handler.descriptor)) {
        throw new TypeError(`Tool handler descriptor does not match admission: ${toolId}.`);
      }
      byId.set(toolId, handler);
    }
    if (byId.size !== registry.admissions.length) {
      throw new TypeError("Every admitted tool must have exactly one handler.");
    }
    this.handlers = byId;
  }

  public list(): readonly ToolDescriptor[] {
    return Object.freeze(this.registry.admissions.map((admission) => admission.descriptor));
  }

  public getAdmission(toolId: string): ToolAdmission {
    return this.registry.get(toolId);
  }

  public async dispatch(
    context: ToolDispatchContext,
    requestValue: unknown,
    effectivePolicy: PolicyDefinition = this.policy
  ): Promise<ToolDispatchResult> {
    if (context.cancellation.isCancellationRequested !== false) {
      return failure("CANCELLED", "Tool dispatch was cancelled.", false);
    }
    const request = parseRequest(requestValue);
    let admission: ToolAdmission;
    try {
      admission = this.getAdmission(request.toolId);
    } catch (error) {
      if (error instanceof ToolRegistryError && error.code === "unknown_tool") {
        return failure("UNKNOWN_TOOL", `Tool is not registered: ${request.toolId}.`, false);
      }
      throw error;
    }
    const handler = this.handlers.get(request.toolId);
    if (handler === undefined)
      throw new Error(`Registered tool lacks a handler: ${request.toolId}.`);

    let argumentsValue: JsonValue;
    try {
      argumentsValue = handler.parseInput(request.argumentsValue);
    } catch (error) {
      if (error instanceof ToolHandlerError) {
        return failure(error.code, error.message, error.retryable);
      }
      return failure("BAD_ARGUMENTS", "Tool arguments do not match the declared contract.", false);
    }
    const argumentsHash = sha256Hex(canonicalizeValue(argumentsValue));
    const policyDecision = evaluatePolicy(effectivePolicy, request.toolId, admission.actionClass);
    if (!policyDecision.isAllowed) {
      return failure(
        "POLICY_DENIED",
        `Policy denied ${request.toolId}: ${policyDecision.ruleIds.join(", ")}.`,
        false
      );
    }
    if (context.cancellation.isCancellationRequested !== false) {
      return failure("CANCELLED", "Tool dispatch was cancelled.", false);
    }

    let rawOutput: unknown;
    try {
      rawOutput = await handler.invoke(
        {
          workspaceRoot: context.workspaceRoot,
          stateRoot: context.stateRoot,
          idempotencyKey: request.idempotencyKey,
          argumentsHash,
          cancellation: context.cancellation
        },
        argumentsValue
      );
    } catch (error) {
      if (error instanceof ToolHandlerError) {
        return failure(error.code, error.message, error.retryable);
      }
      throw error;
    }

    let output: ToolHandlerOutput;
    try {
      output = parseHandlerOutput(rawOutput, admission.descriptor);
    } catch {
      return failure("TOOL_OUTPUT_INVALID", "Tool output violated its declared bounds.", false);
    }
    const serialized = canonicalizeValue(output.data);
    const outputBytes = Buffer.byteLength(serialized, "utf8");
    if (outputBytes > admission.descriptor.bounds.maxOutputBytes) {
      return failure("TOOL_OUTPUT_INVALID", "Tool output violated its declared bounds.", false);
    }
    const envelope = createTrustEnvelope({
      origin: "tool_result",
      sourceReference: request.toolId,
      content: serialized,
      maximumBytes: admission.descriptor.bounds.maxOutputBytes
    });
    return Object.freeze({
      isSuccess: true,
      error: null,
      message: "Tool completed.",
      output: envelope,
      outputHash: envelope.contentHash,
      outputBytes,
      resultCount: output.resultCount,
      truncated: output.truncated || envelope.truncated,
      mutation: output.mutation
    });
  }
}

function parseRequest(value: unknown): {
  readonly toolId: string;
  readonly idempotencyKey: string;
  readonly argumentsValue: unknown;
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Tool dispatch request must be an object.");
  }
  const root = value as Record<string, unknown>;
  if (Object.keys(root).sort().join("|") !== "arguments|idempotencyKey|toolId") {
    throw new TypeError("Tool dispatch request fields are invalid.");
  }
  const toolId = root["toolId"];
  const idempotencyKey = root["idempotencyKey"];
  const argumentsValue = root["arguments"];
  if (typeof toolId !== "string" || toolId.length === 0) {
    throw new TypeError("toolId is required.");
  }
  if (typeof idempotencyKey !== "string" || !IDENTIFIER.test(idempotencyKey)) {
    throw new TypeError("idempotencyKey is invalid.");
  }
  return { toolId, idempotencyKey, argumentsValue };
}

function parseHandlerOutput(value: unknown, descriptor: ToolDescriptor): ToolHandlerOutput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Tool handler output must be an object.");
  }
  const root = value as Record<string, unknown>;
  if (Object.keys(root).sort().join("|") !== "data|mutation|resultCount|truncated") {
    throw new TypeError("Tool handler output fields are invalid.");
  }
  const data = root["data"];
  canonicalizeValue(data as JsonValue);
  const resultCount = root["resultCount"];
  if (
    !Number.isSafeInteger(resultCount) ||
    (resultCount as number) < 0 ||
    (resultCount as number) > descriptor.bounds.maxResultCount
  ) {
    throw new TypeError("Tool result count is invalid.");
  }
  if (typeof root["truncated"] !== "boolean") throw new TypeError("truncated must be boolean.");
  return {
    data: data as JsonValue,
    resultCount: resultCount as number,
    truncated: root["truncated"],
    mutation: parseMutation(root["mutation"])
  };
}

function parseMutation(value: unknown): ToolMutation | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Tool mutation must be an object or null.");
  }
  const root = value as Record<string, unknown>;
  if (
    Object.keys(root).sort().join("|") !==
    "afterFileHash|beforeFileHash|replayedReceipt|workspaceHash"
  ) {
    throw new TypeError("Tool mutation fields are invalid.");
  }
  for (const name of ["beforeFileHash", "afterFileHash"] as const) {
    if (root[name] !== null && (typeof root[name] !== "string" || !HASH.test(root[name]))) {
      throw new TypeError(`${name} is invalid.`);
    }
  }
  if (typeof root["workspaceHash"] !== "string" || !HASH.test(root["workspaceHash"])) {
    throw new TypeError("workspaceHash is invalid.");
  }
  if (typeof root["replayedReceipt"] !== "boolean") {
    throw new TypeError("replayedReceipt must be boolean.");
  }
  return Object.freeze({
    beforeFileHash: root["beforeFileHash"] as string | null,
    afterFileHash: root["afterFileHash"] as string | null,
    workspaceHash: root["workspaceHash"],
    replayedReceipt: root["replayedReceipt"]
  });
}

function descriptorsEqual(left: ToolDescriptor, right: ToolDescriptor): boolean {
  return (
    left.toolId === right.toolId &&
    left.version === right.version &&
    left.capabilityClass === right.capabilityClass &&
    left.bounds.maxOutputBytes === right.bounds.maxOutputBytes &&
    left.bounds.maxResultCount === right.bounds.maxResultCount
  );
}

function failure(code: string, message: string, retryable: boolean): ToolDispatchResult {
  return Object.freeze({
    isSuccess: false,
    error: Object.freeze({ code, message, retryable }),
    message,
    output: null,
    outputHash: null,
    outputBytes: 0,
    resultCount: 0,
    truncated: false,
    mutation: null
  });
}
