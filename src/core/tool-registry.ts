import { type ActionClass, evaluatePolicy, type PolicyDefinition } from "./policy.js";

/**
 * Capability class of a tool. Admission is decided by class, never by tool identity,
 * so a read tool and a process-spawning tool can never share an admission path.
 */
export type ToolCapabilityClass = "read" | "search" | "write" | "network" | "execute";

export type ToolRegistryErrorCode =
  | "invalid_descriptors"
  | "invalid_descriptor"
  | "invalid_capabilities"
  | "invalid_policy"
  | "invalid_tool_id"
  | "invalid_version"
  | "unknown_capability_class"
  | "invalid_bounds"
  | "duplicate_tool_id"
  | "isolation_required"
  | "egress_receipts_required"
  | "policy_denied"
  | "unknown_tool";

export class ToolRegistryError extends Error {
  public constructor(
    public readonly code: ToolRegistryErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "ToolRegistryError";
  }
}

/** Deterministic output limits. Results beyond a bound are truncated and reported, never dropped. */
export interface ToolBounds {
  readonly maxOutputBytes: number;
  readonly maxResultCount: number;
}

export interface ToolDescriptor {
  readonly toolId: string;
  readonly version: string;
  readonly capabilityClass: ToolCapabilityClass;
  readonly bounds: ToolBounds;
}

export interface ToolAdmission {
  readonly descriptor: ToolDescriptor;
  readonly actionClass: ActionClass;
  readonly ruleIds: readonly string[];
}

/**
 * Environment capabilities that gate the highest-risk classes. Both must be the literal boolean
 * `true` to open a gate, so a non-boolean truthy value from parsed configuration cannot open the
 * execute or network path.
 */
export interface ToolRegistryCapabilities {
  readonly isolationBackendRegistered: boolean;
  readonly egressReceiptsEnabled: boolean;
}

export interface ToolRegistry {
  readonly admissions: readonly ToolAdmission[];
  has(toolId: string): boolean;
  get(toolId: string): ToolAdmission;
}

const CAPABILITY_ACTION_CLASS: Readonly<Record<ToolCapabilityClass, ActionClass>> = Object.freeze({
  read: "read",
  search: "read",
  write: "workspace_write",
  network: "external_write",
  execute: "privileged"
});

const TOOL_ID_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const MAX_OUTPUT_BYTES = 4_194_304;
const MAX_RESULT_COUNT = 10_000;
const ACTION_CLASSES = new Set<ActionClass>([
  "read",
  "workspace_write",
  "external_write",
  "destructive",
  "privileged",
  "secret_bearing"
]);

/** Resolves the policy action class for a capability class, rejecting unknown values. */
export function toolActionClass(capabilityClass: ToolCapabilityClass): ActionClass {
  if (
    typeof capabilityClass !== "string" ||
    !Object.hasOwn(CAPABILITY_ACTION_CLASS, capabilityClass)
  ) {
    throw new ToolRegistryError(
      "unknown_capability_class",
      `Unknown tool capability class: ${String(capabilityClass)}.`
    );
  }
  return CAPABILITY_ACTION_CLASS[capabilityClass];
}

/**
 * Builds an immutable registry. Construction fails closed: any descriptor that is malformed,
 * duplicated, missing an environment precondition, or denied by policy aborts the whole build
 * rather than being silently skipped.
 *
 * Each caller-supplied descriptor is snapshotted into a plain object before any check runs, so a
 * descriptor backed by accessors cannot report one capability class during validation and another
 * during admission.
 */
