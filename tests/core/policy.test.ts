import { describe, expect, it } from "vitest";
import { createRunEvent, EMPTY_HASH } from "../../src/core/events.js";
import {
  canDispatchTool,
  canRequestDecision,
  countConsecutiveActionSignature,
  evaluatePolicy,
  type PolicyDefinition,
  validateRunLimits
} from "../../src/core/policy.js";
import { emptyProjection } from "../../src/core/runs.js";
import { validEventPayload } from "../helpers/event-fixtures.js";

const policy: PolicyDefinition = {
  version: "1.0.0",
  contentHash: "a".repeat(64),
  defaultEffect: "deny",
  defaultRuleId: "default-deny",
  rules: [
    {
      ruleId: "allow-write",
      effect: "allow",
      toolName: "workspace.replace_exact_text",
      actionClass: "workspace_write"
    }
  ]
};

describe("policy and execution guards", () => {
  it("allows an exact rule and denies by default", () => {
    expect(evaluatePolicy(policy, "workspace.replace_exact_text", "workspace_write")).toEqual({
      effect: "allow",
      ruleIds: ["allow-write"],
      isAllowed: true
    });
    expect(evaluatePolicy(policy, "process.execute", "privileged")).toEqual({
      effect: "deny",
      ruleIds: ["default-deny"],
      isAllowed: false
    });
  });

  it("applies deny over allow in stable rule order", () => {
    const definition: PolicyDefinition = {
      ...policy,
      rules: [
        ...policy.rules,
        {
          ruleId: "z-deny",
          effect: "deny",
          toolName: "workspace.replace_exact_text",
          actionClass: null
        },
        {
          ruleId: "a-deny",
          effect: "deny",
          toolName: "*",
          actionClass: "workspace_write"
        }
      ]
    };
    expect(evaluatePolicy(definition, "workspace.replace_exact_text", "workspace_write")).toEqual({
      effect: "deny",
      ruleIds: ["a-deny", "z-deny"],
      isAllowed: false
    });
  });

  it("validates and applies decision and dispatch budgets", () => {
    const limits = validateRunLimits({
      maxDecisions: 1,
      maxToolDispatches: 1,
      maxElapsedMilliseconds: 100,
      maxInputTokens: 0,
      maxOutputTokens: 0,
      maxCostMinorUnits: 0
    });
    const projection = emptyProjection("run-1");
    expect(canRequestDecision(projection, limits)).toBe(true);
    expect(canDispatchTool(projection, limits)).toBe(true);
    expect(canRequestDecision({ ...projection, decisionsUsed: 1 }, limits)).toBe(false);
    expect(canDispatchTool({ ...projection, toolDispatchesUsed: 1 }, limits)).toBe(false);
    expect(() => validateRunLimits({ ...limits, maxDecisions: 0 })).toThrow();
  });

  it("counts only the trailing repeated provider action signature", () => {
    const event = (sequence: number, signature: string, previousHash: string) =>
      createRunEvent(
        "run-1",
        sequence,
        {
          eventType: "provider.decision_recorded",
          occurredAt: `2026-09-01T00:00:0${sequence}.0000000+00:00`,
          payload: validEventPayload("provider.decision_recorded", { actionSignature: signature })
        },
        previousHash
      );
    const first = event(1, "a".repeat(64), EMPTY_HASH);
    const second = event(2, "b".repeat(64), first.eventHash);
    const third = event(3, "b".repeat(64), second.eventHash);
    expect(countConsecutiveActionSignature([first, second, third], "b".repeat(64))).toBe(2);
  });

  it("rejects invalid guard inputs and missing signatures", () => {
    expect(() => countConsecutiveActionSignature([], " ")).toThrow(TypeError);
    const valid = createRunEvent(
      "run-1",
      1,
      {
        eventType: "provider.decision_recorded",
        occurredAt: "2026-09-01T00:00:00.0000000+00:00",
        payload: validEventPayload("provider.decision_recorded")
      },
      EMPTY_HASH
    );
    const malformed = { ...valid, payload: {} };
    expect(() => countConsecutiveActionSignature([malformed], "x")).toThrow("missing");
    expect(() => evaluatePolicy(policy, "", "read")).toThrow(TypeError);
  });
});
