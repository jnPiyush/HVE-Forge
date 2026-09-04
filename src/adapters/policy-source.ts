import type { PolicySource } from "../application/contracts.js";
import { canonicalizeJson, sha256Hex } from "../core/canonical-json.js";
import type { ActionClass, PolicyDefinition, PolicyEffect, PolicyRule } from "../core/policy.js";
import { readRegularFileNoLinks } from "./path-safety.js";

const ACTION_CLASSES = new Set<ActionClass>([
  "read",
  "workspace_write",
  "external_write",
  "destructive",
  "privileged",
  "secret_bearing"
]);

export async function loadPolicy(path: string): Promise<PolicyDefinition> {
  const canonical = canonicalizeJson(await readRegularFileNoLinks(path));
  const root = JSON.parse(canonical) as unknown;
  if (!isObject(root)) throw new Error("Policy must be an object.");
  exactKeys(root, ["schemaVersion", "policyVersion", "defaultEffect", "defaultRuleId", "rules"]);
  if (root["schemaVersion"] !== "1.0") throw new Error("Unsupported policy schema version.");
  const defaultEffect = effect(root["defaultEffect"]);
  const defaultRuleId = text(root["defaultRuleId"], "defaultRuleId");
  if (!Array.isArray(root["rules"])) throw new Error("Policy rules must be an array.");
  const rules = root["rules"].map(parseRule);
  if (
    defaultEffect !== "deny" ||
    new Set(rules.map((rule) => rule.ruleId)).size !== rules.length ||
    rules.some((rule) => rule.effect === "allow" && rule.toolName === "*")
  ) {
    throw new Error(
      "Organization policy must default deny, use unique rule identifiers, and forbid wildcard allow rules."
    );
  }
  return {
    version: text(root["policyVersion"], "policyVersion"),
    contentHash: sha256Hex(canonical),
    defaultEffect,
    defaultRuleId,
    rules
  };
}

function parseRule(value: unknown): PolicyRule {
  if (!isObject(value)) throw new Error("Policy rule must be an object.");
  exactKeys(value, ["ruleId", "effect", "toolName", "actionClass"]);
  const actionClass = text(value["actionClass"], "actionClass") as ActionClass;
  if (!ACTION_CLASSES.has(actionClass)) throw new Error(`Unknown action class: ${actionClass}.`);
  return {
    ruleId: text(value["ruleId"], "ruleId"),
    effect: effect(value["effect"]),
    toolName: text(value["toolName"], "toolName"),
    actionClass
  };
}

function effect(value: unknown): PolicyEffect {
  if (value !== "allow" && value !== "deny")
    throw new Error(`Unknown policy effect: ${String(value)}.`);
  return value;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const expected = [...keys].sort().join("|");
  if (Object.keys(value).sort().join("|") !== expected)
    throw new Error("Policy fields are invalid.");
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`Policy ${name} is required.`);
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export class JsonPolicySource implements PolicySource {
  public constructor(private readonly path: string) {}

  public load(): Promise<PolicyDefinition> {
    return loadPolicy(this.path);
  }
}
