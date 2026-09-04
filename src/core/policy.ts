import type { RunEvent } from "./events.js";
import type { RunProjection } from "./runs.js";

export type ActionClass =
  | "read"
  | "workspace_write"
  | "external_write"
  | "destructive"
  | "privileged"
  | "secret_bearing";
export type PolicyEffect = "allow" | "deny";

export interface PolicyRule {
  readonly ruleId: string;
  readonly effect: PolicyEffect;
  readonly toolName: string;
  readonly actionClass: ActionClass | null;
}

export interface PolicyDefinition {
  readonly version: string;
  readonly contentHash: string;
  readonly defaultEffect: PolicyEffect;
  readonly defaultRuleId: string;
  readonly rules: readonly PolicyRule[];
}

export interface PolicyDecision {
  readonly effect: PolicyEffect;
  readonly ruleIds: readonly string[];
  readonly isAllowed: boolean;
}

export interface RunLimits {
  readonly maxDecisions: number;
  readonly maxToolDispatches: number;
  readonly maxElapsedMilliseconds: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxCostMinorUnits: number;
}

export function evaluatePolicy(
  definition: PolicyDefinition,
  toolName: string,
  actionClass: ActionClass
): PolicyDecision {
  if (toolName.length === 0) throw new TypeError("toolName is required.");
  const matching = definition.rules.filter(
    (rule) =>
      (rule.toolName === "*" || rule.toolName === toolName) &&
      (rule.actionClass === null || rule.actionClass === actionClass)
  );
  const denies = matching
    .filter((rule) => rule.effect === "deny")
    .map((rule) => rule.ruleId)
    .sort();
  if (denies.length > 0) return { effect: "deny", ruleIds: denies, isAllowed: false };
  const allows = matching
    .filter((rule) => rule.effect === "allow")
    .map((rule) => rule.ruleId)
    .sort();
  const effect = allows.length > 0 ? "allow" : definition.defaultEffect;
  return {
    effect,
    ruleIds: allows.length > 0 ? allows : [definition.defaultRuleId],
    isAllowed: effect === "allow"
  };
}

export function validateRunLimits(limits: RunLimits): RunLimits {
  requireInteger(limits.maxDecisions, "maxDecisions", 1);
  requireInteger(limits.maxToolDispatches, "maxToolDispatches", 0);
  requireInteger(limits.maxElapsedMilliseconds, "maxElapsedMilliseconds", 1);
  requireInteger(limits.maxInputTokens, "maxInputTokens", 0);
  requireInteger(limits.maxOutputTokens, "maxOutputTokens", 0);
  requireInteger(limits.maxCostMinorUnits, "maxCostMinorUnits", 0);
  return limits;
}

export function canRequestDecision(projection: RunProjection, limits: RunLimits): boolean {
  return projection.decisionsUsed < limits.maxDecisions;
}

export function canDispatchTool(projection: RunProjection, limits: RunLimits): boolean {
  return projection.toolDispatchesUsed < limits.maxToolDispatches;
}

export function countConsecutiveActionSignature(
  events: readonly RunEvent[],
  signature: string
): number {
  if (signature.trim().length === 0) throw new TypeError("signature is required.");
  let count = 0;
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event?.eventType !== "provider.decision_recorded") continue;
    const value = event.payload["actionSignature"];
    if (typeof value !== "string") {
      throw new TypeError("Provider decision is missing its action signature.");
    }
    if (value !== signature) break;
    count++;
  }
  return count;
}

function requireInteger(value: number, name: string, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be a safe integer greater than or equal to ${minimum}.`);
  }
}
