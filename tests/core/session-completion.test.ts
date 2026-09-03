import { describe, expect, it } from "vitest";
import { emptySessionProjection } from "../../src/core/sessions.js";
import {
  evaluateSessionCompletion,
  type SessionEvaluationSummary,
  type SessionVerificationSummary
} from "../../src/core/session-completion.js";

const hash = "a".repeat(64);
const otherHash = "b".repeat(64);
const now = new Date("2026-09-03T00:05:00Z");

describe("evaluateSessionCompletion", () => {
  const projection = {
    ...emptySessionProjection("session-1"),
    taskId: "task-1",
    status: "evaluating" as const,
    eventChainHead: hash,
    verificationRecorded: true,
    verificationSequence: 8,
    evaluationSequence: 9,
    lastMutationSequence: 7
  };
  const verification: SessionVerificationSummary = {
    evidenceId: "evidence-1",
    workspaceHash: hash,
    eventChainHead: hash,
    discoveredChecks: 4,
    passedChecks: 4,
    discoveredTests: null,
    passedTests: null,
    baselinePassingTests: null,
    cached: false,
    capturedAt: new Date("2026-09-03T00:04:00Z")
  };
  const evaluation: SessionEvaluationSummary = {
    evaluationId: "evaluation-1",
    verdict: "approved",
    projectionHash: hash,
    workspaceHash: hash,
    eventChainHead: hash,
    capabilities: {
      readOnly: true,
      filesystemWrite: false,
      process: false,
      network: false,
      provider: false,
      approval: false,
      secret: false
    },
    findings: [],
    evaluatedMutationSequence: 7
  };

  it("allows a fresh, exact, read-only approved session", () => {
    expect(
      evaluateSessionCompletion(projection, verification, evaluation, hash, hash, now, 30 * 60_000)
    ).toEqual({ isAllowed: true, reasons: [] });
  });

  it("rejects with a STALE-labeled reason when the working tree changed after verification", () => {
    const result = evaluateSessionCompletion(
      projection,
      { ...verification, workspaceHash: otherHash },
      { ...evaluation, workspaceHash: otherHash },
      hash,
      hash,
      now,
      30 * 60_000
    );
    expect(result.isAllowed).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        "Verification working-tree fingerprint is STALE.",
        "Evaluation working-tree fingerprint is STALE."
      ])
    );
  });

  it.each([
    ["cached", { verification: { ...verification, cached: true } }],
    ["evidence-age-stale", { verification: { ...verification, capturedAt: new Date(0) } }],
    [
      "write-capable evaluator",
      {
        evaluation: {
          ...evaluation,
          capabilities: { ...evaluation.capabilities, filesystemWrite: true }
        }
      }
    ],
    [
      "blocking finding",
      {
        evaluation: {
          ...evaluation,
          findings: [{ findingId: "f-1", severity: "high" as const, waived: false }]
        }
      }
    ],
    ["not evaluating", { projection: { ...projection, status: "running" as const } }],
    ["wrong verdict", { evaluation: { ...evaluation, verdict: "changes_requested" } }]
  ])("rejects %s evidence", (_name, changes) => {
    const result = evaluateSessionCompletion(
      "projection" in changes ? changes.projection : projection,
      "verification" in changes ? changes.verification : verification,
      "evaluation" in changes ? changes.evaluation : evaluation,
      hash,
      hash,
      now,
      30 * 60_000
    );
    expect(result.isAllowed).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});
