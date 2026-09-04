import { readHostTextFile } from "./path-safety.js";
import type {
  AgentCatalogItem,
  HostCatalog,
  HostId,
  RouterCatalogItem,
  RuleCatalogItem,
  SkillCatalogItem
} from "./types.js";

const HOST_IDS = new Set<HostId>(["generic", "vscode", "cursor", "claude"]);
const LOGICAL_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function loadHostCatalog(sourceRoot: string): Promise<HostCatalog> {
  const content = await readHostTextFile(sourceRoot, "hve/catalog.json");
  const raw = JSON.parse(content as string) as unknown;
  const root = requireObject(raw, "catalog");
  requireExactKeys(root, [
    "schemaVersion",
    "rendererVersion",
    "agents",
    "rules",
    "routers",
    "skills"
  ]);
  if (root["schemaVersion"] !== "1.0") throw new Error("Unsupported catalog schema version.");
  const rendererVersion = requireString(root, "rendererVersion");
  const agents = requireArray(root, "agents").map(parseAgent);
  const rules = requireArray(root, "rules").map(parseRule);
  const routers = requireArray(root, "routers").map(parseRouter);
  const skills = requireArray(root, "skills").map(parseSkill);
  assertUnique(
    [...agents, ...rules, ...routers, ...skills].map((item) => item.logicalId),
    "catalog logical ID"
  );
  return { schemaVersion: "1.0", rendererVersion, agents, rules, routers, skills };
}

function parseAgent(value: unknown): AgentCatalogItem {
  const item = requireObject(value, "agent");
  requireExactKeys(item, [
    "logicalId",
    "slug",
    "name",
    "description",
    "source",
    "tools",
    "userInvocable"
  ]);
  const logicalId = requireLogicalId(item);
  const slug = requireString(item, "slug");
  if (!SLUG.test(slug)) throw new Error(`Agent slug is invalid: ${slug}.`);
  const tools = requireStringArray(item, "tools");
  return {
    logicalId,
    slug,
    name: requireString(item, "name"),
    description: requireDescription(item),
    source: requireSafeRelativePath(item, "source"),
    tools,
    userInvocable: requireBoolean(item, "userInvocable")
  };
}

function parseRule(value: unknown): RuleCatalogItem {
  const item = requireObject(value, "rule");
  requireExactKeys(item, ["logicalId", "slug", "description", "source", "applyTo", "alwaysApply"]);
  const slug = requireString(item, "slug");
  if (!SLUG.test(slug)) throw new Error(`Rule slug is invalid: ${slug}.`);
  return {
    logicalId: requireLogicalId(item),
    slug,
    description: requireDescription(item),
    source: requireSafeRelativePath(item, "source"),
    applyTo: requireString(item, "applyTo"),
    alwaysApply: requireBoolean(item, "alwaysApply")
  };
}

function parseRouter(value: unknown): RouterCatalogItem {
  const item = requireObject(value, "router");
  requireExactKeys(item, ["logicalId", "source", "targets"]);
  const targetObject = requireObject(item["targets"], "router targets");
  const targets: Partial<Record<HostId, string>> = {};
  for (const [host, path] of Object.entries(targetObject)) {
    if (!HOST_IDS.has(host as HostId) || typeof path !== "string") {
      throw new Error(`Router target is invalid: ${host}.`);
    }
    targets[host as HostId] = validateSafeRelativePath(path, "router target");
  }
  return {
    logicalId: requireLogicalId(item),
    source: requireSafeRelativePath(item, "source"),
    targets
  };
}

function parseSkill(value: unknown): SkillCatalogItem {
  const item = requireObject(value, "skill");
  requireExactKeys(item, ["logicalId", "name", "source"]);
  const name = requireString(item, "name");
  if (!SLUG.test(name)) throw new Error(`Skill name is invalid: ${name}.`);
  return {
    logicalId: requireLogicalId(item),
    name,
    source: requireSafeRelativePath(item, "source")
  };
}

function requireLogicalId(item: Record<string, unknown>): string {
  const logicalId = requireString(item, "logicalId");
  if (!LOGICAL_ID.test(logicalId)) throw new Error(`Logical ID is invalid: ${logicalId}.`);
  return logicalId;
}

function requireDescription(item: Record<string, unknown>): string {
  const description = requireString(item, "description");
  if (description.length < 50 || description.length > 1_024) {
    throw new Error("Catalog descriptions must contain 50 to 1024 characters.");
  }
  return description;
}

function requireSafeRelativePath(item: Record<string, unknown>, name: string): string {
  return validateSafeRelativePath(requireString(item, name), name);
}

function validateSafeRelativePath(value: string, name: string): string {
  if (
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.includes("\\") ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`${name} must be a normalized safe relative path.`);
  }
  return value;
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const allowed = new Set(expected);
  for (const key of Object.keys(value)) {
    if (!allowed.delete(key)) throw new Error(`Unexpected field: ${key}.`);
  }
  if (allowed.size > 0) throw new Error(`Missing fields: ${[...allowed].join(", ")}.`);
}

function requireString(value: Record<string, unknown>, name: string): string {
  const result = value[name];
  if (typeof result !== "string" || result.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return result;
}

function requireBoolean(value: Record<string, unknown>, name: string): boolean {
  const result = value[name];
  if (typeof result !== "boolean") throw new Error(`${name} must be boolean.`);
  return result;
}

function requireArray(value: Record<string, unknown>, name: string): readonly unknown[] {
  const result = value[name];
  if (!Array.isArray(result)) throw new Error(`${name} must be an array.`);
  return result;
}

function requireStringArray(value: Record<string, unknown>, name: string): readonly string[] {
  const result = requireArray(value, name);
  if (!result.every((item) => typeof item === "string" && item.length > 0)) {
    throw new Error(`${name} must contain non-empty strings.`);
  }
  const strings = result as string[];
  assertUnique(strings, name);
  return strings;
}

function assertUnique(values: readonly string[], name: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${name} values must be unique.`);
}
