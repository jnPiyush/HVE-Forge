import type { SessionEventPayload, SessionEventType } from "../../src/core/session-events.js";

export const TEST_HASH = "a".repeat(64);

export function validSessionEventPayload(
  eventType: SessionEventType,
  overrides: SessionEventPayload = {}
): SessionEventPayload {
  return { ...basePayload(eventType), ...overrides };
}

function basePayload(eventType: SessionEventType): SessionEventPayload {
  switch (eventType) {
    case "session.created":
      return {
        taskId: "task-1",
        descriptorHash: TEST_HASH,
        parentSessionId: null,
        sourceFixtureHash: TEST_HASH,
        policyVersion: "1.0.0",
        policyHash: TEST_HASH,
        workContractHash: TEST_HASH,
        limits: {
          maxTurns: 8,
          maxToolDispatches: 16,
          maxElapsedMilliseconds: 300_000,
          maxOutputTokensPerTurn: 16_000,
          maxTotalOutputTokens: 64_000,
          maxTotalCostMinorUnits: 0,
          repeatedSignatureThreshold: 2,
          oscillationWindow: 6,
          maxConsecutiveFailedFixes: 3
        },
        assets: {
          promptVersion: "prompt-v1",
          promptHash: TEST_HASH,
          skillHashes: [TEST_HASH],
          evaluatorRubricVersion: "1.0.0",
          evaluatorRubricHash: TEST_HASH,
          toolSchemaVersion: "1.0.0",
          providerAdapterVersion: "1.0.0",
          sandboxProfile: "test-confinement"
        }
      };
    case "turn.requested":
      return { turnNumber: 1, requestHash: TEST_HASH };
    case "turn.completed":
      return {
        turnNumber: 1,
        requestHash: TEST_HASH,
        responseHash: TEST_HASH,
        actionSignature: TEST_HASH,
        finishReason: "completed",
        toolCallCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        costMode: "host_managed",
        costMinorUnits: null
      };
    case "tool.call_dispatched":
      return {
        turnNumber: 1,
        callIndex: 0,
        callId: "call-1",
        toolId: "workspace.read_file",
        idempotencyKey: "call-1",
        workspaceHashBefore: TEST_HASH
      };
    case "tool.call_completed":
      return {
        turnNumber: 1,
        callIndex: 0,
        callId: "call-1",
        idempotencyKey: "call-1",
        outcome: "succeeded",
        errorCode: null,
        beforeFileHash: null,
        afterFileHash: null,
        outputHash: TEST_HASH,
        workspaceHashAfter: TEST_HASH
      };
    case "verification.recorded":
      return {
        turnNumber: 1,
        attemptNumber: 1,
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
    case "loop.stopped":
      return { reason: "provider_completed", turnsUsed: 1, toolDispatchesUsed: 0 };
    case "session.cancelled":
    case "session.blocked":
    case "session.failed":
      return { reason: "test" };
    case "session.completed":
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
