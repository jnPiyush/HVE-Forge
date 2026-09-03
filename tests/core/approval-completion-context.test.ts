import { describe, expect, it } from "vitest";
import { evaluateApproval } from "../../src/core/approval.js";
import { type EvaluationSummary, evaluateCompletion } from "../../src/core/completion.js";
import { decideContinuity } from "../../src/core/context.js";
import { emptyProjection } from "../../src/core/runs.js";

const now = new Date("2026-09-01T00:05:00Z");
const hash = "a".repeat(64);

describe("approval gate", () => {
  const request = {
    approvalId: "approval-1",
    runId: "run-1",
    requesterId: "agent:generator",
    actionClass: "destructive" as const,
    actionHash: hash,
    requestedAt: new Date("2026-09-01T00:00:00Z"),
    expiresAt: new Date("2026-09-01T00:10:00Z")
  };

  it("allows read and workspace writes without high-risk approval", () => {
    expect(evaluateApproval({ ...request, actionClass: "read" }, null, now).isAllowed).toBe(true);
    expect(
      evaluateApproval({ ...request, actionClass: "workspace_write" }, null, now).isAllowed
    ).toBe(true);
  });

  it("requires an exact human approval", () => {
    expect(evaluateApproval(request, null, now).isAllowed).toBe(false);
    expect(
      evaluateApproval(
        request,
        {
          approvalId: "approval-1",
          approverId: "human:operator",
          actionHash: hash,
          approved: true,
          decidedAt: new Date("2026-09-01T00:04:00Z")
        },
        now
      ).isAllowed
    ).toBe(true);
    expect(
      evaluateApproval(
        request,
        {
          approvalId: "approval-1",
          approverId: "agent:reviewer",
          actionHash: hash,
          approved: true,
          decidedAt: new Date("2026-09-01T00:04:00Z")
        },
        now
      ).isAllowed
    ).toBe(false);
  });

  it("rejects expired, mismatched, denied, and time-invalid approvals", () => {
    const baseline = {
      approvalId: "approval-1",
      approverId: "human:operator",
      actionHash: hash,
      approved: true,
      decidedAt: new Date("2026-09-01T00:04:00Z")
    };
    expect(evaluateApproval({ ...request, expiresAt: now }, baseline, now).isAllowed).toBe(false);
    expect(
      evaluateApproval(request, { ...baseline, actionHash: "b".repeat(64) }, now).isAllowed
    ).toBe(false);
    expect(evaluateApproval(request, { ...baseline, approved: false }, now).isAllowed).toBe(false);
    expect(
      evaluateApproval(request, { ...baseline, decidedAt: new Date("2025-01-01T00:00:00Z") }, now)
        .isAllowed
    ).toBe(false);
  });
});

describe("completion gate", () => {
  const projection = {
    ...emptyProjection("run-1"),
    taskId: "task-1",
    status: "reviewing" as const,
    eventChainHead: hash,
    verificationRecorded: true,
    lastMutationSequence: 7
  };
  const verification = {
    evidenceId: "evidence-1",
    workspaceHash: hash,
    eventChainHead: hash,
    discoveredChecks: 4,
    passedChecks: 4,
    discoveredTests: 10,
    passedTests: 10,
    baselinePassingTests: 10,
    cached: false,
    capturedAt: new Date("2026-09-01T00:04:00Z")
  };
  const evaluation: EvaluationSummary = {
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

  it("allows only fresh, exact, read-only approval evidence", () => {
    expect(
      evaluateCompletion(projection, verification, evaluation, hash, hash, now, 30 * 60_000)
    ).toEqual({ isAllowed: true, reasons: [] });
  });

  it.each([
    ["cached", { verification: { ...verification, cached: true } }],
    ["stale", { verification: { ...verification, capturedAt: new Date(0) } }],
    [
      "write-capable",
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
    ]
  ])("rejects %s evidence", (_name, changes) => {
    const result = evaluateCompletion(
      projection,
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

  it("rejects failed tests, regressed baseline, wrong bindings, verdict, and mutation", () => {
    const cases = [
      { verification: { ...verification, discoveredChecks: 0, passedChecks: 0 } },
      { verification: { ...verification, passedTests: 9 } },
      { verification: { ...verification, baselinePassingTests: 11 } },
      { workspaceHash: "b".repeat(64) },
      { evaluation: { ...evaluation, projectionHash: "b".repeat(64) } },
      { evaluation: { ...evaluation, eventChainHead: "b".repeat(64) } },
      { evaluation: { ...evaluation, verdict: "changes_requested" } },
      { evaluation: { ...evaluation, evaluatedMutationSequence: 6 } }
    ];
    for (const changes of cases) {
      const result = evaluateCompletion(
        projection,
        "verification" in changes ? changes.verification : verification,
        "evaluation" in changes ? changes.evaluation : evaluation,
        "workspaceHash" in changes ? changes.workspaceHash : hash,
        hash,
        now,
        30 * 60_000
      );
      expect(result.isAllowed).toBe(false);
    }
  });
});

describe("context continuity", () => {
  const healthy = {
    usedTokens: 1_000,
    maximumTokens: 10_000,
    reservedOutputTokens: 1_000,
    repeatedReads: 0,
    goalDrift: false,
    stalePlan: false,
    validatedHandoffAvailable: false
  };

  it("continues, compacts, resets, or stops from deterministic signals", () => {
    expect(decideContinuity(healthy).action).toBe("continue");
    expect(decideContinuity({ ...healthy, usedTokens: 8_000 }).action).toBe("compact");
    expect(
      decideContinuity({ ...healthy, goalDrift: true, validatedHandoffAvailable: true }).action
    ).toBe("reset_with_handoff");
    expect(decideContinuity({ ...healthy, usedTokens: 9_000 }).action).toBe("stop");
  });

  it("validates context signal bounds", () => {
    expect(() => decideContinuity({ ...healthy, usedTokens: -1 })).toThrow(RangeError);
    expect(() => decideContinuity({ ...healthy, maximumTokens: 0 })).toThrow(RangeError);
    expect(() => decideContinuity({ ...healthy, reservedOutputTokens: 10_000 })).toThrow(
      RangeError
    );
    expect(decideContinuity({ ...healthy, repeatedReads: 3 }).action).toBe("compact");
    expect(decideContinuity({ ...healthy, stalePlan: true }).action).toBe("stop");
  });
});