export function createToolRegistry(
  descriptors: readonly ToolDescriptor[],
  policy: PolicyDefinition,
  capabilities: ToolRegistryCapabilities
): ToolRegistry {
  if (!Array.isArray(descriptors)) {
    throw new ToolRegistryError("invalid_descriptors", "Tool descriptors must be an array.");
  }
  const safeCapabilities = snapshotCapabilities(capabilities);
  const safePolicy = snapshotPolicy(policy);

  const seen = new Set<string>();
  const admissions: ToolAdmission[] = [];

  for (const candidate of descriptors) {
    const descriptor = snapshotDescriptor(candidate);
    if (seen.has(descriptor.toolId)) {
      throw new ToolRegistryError(
        "duplicate_tool_id",
        `Duplicate tool identifier: ${descriptor.toolId}.`
      );
    }
    seen.add(descriptor.toolId);

    if (
      descriptor.capabilityClass === "execute" &&
      safeCapabilities.isolationBackendRegistered !== true
    ) {
      throw new ToolRegistryError(
        "isolation_required",
        `Tool ${descriptor.toolId} is execute-class and requires a registered isolation backend.`
      );
    }
    if (
      descriptor.capabilityClass === "network" &&
      safeCapabilities.egressReceiptsEnabled !== true
    ) {
      throw new ToolRegistryError(
        "egress_receipts_required",
        `Tool ${descriptor.toolId} is network-class and requires egress receipts to be enabled.`
      );
    }

    const actionClass = toolActionClass(descriptor.capabilityClass);
    const decision = evaluatePolicy(safePolicy, descriptor.toolId, actionClass);
    if (!decision.isAllowed) {
      throw new ToolRegistryError(
        "policy_denied",
        `Policy denied tool ${descriptor.toolId} (${actionClass}): ${decision.ruleIds.join(", ")}.`
      );
    }

    admissions.push(
      Object.freeze({
        descriptor,
        actionClass,
        ruleIds: Object.freeze([...decision.ruleIds])
      })
    );
  }

  admissions.sort((left, right) =>
    compareCodeUnits(left.descriptor.toolId, right.descriptor.toolId)
  );
  const frozen = Object.freeze([...admissions]);
  const index = new Map(frozen.map((admission) => [admission.descriptor.toolId, admission]));

  return Object.freeze({
    admissions: frozen,
    has: (toolId: string): boolean => index.has(toolId),
    get: (toolId: string): ToolAdmission => {
      const admission = index.get(toolId);
      if (admission === undefined) {
        throw new ToolRegistryError("unknown_tool", `Tool is not registered: ${toolId}.`);
      }
      return admission;
    }
  });
}

/**
 * Reads every field exactly once, validates the captured values, and returns a frozen plain
 * object. Unknown fields on the caller's object are dropped rather than copied through.
 */
function snapshotDescriptor(candidate: ToolDescriptor): ToolDescriptor {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new ToolRegistryError("invalid_descriptor", "Tool descriptor must be an object.");
  }
  const toolId: unknown = candidate.toolId;
  const version: unknown = candidate.version;
  const capabilityClass: unknown = candidate.capabilityClass;
  const bounds: unknown = candidate.bounds;

  if (typeof toolId !== "string" || !TOOL_ID_PATTERN.test(toolId)) {
    throw new ToolRegistryError(
      "invalid_tool_id",
      `Tool identifier must be dot-separated lower snake case: ${String(toolId)}.`
    );
  }
  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
    throw new ToolRegistryError(
      "invalid_version",
      `Tool ${toolId} version must be major.minor.patch.`
    );
  }
  if (
    typeof capabilityClass !== "string" ||
    !Object.hasOwn(CAPABILITY_ACTION_CLASS, capabilityClass)
  ) {
    throw new ToolRegistryError(
      "unknown_capability_class",
      `Tool ${toolId} declares unknown capability class: ${String(capabilityClass)}.`
    );
  }
  if (bounds === null || typeof bounds !== "object" || Array.isArray(bounds)) {
    throw new ToolRegistryError("invalid_bounds", `Tool ${toolId} must declare output bounds.`);
  }
  const maxOutputBytes: unknown = (bounds as ToolBounds).maxOutputBytes;
  const maxResultCount: unknown = (bounds as ToolBounds).maxResultCount;
  assertBound(toolId, "maxOutputBytes", maxOutputBytes, MAX_OUTPUT_BYTES);
  assertBound(toolId, "maxResultCount", maxResultCount, MAX_RESULT_COUNT);

  return Object.freeze({
    toolId,
    version,
    capabilityClass: capabilityClass as ToolCapabilityClass,
    bounds: Object.freeze({
      maxOutputBytes: maxOutputBytes as number,
      maxResultCount: maxResultCount as number
    })
  });
}

