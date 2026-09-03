import type { RunProjection } from "./runs.js";

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "informational";

export interface VerificationSummary {
  readonly evidenceId: string;
  readonly workspaceHash: string;
  readonly eventChainHead: string;
  readonly discoveredChecks: number;
  readonly passedChecks: number;
  readonly discoveredTests: number | null;
  readonly passedTests: number | null;
  readonly baselinePassingTests: number | null;
  readonly cached: boolean;
  readonly capturedAt: Date;
}

export interface EvaluatorCapabilities {
  readonly readOnly: boolean;
  readonly filesystemWrite: boolean;
  readonly process: boolean;
  readonly network: boolean;
  readonly provider: boolean;
  readonly approval: boolean;
  readonly secret: boolean;
}

export interface EvaluationFinding {
  readonly findingId: string;
  readonly severity: FindingSeverity;
  readonly waived: boolean;
}

export interface EvaluationSummary {
  readonly evaluationId: string;
  readonly verdict: string;
  readonly projectionHash: string;
  readonly workspaceHash: string;
  readonly eventChainHead: string;
  readonly capabilities: EvaluatorCapabilities;
  readonly findings: readonly EvaluationFinding[];
  readonly evaluatedMutationSequence: number;
}

export interface CompletionDecision {
  readonly isAllowed: boolean;
  readonly reasons: readonly string[];
}

export function evaluateCompletion(
  projection: RunProjection,
  verification: VerificationSummary,
  evaluation: EvaluationSummary,
  currentWorkspaceHash: string,
  currentProjectionHash: string,
  now: Date,
  maximumEvidenceAgeMs: number
): CompletionDecision {
  const reasons: string[] = [];
  if (projection.status !== "reviewing") reasons.push("Run is not in reviewing state.");
  if (
    !projection.verificationRecorded ||
    verification.discoveredChecks < 1 ||
    verification.passedChecks !== verification.discoveredChecks
  ) {
    reasons.push("Required verification checks did not pass.");
  }
  if (
    verification.discoveredTests !== null &&
    (verification.discoveredTests < 1 || verification.passedTests !== verification.discoveredTests)
  ) {
    reasons.push("Executable test discovery or pass count is invalid.");
  }
  if (
    verification.baselinePassingTests !== null &&
    verification.passedTests !== null &&
    verification.passedTests < verification.baselinePassingTests
  ) {
    reasons.push("Passing test count declined below baseline.");
  }
  if (verification.cached) reasons.push("Verification evidence is cached.");
  const age = now.getTime() - verification.capturedAt.getTime();
  if (age < 0 || age > maximumEvidenceAgeMs) reasons.push("Verification evidence is stale.");
  if (
    verification.workspaceHash !== currentWorkspaceHash ||
    evaluation.workspaceHash !== currentWorkspaceHash
  ) {
    reasons.push("Evidence is bound to a different workspace hash.");
  }
  if (evaluation.projectionHash !== currentProjectionHash) {
    reasons.push("Evaluation is bound to a different projection hash.");
  }
  if (evaluation.eventChainHead !== projection.eventChainHead) {
    reasons.push("Evaluation is bound to a different event-chain head.");
  }
  if (evaluation.verdict !== "approved") {
    reasons.push("Independent evaluator did not approve the run.");
  }
  if (!isStrictlyReadOnly(evaluation.capabilities)) {
    reasons.push("Evaluator has write-capable or privileged dependencies.");
  }
  if (evaluation.evaluatedMutationSequence !== projection.lastMutationSequence) {
    reasons.push("Workspace mutated after the evaluated state.");
  }
  if (
    evaluation.findings.some(
      (finding) => !finding.waived && ["critical", "high", "medium"].includes(finding.severity)
    )
  ) {
    reasons.push("Blocking evaluator findings remain unresolved.");
  }
  return { isAllowed: reasons.length === 0, reasons };
}

export function isStrictlyReadOnly(capabilities: EvaluatorCapabilities): boolean {
  return (
    capabilities.readOnly &&
    !capabilities.filesystemWrite &&
    !capabilities.process &&
    !capabilities.network &&
    !capabilities.provider &&
    !capabilities.approval &&
    !capabilities.secret
  );
}
