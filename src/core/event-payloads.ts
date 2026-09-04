import type { JsonValue } from "./canonical-json.js";
import type { EventPayload, EventType } from "./events.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const STATES = new Set([
  "queued",
  "preparing",
  "researching",
  "planning",
  "awaiting_approval",
  "executing",
  "verifying",
  "reviewing",
  "completed",
  "blocked",
  "failed",
  "cancelled"
]);
const ACTION_CLASSES = new Set([
  "read",
  "workspace_write",
  "external_write",
  "destructive",
  "privileged",
  "secret_bearing"
]);
const TOOL_OUTCOMES = new Set(["succeeded", "failed", "cancelled", "timed_out"]);
const EVALUATION_VERDICTS = new Set(["approved", "changes_requested", "blocked"]);
const INTERRUPTION_POINTS = new Set([
  "after_decision",
  "after_tool_commit",
  "after_verification",
  "after_evaluation",
  "operator_pause"
]);

export function assertEventPayload(eventType: EventType, payload: EventPayload): void {
  switch (eventType) {
    case "run.created":
      validateRunCreated(payload);
      return;
    case "state.transitioned":
      exactKeys(payload, ["from", "to", "reason"]);
      enumString(payload["from"], "from", STATES);
      enumString(payload["to"], "to", STATES);
      boundedString(payload["reason"], "reason", 1, 1_024);
      return;
    case "instruction.selected":
      exactKeys(payload, ["relativePath", "contentHash", "byteLength"]);
      nullableBoundedString(payload["relativePath"], "relativePath", 1_024);
      sha256(payload["contentHash"], "contentHash");
      integer(payload["byteLength"], "byteLength", 0, 65_536);
      return;
    case "provider.decision_recorded":
      exactKeys(payload, [
        "decisionId",
        "toolName",
        "argumentsHash",
        "idempotencyKey",
        "actionSignature",
        "inputTokens",
        "outputTokens",
        "costMinorUnits"
      ]);
      identifier(payload["decisionId"], "decisionId");
      identifier(payload["toolName"], "toolName");
      sha256(payload["argumentsHash"], "argumentsHash");
      identifier(payload["idempotencyKey"], "idempotencyKey");
      sha256(payload["actionSignature"], "actionSignature");
      integer(payload["inputTokens"], "inputTokens", 0);
      integer(payload["outputTokens"], "outputTokens", 0);
      integer(payload["costMinorUnits"], "costMinorUnits", 0);
      return;
    case "policy.decision_recorded":
      exactKeys(payload, ["policyDecisionId", "toolName", "actionClass", "outcome", "ruleIds"]);
      identifier(payload["policyDecisionId"], "policyDecisionId");
      identifier(payload["toolName"], "toolName");
      enumString(payload["actionClass"], "actionClass", ACTION_CLASSES);
      enumString(payload["outcome"], "outcome", new Set(["allowed", "denied"]));
      identifierArray(payload["ruleIds"], "ruleIds", 1, 64);
      return;
    case "tool.dispatched":
      exactKeys(payload, ["toolCallId", "toolName", "idempotencyKey", "workspaceHashBefore"]);
      identifier(payload["toolCallId"], "toolCallId");
      identifier(payload["toolName"], "toolName");
      identifier(payload["idempotencyKey"], "idempotencyKey");
      sha256(payload["workspaceHashBefore"], "workspaceHashBefore");
      return;
    case "tool.completed":
      exactKeys(payload, [
        "toolCallId",
        "idempotencyKey",
        "outcome",
        "errorCode",
        "beforeFileHash",
        "afterFileHash",
        "workspaceHashAfter"
      ]);
      identifier(payload["toolCallId"], "toolCallId");
      identifier(payload["idempotencyKey"], "idempotencyKey");
      enumString(payload["outcome"], "outcome", TOOL_OUTCOMES);
      nullableBoundedString(payload["errorCode"], "errorCode", 128, true);
      nullableSha256(payload["beforeFileHash"], "beforeFileHash");
      nullableSha256(payload["afterFileHash"], "afterFileHash");
      sha256(payload["workspaceHashAfter"], "workspaceHashAfter");
      return;
    case "checkpoint.recorded":
      exactKeys(payload, ["checkpointHash", "projectionHash", "workspaceHash", "chainHeadBefore"]);
      sha256(payload["checkpointHash"], "checkpointHash");
      sha256(payload["projectionHash"], "projectionHash");
      sha256(payload["workspaceHash"], "workspaceHash");
      sha256(payload["chainHeadBefore"], "chainHeadBefore");
      return;
    case "verification.recorded": {
      exactKeys(payload, [
        "evidenceId",
        "resultHash",
        "artifactHash",
        "workspaceHash",
        "discoveredChecks",
        "passedChecks"
      ]);
      identifier(payload["evidenceId"], "evidenceId");
      sha256(payload["resultHash"], "resultHash");
      sha256(payload["artifactHash"], "artifactHash");
      sha256(payload["workspaceHash"], "workspaceHash");
      const discovered = integer(payload["discoveredChecks"], "discoveredChecks", 1);
      const passed = integer(payload["passedChecks"], "passedChecks", 0);
      if (passed > discovered) throw new TypeError("passedChecks cannot exceed discoveredChecks.");
      return;
    }
    case "evaluation.recorded":
      exactKeys(payload, [
        "evaluationId",
        "verdict",
        "artifactHash",
        "projectionHash",
        "workspaceHash",
        "eventChainHead",
        "evidenceHashes"
      ]);
      identifier(payload["evaluationId"], "evaluationId");
      enumString(payload["verdict"], "verdict", EVALUATION_VERDICTS);
      sha256(payload["artifactHash"], "artifactHash");
      sha256(payload["projectionHash"], "projectionHash");
      sha256(payload["workspaceHash"], "workspaceHash");
      sha256(payload["eventChainHead"], "eventChainHead");
      sha256Array(payload["evidenceHashes"], "evidenceHashes", 1, 1_024);
      return;
    case "run.interrupted":
      exactKeys(payload, ["point", "reason"]);
      enumString(payload["point"], "point", INTERRUPTION_POINTS);
      boundedString(payload["reason"], "reason", 1, 1_024);
      return;
    case "run.cancelled":
    case "run.blocked":
    case "run.failed":
      exactKeys(payload, ["reason"]);
      boundedString(payload["reason"], "reason", 1, 1_024);
      return;
    case "run.completed":
      exactKeys(payload, [
        "projectionHash",
        "workspaceHash",
        "evaluationId",
        "evaluationEventHash",
        "evaluationArtifactHash",
        "verificationResultHash"
      ]);
      sha256(payload["projectionHash"], "projectionHash");
      sha256(payload["workspaceHash"], "workspaceHash");
      identifier(payload["evaluationId"], "evaluationId");
      sha256(payload["evaluationEventHash"], "evaluationEventHash");
      sha256(payload["evaluationArtifactHash"], "evaluationArtifactHash");
      sha256(payload["verificationResultHash"], "verificationResultHash");
  }
}

