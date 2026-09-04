import { describe, expect, it } from "vitest";
import {
  ToolDispatcher,
  type ToolHandler,
  ToolHandlerError,
  type ToolHandlerOutput
} from "../../src/application/tool-dispatcher.js";
import type { JsonValue } from "../../src/core/canonical-json.js";
import type { PolicyDefinition } from "../../src/core/policy.js";
import { createToolRegistry, type ToolDescriptor } from "../../src/core/tool-registry.js";

const descriptor: ToolDescriptor = {
  toolId: "workspace.read_file",
  version: "1.0.0",
  capabilityClass: "read",
  bounds: { maxOutputBytes: 1_024, maxResultCount: 2 }
};

function policy(effect: "allow" | "deny" = "allow"): PolicyDefinition {
  return {
    version: "1.0.0",
    contentHash: (effect === "allow" ? "a" : "d").repeat(64),
    defaultEffect: "deny",
    defaultRuleId: "default-deny",
    rules: [
      {
        ruleId: `${effect}-read`,
        effect,
        toolName: descriptor.toolId,
        actionClass: "read"
      }
    ]
  };
}

function handler(
  calls: unknown[],
  output: ToolHandlerOutput = {
    data: { value: "ok" },
    resultCount: 1,
    truncated: false,
    mutation: null
  }
): ToolHandler {
  return {
    descriptor,
    parseInput: (value: unknown): JsonValue => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("input must be an object");
      }
      return { value: "normalized" };
    },
    invoke: async (_context, value): Promise<ToolHandlerOutput> => {
      calls.push(value);
      return output;
    }
  };
}

function registry() {
  return createToolRegistry([descriptor], policy(), {
    isolationBackendRegistered: false,
    egressReceiptsEnabled: false
  });
}

const context = {
  workspaceRoot: "workspace",
  stateRoot: "state",
  cancellation: { isCancellationRequested: false }
};

describe("tool dispatcher", () => {
  it("binds an admitted descriptor to one handler and wraps output as untrusted", async () => {
    const calls: unknown[] = [];
    const dispatcher = new ToolDispatcher(registry(), policy(), [handler(calls)]);
    const result = await dispatcher.dispatch(context, {
      toolId: descriptor.toolId,
      idempotencyKey: "read-1",
      arguments: {}
    });

    expect(calls).toHaveLength(1);
    expect(result.isSuccess).toBe(true);
    expect(result.output).toEqual(
      expect.objectContaining({ origin: "tool_result", trust: "untrusted_tool" })
    );
    expect(result.output?.content).toContain('"value":"ok"');
    expect(result.resultCount).toBe(1);
  });

  it("returns stable errors without invoking handlers for unknown, denied, bad, or cancelled calls", async () => {
    const calls: unknown[] = [];
    const allowed = new ToolDispatcher(registry(), policy(), [handler(calls)]);
    const denied = new ToolDispatcher(registry(), policy("deny"), [handler(calls)]);

    expect(
      (
        await allowed.dispatch(context, {
          toolId: "workspace.unknown",
          idempotencyKey: "unknown-1",
          arguments: {}
        })
      ).error?.code
    ).toBe("UNKNOWN_TOOL");
    expect(
      (
        await denied.dispatch(context, {
          toolId: descriptor.toolId,
          idempotencyKey: "denied-1",
          arguments: {}
        })
      ).error?.code
    ).toBe("POLICY_DENIED");
    expect(
      (
        await allowed.dispatch(context, {
          toolId: descriptor.toolId,
          idempotencyKey: "bad-1",
          arguments: "bad"
        })
      ).error?.code
    ).toBe("BAD_ARGUMENTS");
    expect(
      (
        await allowed.dispatch(
          { ...context, cancellation: { isCancellationRequested: true } },
          { toolId: descriptor.toolId, idempotencyKey: "cancel-1", arguments: {} }
        )
      ).error?.code
    ).toBe("CANCELLED");
    expect(calls).toHaveLength(0);
  });

  it("fails closed on oversized, over-count, and malformed handler output", async () => {
    const cases: ToolHandlerOutput[] = [
      { data: { value: "x".repeat(2_000) }, resultCount: 1, truncated: false, mutation: null },
      { data: { value: "ok" }, resultCount: 3, truncated: false, mutation: null },
      { data: { value: "ok" }, resultCount: -1, truncated: false, mutation: null }
    ];
    for (const output of cases) {
      const dispatcher = new ToolDispatcher(registry(), policy(), [handler([], output)]);
      const result = await dispatcher.dispatch(context, {
        toolId: descriptor.toolId,
        idempotencyKey: "output-1",
        arguments: {}
      });
      expect(result.error?.code).toBe("TOOL_OUTPUT_INVALID");
    }
  });

  it("propagates typed handler failures as data", async () => {
    const failing: ToolHandler = {
      ...handler([]),
      invoke: async () => {
        throw new ToolHandlerError("SENSITIVE_PATH", "Path is protected.", false);
      }
    };
    const result = await new ToolDispatcher(registry(), policy(), [failing]).dispatch(context, {
      toolId: descriptor.toolId,
      idempotencyKey: "failure-1",
      arguments: {}
    });
    expect(result.error).toEqual({
      code: "SENSITIVE_PATH",
      message: "Path is protected.",
      retryable: false
    });
  });

  it("rejects missing, duplicate, and descriptor-mismatched handlers", () => {
    expect(() => new ToolDispatcher(registry(), policy(), [])).toThrow(/handler/iu);
    expect(() => new ToolDispatcher(registry(), policy(), [handler([]), handler([])])).toThrow(
      /duplicate/iu
    );
    expect(
      () =>
        new ToolDispatcher(registry(), policy(), [
          { ...handler([]), descriptor: { ...descriptor, version: "2.0.0" } }
        ])
    ).toThrow(/descriptor/iu);
  });
});
