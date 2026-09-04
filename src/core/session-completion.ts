import { gradeFreshness } from "./freshness.js";
import type { SessionProjection } from "./sessions.js";

/**
 * Schema-v2 analog of `evaluateCompletion` in `completion.ts`. The check semantics mirror the
 * schema-v1 gate exactly (fresh hash-bound evidence, a passing read-only evaluation, no
 * regression, no blocking finding); only the session status vocabulary differs (`evaluating`
 * replaces `reviewing`) because the bounded loop has no single-decision review stage. Workspace
 * identity checks are expressed with the named `FRESH`/`STALE`/`MISSING` grades from
 * `freshness.ts` (SPEC-004 section 5.2) instead of a raw hash inequality, so a caller gets an
 * actionable reason rather than a generic mismatch message.
 */

export type SessionFindingSeverity = "critical" | "high" | "medium" | "low" | "informational";

export interface SessionVerificationSummary {
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

export interface SessionEvaluatorCapabilities {
  readonly readOnly: boolean;
  readonly filesystemWrite: boolean;
  readonly process: boolean;
  readonly network: boolean;
  readonly provider: boolean;
  readonly approval: boolean;
  readonly secret: boolean;
}

export interface SessionEvaluationFinding {
  readonly findingId: string;
  readonly severity: SessionFindingSeverity;
  readonly waived: boolean;
}

export interface SessionEvaluationSummary {
  readonly evaluationId: string;
  readonly verdict: string;
  readonly projectionHash: string;
  readonly workspaceHash: string;
  readonly eventChainHead: string;
  readonly capabilities: SessionEvaluatorCapabilities;
  readonly findings: readonly SessionEvaluationFinding[];
  readonly evaluatedMutationSequence: number;
}

export interface SessionCompletionDecision {
  readonly isAllowed: boolean;
  readonly reasons: readonly string[];
}

export function evaluateSessionCompletion(
  projection: SessionProjection,
  verification: SessionVerificationSummary,
  evaluation: SessionEvaluationSummary,
  currentWorkspaceHash: string,
  currentProjectionHash: string,
  now: Date,
  maximumEvidenceAgeMs: number
): SessionCompletionDecision {
  const reasons: string[] = [];
  if (projection.status !== "evaluating") reasons.push("Session is not in evaluating state.");
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
  const verificationFreshness = gradeFreshness(verification.workspaceHash, currentWorkspaceHash);
  const evaluationFreshness = gradeFreshness(evaluation.workspaceHash, currentWorkspaceHash);
  if (verificationFreshness !== "FRESH") {
    reasons.push(`Verification working-tree fingerprint is ${verificationFreshness}.`);
  }
  if (evaluationFreshness !== "FRESH") {
    reasons.push(`Evaluation working-tree fingerprint is ${evaluationFreshness}.`);
  }
  if (evaluation.projectionHash !== currentProjectionHash) {
    reasons.push("Evaluation is bound to a different projection hash.");
  }
  if (evaluation.eventChainHead !== projection.eventChainHead) {
    reasons.push("Evaluation is bound to a different event-chain head.");
  }
  if (evaluation.verdict !== "approved") {
    reasons.push("Independent evaluator did not approve the session.");
  }
  if (!isSessionStrictlyReadOnly(evaluation.capabilities)) {
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

export function isSessionStrictlyReadOnly(capabilities: SessionEvaluatorCapabilities): boolean {
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