function snapshotCapabilities(capabilities: ToolRegistryCapabilities): ToolRegistryCapabilities {
  if (capabilities === null || typeof capabilities !== "object" || Array.isArray(capabilities)) {
    throw new ToolRegistryError("invalid_capabilities", "Registry capabilities must be an object.");
  }
  const isolationBackendRegistered: unknown = capabilities.isolationBackendRegistered;
  const egressReceiptsEnabled: unknown = capabilities.egressReceiptsEnabled;
  if (typeof isolationBackendRegistered !== "boolean") {
    throw new ToolRegistryError(
      "invalid_capabilities",
      "Registry capability isolationBackendRegistered must be a boolean."
    );
  }
  if (typeof egressReceiptsEnabled !== "boolean") {
    throw new ToolRegistryError(
      "invalid_capabilities",
      "Registry capability egressReceiptsEnabled must be a boolean."
    );
  }
  return Object.freeze({ isolationBackendRegistered, egressReceiptsEnabled });
}

function snapshotPolicy(policy: PolicyDefinition): PolicyDefinition {
  if (policy === null || typeof policy !== "object" || Array.isArray(policy)) {
    throw new ToolRegistryError("invalid_policy", "Policy definition must be an object.");
  }
  const version: unknown = policy.version;
  const contentHash: unknown = policy.contentHash;
  const defaultEffect: unknown = policy.defaultEffect;
  const defaultRuleId: unknown = policy.defaultRuleId;
  const rulesValue: unknown = policy.rules;
  if (
    typeof version !== "string" ||
    version.length === 0 ||
    typeof contentHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(contentHash) ||
    typeof defaultRuleId !== "string" ||
    defaultRuleId.length === 0
  ) {
    throw new ToolRegistryError("invalid_policy", "Policy identity is invalid.");
  }
  if (!Array.isArray(rulesValue)) {
    throw new ToolRegistryError("invalid_policy", "Policy rules must be an array.");
  }
  if (defaultEffect !== "allow" && defaultEffect !== "deny") {
    throw new ToolRegistryError("invalid_policy", "Policy default effect must be allow or deny.");
  }
  const rules = rulesValue.map((value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new ToolRegistryError("invalid_policy", "Policy rule must be an object.");
    }
    const rule = value as Record<string, unknown>;
    if (Object.keys(rule).sort().join("|") !== "actionClass|effect|ruleId|toolName") {
      throw new ToolRegistryError("invalid_policy", "Policy rule fields are invalid.");
    }
    const ruleId = rule["ruleId"];
    const effect = rule["effect"];
    const toolName = rule["toolName"];
    const actionClass = rule["actionClass"];
    if (
      typeof ruleId !== "string" ||
      ruleId.length === 0 ||
      (effect !== "allow" && effect !== "deny") ||
      typeof toolName !== "string" ||
      toolName.length === 0 ||
      (actionClass !== null &&
        (typeof actionClass !== "string" || !ACTION_CLASSES.has(actionClass as ActionClass)))
    ) {
      throw new ToolRegistryError("invalid_policy", "Policy rule values are invalid.");
    }
    return Object.freeze({
      ruleId,
      effect,
      toolName,
      actionClass: actionClass as ActionClass | null
    });
  });
  return Object.freeze({
    version,
    contentHash,
    defaultEffect,
    defaultRuleId,
    rules: Object.freeze(rules)
  });
}

function assertBound(toolId: string, name: string, value: unknown, limit: number): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > limit) {
    throw new ToolRegistryError(
      "invalid_bounds",
      `Tool ${toolId} bound ${name} must be an integer in 1..${limit}.`
    );
  }
}

/** Code-unit ordering. ICU collation is deliberately avoided so ordering is host-independent. */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}
