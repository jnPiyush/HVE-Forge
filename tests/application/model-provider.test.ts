import { describe, expect, it } from "vitest";
import { assembleModelContext } from "../../src/application/context-assembler.js";
import {
  type AtomicModelProvider,
  completeValidatedTurn,
  createModelTurnRequest,
  ModelProviderError
} from "../../src/application/model-provider.js";
import type { ToolDescriptor } from "../../src/core/tool-registry.js";
import { createTrustEnvelope } from "../../src/core/trust.js";

const tool: ToolDescriptor = {
  toolId: "workspace.read_file",
  version: "1.0.0",
  capabilityClass: "read",
  bounds: { maxOutputBytes: 65_536, maxResultCount: 1 }
};

function request() {
  const context = assembleModelContext(
    [
      createTrustEnvelope({
        origin: "distribution_instruction",
        sourceReference: "package:prompt-v2",
        content: "Obey policy.",
        maximumBytes: 1_024
      }),
      createTrustEnvelope({
        origin: "operator_task",
        sourceReference: "operator:request",
        content: "Read one file.",
        maximumBytes: 1_024
      })
    ],
    { maxParts: 10, maxTotalBytes: 10_000 }
  );
  return createModelTurnRequest({
    sessionId: "session-1",
    turnNumber: 1,
    messages: context.messages,
    tools: [tool],
    maxOutputTokens: 2_000
  });
}

function rawTurn(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "2.0",
    turnId: "turn-1",
    assistantText: "I will read the file.",
    toolCalls: [
      {
        callId: "call-1",
        toolId: "workspace.read_file",
        arguments: { relativePath: "src/a.ts" }
      }
    ],
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      cachedTokens: 0,
      reasoningTokens: 0,
      costMode: "host_managed",
      costMinorUnits: null
    },
    finishReason: "tool_calls",
    providerId: "copilot",
    modelId: "test-model",
    ...overrides
  };
}

function provider(value: unknown, calls: unknown[]): AtomicModelProvider {
  return {
    id: "copilot",
    completeTurn: async (input) => {
      calls.push(input);
      return value;
    }
  };
}

describe("atomic model provider", () => {
  it("validates a bounded turn and derives stable request and response hashes", async () => {
    const calls: unknown[] = [];
    const input = request();
    const first = await completeValidatedTurn(provider(rawTurn(), calls), input, {
      isCancellationRequested: false
    });
    const second = await completeValidatedTurn(provider(rawTurn(), []), request(), {
      isCancellationRequested: false
    });

    expect(calls).toHaveLength(1);
    expect(first).toEqual(second);
    expect(first.requestHash).toBe(input.requestHash);
    expect(first.responseHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.toolCalls[0]?.arguments).toEqual({ relativePath: "src/a.ts" });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.toolCalls)).toBe(true);
  });

  it("rejects unknown tools, duplicate call IDs, extra fields, and non-JSON arguments", async () => {
    const cases = [
      rawTurn({
        toolCalls: [{ callId: "call-1", toolId: "workspace.unknown", arguments: {} }]
      }),
      rawTurn({
        toolCalls: [
          { callId: "call-1", toolId: tool.toolId, arguments: {} },
          { callId: "call-1", toolId: tool.toolId, arguments: {} }
        ]
      }),
      { ...rawTurn(), extra: true },
      rawTurn({
        toolCalls: [{ callId: "call-1", toolId: tool.toolId, arguments: { bad: undefined } }]
      })
    ];
    for (const value of cases) {
      await expect(
        completeValidatedTurn(provider(value, []), request(), {
          isCancellationRequested: false
        })
      ).rejects.toMatchObject({ code: "INVALID_TURN" });
    }
  });

  it("rejects oversized text, unsafe usage, and false cost claims", async () => {
    const cases = [
      rawTurn({ assistantText: "x".repeat(65_537) }),
      rawTurn({
        usage: {
          inputTokens: 1,
          outputTokens: 2_001,
          cachedTokens: 0,
          reasoningTokens: 0,
          costMode: "host_managed",
          costMinorUnits: null
        }
      }),
      rawTurn({
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cachedTokens: 0,
          reasoningTokens: 0,
          costMode: "host_managed",
          costMinorUnits: 1
        }
      }),
      rawTurn({
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cachedTokens: 0,
          reasoningTokens: 0,
          costMode: "metered",
          costMinorUnits: null
        }
      })
    ];
    for (const value of cases) {
      await expect(
        completeValidatedTurn(provider(value, []), request(), {
          isCancellationRequested: false
        })
      ).rejects.toBeInstanceOf(ModelProviderError);
    }
  });

  it("never calls the provider after cancellation", async () => {
    const calls: unknown[] = [];
    await expect(
      completeValidatedTurn(provider(rawTurn(), calls), request(), {
        isCancellationRequested: true
      })
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(calls).toHaveLength(0);
  });

  it("never calls the provider with an already aborted signal", async () => {
    const calls: unknown[] = [];
    const controller = new AbortController();
    controller.abort();

    await expect(
      completeValidatedTurn(provider(rawTurn(), calls), request(), {
        isCancellationRequested: false,
        abortSignal: controller.signal
      })
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(calls).toHaveLength(0);
  });

  it("bounds provider latency and exposes an abort signal", async () => {
    let observedSignal: AbortSignal | undefined;
    const hanging: AtomicModelProvider = {
      id: "copilot",
      completeTurn: async (_input, cancellation) => {
        observedSignal = cancellation.abortSignal;
        await new Promise(() => undefined);
      }
    };

    await expect(
      completeValidatedTurn(hanging, request(), { isCancellationRequested: false }, 10)
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(observedSignal?.aborted).toBe(true);
  });

  it("rejects malformed requests before a provider can observe them", async () => {
    expect(() => createModelTurnRequest({ ...request(), turnNumber: 0 })).toThrow();
    expect(() => createModelTurnRequest({ ...request(), tools: [tool, tool] })).toThrow();
    expect(() => createModelTurnRequest({ ...request(), messages: [] })).toThrow();
    await expect(
      completeValidatedTurn(
        provider(rawTurn(), []),
        request(),
        { isCancellationRequested: false },
        0
      )
    ).rejects.toBeInstanceOf(RangeError);
  });
});
