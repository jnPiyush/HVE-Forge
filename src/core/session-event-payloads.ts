import type { JsonValue } from "./canonical-json.js";
import type { SessionEventPayload, SessionEventType } from "./session-events.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TOOL_ID = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const FINISH_REASONS = new Set([
  "completed",
  "tool_calls",
  "length",
  "cancelled",
  "content_filter",
  "error"
]);
const TOOL_CALL_OUTCOMES = new Set(["succeeded", "failed", "cancelled"]);
const EVALUATION_VERDICTS = new Set(["approved", "changes_requested", "blocked"]);
const LOOP_STOP_REASONS = new Set([
  "provider_completed",
  "decision_budget_exhausted",
  "wall_clock_exhausted",
  "oscillation_detected",
  "failed_fix_exhausted",
  "cancelled"
]);
const COST_MODES = new Set(["host_managed", "metered"]);

export function assertSessionEventPayload(
  eventType: SessionEventType,
  payload: SessionEventPayload
): void {
  switch (eventType) {
    case "session.created":
      validateSessionCreated(payload);
      return;
    case "turn.requested":
      exactKeys(payload, ["turnNumber", "requestHash"]);
      integer(payload["turnNumber"], "turnNumber", 1);
      sha256(payload["requestHash"], "requestHash");
      return;
    case "turn.completed":
      exactKeys(payload, [
        "turnNumber",
        "requestHash",
        "responseHash",
        "actionSignature",
        "finishReason",
        "toolCallCount",
        "inputTokens",
        "outputTokens",
        "cachedTokens",
        "reasoningTokens",
        "costMode",
        "costMinorUnits"
      ]);
      integer(payload["turnNumber"], "turnNumber", 1);
      sha256(payload["requestHash"], "requestHash");
      sha256(payload["responseHash"], "responseHash");
      sha256(payload["actionSignature"], "actionSignature");
      enumString(payload["finishReason"], "finishReason", FINISH_REASONS);
      integer(payload["toolCallCount"], "toolCallCount", 0, 16);
      integer(payload["inputTokens"], "inputTokens", 0);
      integer(payload["outputTokens"], "outputTokens", 0);
      integer(payload["cachedTokens"], "cachedTokens", 0);
      integer(payload["reasoningTokens"], "reasoningTokens", 0);
      costUsage(payload);
      return;
    case "tool.call_dispatched":
      exactKeys(payload, [
        "turnNumber",
        "callIndex",
        "callId",
        "toolId",
        "idempotencyKey",
        "workspaceHashBefore"
      ]);
      integer(payload["turnNumber"], "turnNumber", 1);
      integer(payload["callIndex"], "callIndex", 0, 15);
      identifier(payload["callId"], "callId");
      toolId(payload["toolId"], "toolId");
      identifier(payload["idempotencyKey"], "idempotencyKey");
      sha256(payload["workspaceHashBefore"], "workspaceHashBefore");
      return;
    case "tool.call_completed":
      exactKeys(payload, [
        "turnNumber",
        "callIndex",
        "callId",
        "idempotencyKey",
        "outcome",
        "errorCode",
        "beforeFileHash",
        "afterFileHash",
        "outputHash",
        "workspaceHashAfter"
      ]);
      integer(payload["turnNumber"], "turnNumber", 1);
      integer(payload["callIndex"], "callIndex", 0, 15);
      identifier(payload["callId"], "callId");
      identifier(payload["idempotencyKey"], "idempotencyKey");
      enumString(payload["outcome"], "outcome", TOOL_CALL_OUTCOMES);
      nullableBoundedString(payload["errorCode"], "errorCode", 128);
      nullableSha256(payload["beforeFileHash"], "beforeFileHash");
      nullableSha256(payload["afterFileHash"], "afterFileHash");
      nullableSha256(payload["outputHash"], "outputHash");
      sha256(payload["workspaceHashAfter"], "workspaceHashAfter");
      return;
    case "verification.recorded": {
      exactKeys(payload, [
        "turnNumber",
        "attemptNumber",
        "evidenceId",
        "resultHash",
        "artifactHash",
        "workspaceHash",
        "discoveredChecks",
        "passedChecks"
      ]);
      integer(payload["turnNumber"], "turnNumber", 1);
      integer(payload["attemptNumber"], "attemptNumber", 1);
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
    case "loop.stopped":
      exactKeys(payload, ["reason", "turnsUsed", "toolDispatchesUsed"]);
      enumString(payload["reason"], "reason", LOOP_STOP_REASONS);
      integer(payload["turnsUsed"], "turnsUsed", 0);
      integer(payload["toolDispatchesUsed"], "toolDispatchesUsed", 0);
      return;
    case "session.cancelled":
    case "session.blocked":
    case "session.failed":
      exactKeys(payload, ["reason"]);
      boundedString(payload["reason"], "reason", 1, 1_024);
      return;
    case "session.completed":
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

function validateSessionCreated(payload: SessionEventPayload): void {
  exactKeys(payload, [
    "taskId",
    "descriptorHash",
    "parentSessionId",
    "sourceFixtureHash",
    "policyVersion",
    "policyHash",
    "workContractHash",
    "limits",
    "assets"
  ]);
  identifier(payload["taskId"], "taskId");
  sha256(payload["descriptorHash"], "descriptorHash");
  if (payload["parentSessionId"] !== null)
    identifier(payload["parentSessionId"], "parentSessionId");
  sha256(payload["sourceFixtureHash"], "sourceFixtureHash");
  const policyVersion = boundedString(payload["policyVersion"], "policyVersion", 1, 128);
  if (!SEMVER.test(policyVersion))
    throw new TypeError("policyVersion must be semantic version text.");
  sha256(payload["policyHash"], "policyHash");
  sha256(payload["workContractHash"], "workContractHash");
  const limits = object(payload["limits"], "limits");
  exactKeys(limits, [
    "maxTurns",
    "maxToolDispatches",
    "maxElapsedMilliseconds",
    "maxOutputTokensPerTurn",
    "maxTotalOutputTokens",
    "maxTotalCostMinorUnits",
    "repeatedSignatureThreshold",
    "oscillationWindow",
    "maxConsecutiveFailedFixes"
  ]);
  integer(limits["maxTurns"], "limits.maxTurns", 1);
  integer(limits["maxToolDispatches"], "limits.maxToolDispatches", 0);
  integer(limits["maxElapsedMilliseconds"], "limits.maxElapsedMilliseconds", 1);
  integer(limits["maxOutputTokensPerTurn"], "limits.maxOutputTokensPerTurn", 1);
  integer(limits["maxTotalOutputTokens"], "limits.maxTotalOutputTokens", 1);
  integer(limits["maxTotalCostMinorUnits"], "limits.maxTotalCostMinorUnits", 0);
  integer(limits["repeatedSignatureThreshold"], "limits.repeatedSignatureThreshold", 1);
  integer(limits["oscillationWindow"], "limits.oscillationWindow", 1);
  integer(limits["maxConsecutiveFailedFixes"], "limits.maxConsecutiveFailedFixes", 1);
  const assets = object(payload["assets"], "assets");
  exactKeys(assets, [
    "promptVersion",
    "promptHash",
    "skillHashes",
    "evaluatorRubricVersion",
    "evaluatorRubricHash",
    "toolSchemaVersion",
    "providerAdapterVersion",
    "sandboxProfile"
  ]);
  boundedString(assets["promptVersion"], "assets.promptVersion", 1, 128);
  sha256(assets["promptHash"], "assets.promptHash");
  sha256Array(assets["skillHashes"], "assets.skillHashes", 0, 128);
  boundedString(assets["evaluatorRubricVersion"], "assets.evaluatorRubricVersion", 1, 128);
  sha256(assets["evaluatorRubricHash"], "assets.evaluatorRubricHash");
  boundedString(assets["toolSchemaVersion"], "assets.toolSchemaVersion", 1, 128);
  boundedString(assets["providerAdapterVersion"], "assets.providerAdapterVersion", 1, 128);
  boundedString(assets["sandboxProfile"], "assets.sandboxProfile", 1, 256);
}

function costUsage(payload: SessionEventPayload): void {
  const costMode = payload["costMode"];
  if (typeof costMode !== "string" || !COST_MODES.has(costMode)) {
    throw new TypeError("costMode has an unsupported value.");
  }
  const costMinorUnits = payload["costMinorUnits"];
  if (costMode === "host_managed") {
    if (costMinorUnits !== null) throw new TypeError("Host-managed cost must be null.");
  } else {
    integer(costMinorUnits, "costMinorUnits", 0);
  }
}

function exactKeys(value: Readonly<Record<string, JsonValue>>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new TypeError(
      `Session event payload fields are invalid; expected ${required.join(", ")}.`
    );
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

function nullableBoundedString(value: JsonValue | undefined, name: string, maximum: number): void {
  if (value === null) return;
  boundedString(value, name, 1, maximum);
}

function identifier(value: JsonValue | undefined, name: string): void {
  const text = boundedString(value, name, 1, 128);
  if (!IDENTIFIER.test(text)) throw new TypeError(`${name} must be an identifier.`);
}

function toolId(value: JsonValue | undefined, name: string): void {
  const text = boundedString(value, name, 1, 128);
  if (!TOOL_ID.test(text)) throw new TypeError(`${name} must be a dot-separated tool identifier.`);
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

function sha256Array(
  value: JsonValue | undefined,
  name: string,
  minimum: number,
  maximum: number
): void {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new TypeError(`${name} must contain ${minimum} to ${maximum} items.`);
  }
  for (const item of value) sha256(item, name);
  if (new Set(value).size !== value.length) throw new TypeError(`${name} items must be unique.`);
}