function validateRunCreated(payload: EventPayload): void {
  exactKeys(payload, [
    "taskId",
    "descriptorHash",
    "parentRunId",
    "sourceFixtureHash",
    "policyVersion",
    "policyHash",
    "workContractHash",
    "maxDecisions",
    "maxToolDispatches",
    "assets"
  ]);
  identifier(payload["taskId"], "taskId");
  sha256(payload["descriptorHash"], "descriptorHash");
  if (payload["parentRunId"] !== null) identifier(payload["parentRunId"], "parentRunId");
  sha256(payload["sourceFixtureHash"], "sourceFixtureHash");
  const policyVersion = boundedString(payload["policyVersion"], "policyVersion", 1, 128);
  if (!SEMVER.test(policyVersion))
    throw new TypeError("policyVersion must be semantic version text.");
  sha256(payload["policyHash"], "policyHash");
  sha256(payload["workContractHash"], "workContractHash");
  integer(payload["maxDecisions"], "maxDecisions", 1);
  integer(payload["maxToolDispatches"], "maxToolDispatches", 0);
  const assets = object(payload["assets"], "assets");
  exactKeys(assets, [
    "promptVersion",
    "promptHash",
    "skillHashes",
    "evaluatorRubricVersion",
    "evaluatorRubricHash",
    "mcpProtocolVersion",
    "telemetryVersion",
    "toolSchemaVersion",
    "sandboxProfile"
  ]);
  boundedString(assets["promptVersion"], "assets.promptVersion", 1, 128);
  sha256(assets["promptHash"], "assets.promptHash");
  sha256Array(assets["skillHashes"], "assets.skillHashes", 0, 128);
  boundedString(assets["evaluatorRubricVersion"], "assets.evaluatorRubricVersion", 1, 128);
  sha256(assets["evaluatorRubricHash"], "assets.evaluatorRubricHash");
  boundedString(assets["mcpProtocolVersion"], "assets.mcpProtocolVersion", 1, 128);
  boundedString(assets["telemetryVersion"], "assets.telemetryVersion", 1, 128);
  boundedString(assets["toolSchemaVersion"], "assets.toolSchemaVersion", 1, 128);
  boundedString(assets["sandboxProfile"], "assets.sandboxProfile", 1, 256);
}

