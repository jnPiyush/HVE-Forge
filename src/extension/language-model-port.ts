import type { AtomicModelProvider, ModelTurnRequest } from "../application/model-provider.js";
import type { CancellationSignal } from "../application/tool-dispatcher.js";

/**
 * Narrow, host-agnostic seam over the VS Code Language Model API (SPEC-004 section 6.3). Nothing
 * in this module imports `vscode`, so it is fully testable with a fake double and never needs an
 * extension host. The real adapter in `vscode-lm-adapter.ts` is the only file that bridges this
 * interface to the actual `vscode.lm` namespace.
 */
export interface LanguageModelRequestMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface LanguageModelToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
}

export interface LanguageModelTextPart {
  readonly kind: "text";
  readonly text: string;
}

export interface LanguageModelToolCallPart {
  readonly kind: "tool_call";
  readonly callId: string;
  readonly toolId: string;
  readonly arguments: unknown;
}

export type LanguageModelResponsePart = LanguageModelTextPart | LanguageModelToolCallPart;

export interface LanguageModelChatLike {
  readonly id: string;
  readonly vendor: string;
  readonly maxInputTokens: number;
  sendRequest(
    messages: readonly LanguageModelRequestMessage[],
    tools: readonly LanguageModelToolSpec[],
    cancellation: CancellationSignal
  ): Promise<AsyncIterable<LanguageModelResponsePart>>;
}

export interface LanguageModelSelectorPort {
  selectChatModels(vendor: string): Promise<readonly LanguageModelChatLike[]>;
}

export type ModelSelectionState =
  | { readonly kind: "selected"; readonly model: LanguageModelChatLike }
  | { readonly kind: "empty" };

export type LanguageModelErrorCode =
  | "no_permissions"
  | "blocked"
  | "not_found"
  | "quota_exceeded"
  | "unknown";

/** A language-model-specific failure, distinguished from a generic transport/network error. */
export class LanguageModelRequestError extends Error {
  public constructor(
    public readonly code: LanguageModelErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "LanguageModelRequestError";
  }
}

/** Thrown by `completeTurn` when no chat model is available; callers should check `resolveModel` first. */
export class LanguageModelUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LanguageModelUnavailableError";
  }
}

const HOST_MANAGED_USAGE = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  reasoningTokens: 0,
  costMode: "host_managed" as const,
  costMinorUnits: null
});

/**
 * Adapts a narrow chat-model selector into the kernel's `AtomicModelProvider` contract (SPEC-004
 * section 6.1). Model selection happens lazily inside `completeTurn`, but a caller should resolve
 * the model with `resolveModel` first and treat an empty result as first-class, actionable
 * guidance -- never as an error -- before ever starting a bounded loop.
 */
export class VsCodeAtomicModelProvider implements AtomicModelProvider {
  public readonly id = "copilot";

  public constructor(
    private readonly selector: LanguageModelSelectorPort,
    private readonly vendor: string = "copilot"
  ) {}

  public async resolveModel(): Promise<ModelSelectionState> {
    const models = await this.selector.selectChatModels(this.vendor);
    return models.length === 0
      ? { kind: "empty" }
      : { kind: "selected", model: models[0] as LanguageModelChatLike };
  }

  public async completeTurn(
    request: ModelTurnRequest,
    cancellation: CancellationSignal
  ): Promise<unknown> {
    const selection = await this.resolveModel();
    if (selection.kind === "empty") {
      throw new LanguageModelUnavailableError(
        "No Copilot language model is available. Sign in to GitHub Copilot or select a model, then retry."
      );
    }
    const model = selection.model;
    const messages = request.messages.map((message) => ({
      role: message.role,
      content: message.content
    }));
    const tools = request.tools.map((tool) => ({
      name: tool.toolId,
      description: `HVE-Forge tool ${tool.toolId} (${tool.capabilityClass}).`,
      inputSchema: { type: "object" }
    }));

    let stream: AsyncIterable<LanguageModelResponsePart>;
    try {
      stream = await model.sendRequest(messages, tools, cancellation);
    } catch (error) {
      throw translateLanguageModelError(error);
    }

    let assistantText = "";
    const toolCalls: { callId: string; toolId: string; arguments: unknown }[] = [];
    try {
      for await (const part of stream) {
        if (cancellation.isCancellationRequested) {
          throw new LanguageModelRequestError(
            "unknown",
            "The language model stream was cancelled."
          );
        }
        if (part.kind === "text") assistantText += part.text;
        else
          toolCalls.push({ callId: part.callId, toolId: part.toolId, arguments: part.arguments });
      }
    } catch (error) {
      if (error instanceof LanguageModelRequestError) throw error;
      throw translateLanguageModelError(error);
    }

    return {
      schemaVersion: "2.0",
      turnId: `turn-${request.turnNumber}`,
      assistantText,
      toolCalls,
      usage: HOST_MANAGED_USAGE,
      finishReason: toolCalls.length > 0 ? "tool_calls" : "completed",
      providerId: this.id,
      modelId: model.id
    };
  }
}

/**
 * Distinguishes a language-model-specific failure (permission, content filter, quota) from a
 * generic transport/network error, preserving the original cause either way.
 */
export function translateLanguageModelError(error: unknown): Error {
  if (error instanceof LanguageModelRequestError) return error;
  const withCode = error as { readonly code?: unknown } | null;
  if (isErrorLike(error) && withCode !== null && typeof withCode.code === "string") {
    const code = withCode.code;
    const known: readonly LanguageModelErrorCode[] = [
      "no_permissions",
      "blocked",
      "not_found",
      "quota_exceeded"
    ];
    if ((known as readonly string[]).includes(code)) {
      return new LanguageModelRequestError(code as LanguageModelErrorCode, error.message, {
        cause: error
      });
    }
  }
  const message = isErrorLike(error) ? error.message : String(error);
  return new Error(`Language model transport error: ${message}`, { cause: error });
}

function isErrorLike(value: unknown): value is Error {
  return value instanceof Error;
}
