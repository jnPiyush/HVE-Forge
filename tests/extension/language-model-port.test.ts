import { describe, expect, it } from "vitest";
import { assembleModelContext } from "../../src/application/context-assembler.js";
import { createModelTurnRequest } from "../../src/application/model-provider.js";
import { createTrustEnvelope } from "../../src/core/trust.js";
import {
  type LanguageModelChatLike,
  LanguageModelRequestError,
  type LanguageModelResponsePart,
  type LanguageModelSelectorPort,
  LanguageModelUnavailableError,
  translateLanguageModelError,
  VsCodeAtomicModelProvider
} from "../../src/extension/language-model-port.js";

function request() {
  const context = assembleModelContext(
    [
      createTrustEnvelope({
        origin: "distribution_instruction",
        sourceReference: "package:prompt",
        content: "Obey policy.",
        maximumBytes: 1_024
      })
    ],
    { maxParts: 10, maxTotalBytes: 10_000 }
  );
  return createModelTurnRequest({
    sessionId: "session-1",
    turnNumber: 1,
    messages: context.messages,
    tools: [],
    maxOutputTokens: 1_000
  });
}

function selectorWith(models: readonly LanguageModelChatLike[]): LanguageModelSelectorPort {
  return { selectChatModels: async () => models };
}

function fakeModel(
  streamFactory: () => AsyncIterable<LanguageModelResponsePart>,
  overrides: Partial<LanguageModelChatLike> = {}
): LanguageModelChatLike {
  return {
    id: "copilot-gpt",
    vendor: "copilot",
    maxInputTokens: 100_000,
    sendRequest: async () => streamFactory(),
    ...overrides
  };
}

async function* textThenDone(text: string): AsyncGenerator<LanguageModelResponsePart> {
  yield { kind: "text", text };
}

describe("VsCodeAtomicModelProvider", () => {
  it("reports an empty model list as a first-class state, not an error", async () => {
    const provider = new VsCodeAtomicModelProvider(selectorWith([]));
    expect(await provider.resolveModel()).toEqual({ kind: "empty" });
  });

  it("resolves the first model for the configured vendor", async () => {
    const model = fakeModel(() => textThenDone("hi"));
    const provider = new VsCodeAtomicModelProvider(selectorWith([model]));
    const selection = await provider.resolveModel();
    expect(selection).toEqual({ kind: "selected", model });
  });

  it("throws a distinct unavailable error from completeTurn when no model is selected", async () => {
    const provider = new VsCodeAtomicModelProvider(selectorWith([]));
    await expect(
      provider.completeTurn(request(), { isCancellationRequested: false })
    ).rejects.toThrow(LanguageModelUnavailableError);
  });

  it("accumulates streamed text into assistantText with finishReason completed", async () => {
    const model = fakeModel(async function* () {
      yield { kind: "text", text: "Hello " };
      yield { kind: "text", text: "world." };
    });
    const provider = new VsCodeAtomicModelProvider(selectorWith([model]));
    const turn = (await provider.completeTurn(request(), {
      isCancellationRequested: false
    })) as { assistantText: string; finishReason: string; toolCalls: unknown[]; modelId: string };
    expect(turn.assistantText).toBe("Hello world.");
    expect(turn.finishReason).toBe("completed");
    expect(turn.toolCalls).toEqual([]);
    expect(turn.modelId).toBe("copilot-gpt");
  });

  it("reports tool_calls when the stream yields a tool call part", async () => {
    const model = fakeModel(async function* () {
      yield { kind: "tool_call", callId: "call-1", toolId: "workspace.read_file", arguments: {} };
    });
    const provider = new VsCodeAtomicModelProvider(selectorWith([model]));
    const turn = (await provider.completeTurn(request(), {
      isCancellationRequested: false
    })) as { finishReason: string; toolCalls: readonly unknown[] };
    expect(turn.finishReason).toBe("tool_calls");
    expect(turn.toolCalls).toHaveLength(1);
  });

  it("distinguishes a language-model error from a transport error", async () => {
    const lmError = Object.assign(new Error("blocked by content policy"), { code: "blocked" });
    const model = fakeModel(() => {
      throw lmError;
    });
    const provider = new VsCodeAtomicModelProvider(selectorWith([model]));
    await expect(
      provider.completeTurn(request(), { isCancellationRequested: false })
    ).rejects.toThrow(LanguageModelRequestError);

    const transportError = new Error("socket hang up");
    const transportModel = fakeModel(() => {
      throw transportError;
    });
    const transportProvider = new VsCodeAtomicModelProvider(selectorWith([transportModel]));
    await expect(
      transportProvider.completeTurn(request(), { isCancellationRequested: false })
    ).rejects.toThrow("Language model transport error");
  });

  it("stops consuming the stream once cancellation is requested", async () => {
    const cancellation = { isCancellationRequested: false };
    const model = fakeModel(async function* () {
      yield { kind: "text" as const, text: "first" };
      cancellation.isCancellationRequested = true;
      yield { kind: "text" as const, text: "second" };
    });
    const provider = new VsCodeAtomicModelProvider(selectorWith([model]));
    await expect(provider.completeTurn(request(), cancellation)).rejects.toThrow("cancelled");
  });

  it("selects models only for the configured vendor", async () => {
    const model = fakeModel(() => textThenDone("hi"), { vendor: "other-vendor" });
    const selector: LanguageModelSelectorPort = {
      selectChatModels: async (vendor) => (vendor === "copilot" ? [] : [model])
    };
    const provider = new VsCodeAtomicModelProvider(selector);
    expect(await provider.resolveModel()).toEqual({ kind: "empty" });
  });
});

describe("translateLanguageModelError", () => {
  it("passes through an existing LanguageModelRequestError unchanged", () => {
    const original = new LanguageModelRequestError("not_found", "no model");
    expect(translateLanguageModelError(original)).toBe(original);
  });

  it("wraps a non-Error thrown value as a transport error", () => {
    const translated = translateLanguageModelError("plain string failure");
    expect(translated.message).toContain("plain string failure");
  });
});
