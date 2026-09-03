import type { EventPayload, EventType } from "../../src/core/events.js";

export const TEST_HASH = "a".repeat(64);

export function validEventPayload(
  eventType: EventType,
  overrides: EventPayload = {}
): EventPayload {
  return { ...basePayload(eventType), ...overrides };
}

function basePayload(eventType: EventType): EventPayload {
  switch (eventType) {
    case "run.created":
      return {
        taskId: "task-1",
        descriptorHash: TEST_HASH,
        parentRunId: null,
        sourceFixtureHash: TEST_HASH,
        policyVersion: "1.0.0",
        policyHash: TEST_HASH,
        workContractHash: TEST_HASH,
        maxDecisions: 1,
        maxToolDispatches: 1,
        assets: {
          promptVersion: "prompt-v1",
          promptHash: TEST_HASH,
          skillHashes: [TEST_HASH],
          evaluatorRubricVersion: "1.0.0",
          evaluatorRubricHash: TEST_HASH,
          mcpProtocolVersion: "2026-07-28",
          telemetryVersion: "1.0.0",
          toolSchemaVersion: "1.0.0",
          sandboxProfile: "test-confinement"
        }
      };
    case "state.transitioned":
      return { from: "queued", to: "preparing", reason: "test" };
    case "instruction.selected":
      return { relativePath: null, contentHash: TEST_HASH, byteLength: 0 };
    case "provider.decision_recorded":
      return {
        decisionId: "decision-1",
        toolName: "workspace.replace_exact_text",
        argumentsHash: TEST_HASH,
        idempotencyKey: "replace-1",
        actionSignature: TEST_HASH,
        inputTokens: 0,
        outputTokens: 0,
        costMinorUnits: 0
      };
    case "policy.decision_recorded":
      return {
        policyDecisionId: "policy-1",
        toolName: "workspace.replace_exact_text",
        actionClass: "workspace_write",
        outcome: "allowed",
        ruleIds: ["allow-write"]
      };
    case "tool.dispatched":
      return {
        toolCallId: "tool-1",
        toolName: "workspace.replace_exact_text",
        idempotencyKey: "replace-1",
        workspaceHashBefore: TEST_HASH
      };
    case "tool.completed":
      return {
        toolCallId: "tool-1",
        idempotencyKey: "replace-1",
        outcome: "succeeded",
        errorCode: null,
        beforeFileHash: TEST_HASH,
        afterFileHash: TEST_HASH,
        workspaceHashAfter: TEST_HASH
      };
    case "checkpoint.recorded":
      return {
        checkpointHash: TEST_HASH,
        projectionHash: TEST_HASH,
        workspaceHash: TEST_HASH,
        chainHeadBefore: TEST_HASH
      };
    case "verification.recorded":
      return {
        evidenceId: "evidence-1",
        resultHash: TEST_HASH,
        artifactHash: TEST_HASH,
        workspaceHash: TEST_HASH,
        discoveredChecks: 1,
        passedChecks: 1
      };
    case "evaluation.recorded":
      return {
        evaluationId: "evaluation-1",
        verdict: "approved",
        artifactHash: TEST_HASH,
        projectionHash: TEST_HASH,
        workspaceHash: TEST_HASH,
        eventChainHead: TEST_HASH,
        evidenceHashes: [TEST_HASH]
      };
    case "run.interrupted":
      return { point: "operator_pause", reason: "test" };
    case "run.cancelled":
    case "run.blocked":
    case "run.failed":
      return { reason: "test" };
    case "run.completed":
      return {
        projectionHash: TEST_HASH,
        workspaceHash: TEST_HASH,
        evaluationId: "evaluation-1",
        evaluationEventHash: TEST_HASH,
        evaluationArtifactHash: TEST_HASH,
        verificationResultHash: TEST_HASH
      };
  }
}