function exactKeys(value: Readonly<Record<string, JsonValue>>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new TypeError(`Event payload fields are invalid; expected ${required.join(", ")}.`);
  }
}

function object(value: JsonValue | undefined, name: string): Readonly<Record<string, JsonValue>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value as Readonly<Record<string, JsonValue>>;
}

function boundedString(
  value: JsonValue | undefined,
  name: string,
  minimum: number,
  maximum: number
): string {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) {
    throw new TypeError(`${name} must contain ${minimum} to ${maximum} characters.`);
  }
  return value;
}

function nullableBoundedString(
  value: JsonValue | undefined,
  name: string,
  maximum: number,
  allowEmpty = false
): void {
  if (value === null) return;
  boundedString(value, name, allowEmpty ? 0 : 1, maximum);
}

function identifier(value: JsonValue | undefined, name: string): void {
  const text = boundedString(value, name, 1, 128);
  if (!IDENTIFIER.test(text)) throw new TypeError(`${name} must be an identifier.`);
}

function sha256(value: JsonValue | undefined, name: string): void {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new TypeError(`${name} must be a lowercase SHA-256 value.`);
  }
}

function nullableSha256(value: JsonValue | undefined, name: string): void {
  if (value !== null) sha256(value, name);
}

function integer(
  value: JsonValue | undefined,
  name: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  if (
    !Number.isSafeInteger(value) ||
    typeof value !== "number" ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(`${name} must be a safe integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function enumString(
  value: JsonValue | undefined,
  name: string,
  allowed: ReadonlySet<string>
): void {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new TypeError(`${name} has an unsupported value.`);
  }
}

function identifierArray(
  value: JsonValue | undefined,
  name: string,
  minimum: number,
  maximum: number
): void {
  const values = array(value, name, minimum, maximum);
  for (const item of values) identifier(item, name);
  requireUnique(values, name);
}

function sha256Array(
  value: JsonValue | undefined,
  name: string,
  minimum: number,
  maximum: number
): void {
  const values = array(value, name, minimum, maximum);
  for (const item of values) sha256(item, name);
  requireUnique(values, name);
}

function array(
  value: JsonValue | undefined,
  name: string,
  minimum: number,
  maximum: number
): readonly JsonValue[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new TypeError(`${name} must contain ${minimum} to ${maximum} items.`);
  }
  return value;
}

function requireUnique(values: readonly JsonValue[], name: string): void {
  if (new Set(values).size !== values.length) throw new TypeError(`${name} items must be unique.`);
}
