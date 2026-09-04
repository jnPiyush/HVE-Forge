import { readHostTextFile } from "./path-safety.js";
import type { EnforcementTier, HostId, HostProfile } from "./types.js";

const HOST_IDS = new Set<HostId>(["generic", "vscode", "cursor", "claude"]);
const TIERS = new Set<EnforcementTier>(["full", "kernel-mediated", "declarative"]);

export async function loadHostProfile(sourceRoot: string, hostId: HostId): Promise<HostProfile> {
  const content = await readHostTextFile(sourceRoot, `hve/hosts/${hostId}.json`);
  const value = JSON.parse(content as string) as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Host profile must be an object: ${hostId}.`);
  }
  const root = value as Record<string, unknown>;
  const expected = new Set([
    "schemaVersion",
    "hostId",
    "profileVersion",
    "enforcementTier",
    "agentDirectory",
    "agentSuffix",
    "ruleDirectory",
    "ruleSuffix",
    "scanRoots",
    "supportsHooks",
    "hooksEnabledByDefault",
    "supportsMcp"
  ]);
  for (const key of Object.keys(root)) {
    if (!expected.delete(key)) throw new Error(`Unexpected host profile field: ${key}.`);
  }
  if (expected.size > 0) throw new Error(`Host profile fields are missing: ${[...expected]}.`);
  if (root["schemaVersion"] !== "1.0" || root["hostId"] !== hostId) {
    throw new Error(`Host profile identity is invalid: ${hostId}.`);
  }
  if (!HOST_IDS.has(hostId)) throw new Error(`Unknown host: ${hostId}.`);
  const enforcementTier = requiredString(root, "enforcementTier") as EnforcementTier;
  if (!TIERS.has(enforcementTier)) throw new Error(`Invalid enforcement tier: ${enforcementTier}.`);
  if (root["hooksEnabledByDefault"] !== false) {
    throw new Error("Repository hooks must be disabled by default.");
  }
  return {
    schemaVersion: "1.0",
    hostId,
    profileVersion: requiredString(root, "profileVersion"),
    enforcementTier,
    agentDirectory: nullableString(root, "agentDirectory"),
    agentSuffix: nullableString(root, "agentSuffix"),
    ruleDirectory: nullableString(root, "ruleDirectory"),
    ruleSuffix: nullableString(root, "ruleSuffix"),
    scanRoots: stringArray(root, "scanRoots"),
    supportsHooks: requiredBoolean(root, "supportsHooks"),
    hooksEnabledByDefault: false,
    supportsMcp: requiredBoolean(root, "supportsMcp")
  };
}

export function normalizeHosts(hosts: readonly HostId[]): readonly HostId[] {
  const result = new Set<HostId>(["generic"]);
  for (const host of hosts) {
    if (!HOST_IDS.has(host)) throw new Error(`Unknown host: ${host}.`);
    result.add(host);
  }
  return [...result].sort((left, right) => left.localeCompare(right));
}

function requiredString(root: Record<string, unknown>, name: string): string {
  const value = root[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function nullableString(root: Record<string, unknown>, name: string): string | null {
  const value = root[name];
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be null or a non-empty string.`);
  }
  return value;
}

function requiredBoolean(root: Record<string, unknown>, name: string): boolean {
  const value = root[name];
  if (typeof value !== "boolean") throw new Error(`${name} must be boolean.`);
  return value;
}

function stringArray(root: Record<string, unknown>, name: string): readonly string[] {
  const value = root[name];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${name} must be a string array.`);
  }
  return value as string[];
}
