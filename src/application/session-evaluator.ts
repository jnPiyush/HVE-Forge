import type {
  SessionEvaluationFinding,
  SessionFindingSeverity
} from "../core/session-completion.js";
import type { SessionProjection } from "../core/sessions.js";
import { sessionProjectionHash } from "../core/sessions.js";
import { isSupportedContract, isSupportedRubric } from "./evaluator.js";
import type {
  EvaluatorRubric,
  SessionDescriptor,
  SessionEvaluationArtifact,
  SessionVerificationArtifact,
  WorkContract
} from "./session-contracts.js";

export { isSupportedContract, isSupportedRubric };

const SHA256 = /^[a-f0-9]{64}$/;

/**
 * Schema-v2 analog of `ReadOnlyEvaluator`. Depends only on the parsed work contract, the
 * immutable session projection, the rubric, and named evidence values -- no store, dispatcher,
 * filesystem, process, network, provider, or secret port, matching the read-only isolation
 * required of the schema-v1 evaluator.
 */
export class SessionEvaluator {
  public evaluate(
    descriptor: SessionDescriptor,
    contract: WorkContract,
    rubric: EvaluatorRubric,
    projection: SessionProjection,
    verification: SessionVerificationArtifact,
    workspaceHash: string,
    expectedWorkContractHash: string,
    actualWorkContractHash: string,
    expectedRubricHash: string,
    actualRubricHash: string,
    evaluatedAt: string
  ): SessionEvaluationArtifact {
    const findings: SessionEvaluationFinding[] = [];
    const push = (findingId: string, severity: SessionFindingSeverity = "high") =>
      findings.push({ findingId, severity, waived: false });

    const rubricValid = isSupportedRubric(rubric, descriptor.assets.evaluatorRubricVersion);
    if (!rubricValid) push("rubric-invalid");
    const structuredContractValid =
      descriptor.objective.trim() !== "" &&
      descriptor.targetRelativePath.trim() !== "" &&
      descriptor.limits.maxTurns >= 1 &&
      descriptor.limits.maxToolDispatches >= 0;
    const contractValid = isSupportedContract(contract, descriptor.taskId);
    if (!structuredContractValid || !contractValid) push("contract-invalid");

    const checks = verification.checks;
    const checksConsistent =
      checks.length === verification.summary.discoveredChecks &&
      checks.filter((check) => check.passed).length === verification.summary.passedChecks &&
      new Set(checks.map((check) => check.criterionId)).size === checks.length;
    const blockingCriteriaPassed =
      contractValid &&
      contract.acceptanceCriteria
        .filter((criterion) => criterion.blocking)
        .every((criterion) =>
          checks.some((check) => check.criterionId === criterion.id && check.passed)
        );
    if (!blockingCriteriaPassed) push("acceptance-criteria-failed");
    if (!projection.verificationRecorded) push("verification-missing");
    if (verification.summary.workspaceHash !== workspaceHash) push("workspace-hash-mismatch");
    if (
      !checksConsistent ||
      verification.summary.passedChecks !== verification.summary.discoveredChecks
    ) {
      push("verification-failed");
    }
    if (expectedWorkContractHash !== actualWorkContractHash) push("contract-hash-mismatch");
    if (expectedRubricHash !== actualRubricHash) push("rubric-hash-mismatch");

    const verificationPassed =
      projection.verificationRecorded &&
      checksConsistent &&
      blockingCriteriaPassed &&
      verification.summary.discoveredChecks > 0 &&
      verification.summary.passedChecks === verification.summary.discoveredChecks;
    const exactHashes =
      expectedWorkContractHash === actualWorkContractHash &&
      expectedRubricHash === actualRubricHash &&
      verification.summary.workspaceHash === workspaceHash;
    const maintainable =
      descriptor.schemaVersion === "2.0" &&
      SHA256.test(descriptor.policyHash) &&
      SHA256.test(descriptor.assets.promptHash) &&
      descriptor.assets.skillHashes.every((hash) => SHA256.test(hash)) &&
      SHA256.test(descriptor.assets.evaluatorRubricHash);

    const scores = Object.fromEntries(
      rubric.dimensions.map((dimension) => [
        dimension,
        scoreDimension(
          dimension,
          structuredContractValid,
          contractValid,
          rubricValid,
          verificationPassed,
          checksConsistent,
          blockingCriteriaPassed,
          exactHashes,
          maintainable,
          projection,
          descriptor
        )
      ])
    );
    return {
      summary: {
        evaluationId: "evaluation-final",
        verdict: findings.length === 0 ? "approved" : "changes_requested",
        projectionHash: sessionProjectionHash(projection),
        workspaceHash,
        eventChainHead: projection.eventChainHead,
        capabilities: {
          readOnly: true,
          filesystemWrite: false,
          process: false,
          network: false,
          provider: false,
          approval: false,
          secret: false
        },
        findings,
        evaluatedMutationSequence: projection.lastMutationSequence
      },
      scores,
      evidenceHashes: [verification.resultHash],
      startedAt: evaluatedAt,
      endedAt: evaluatedAt
    };
  }
}

function scoreDimension(
  dimension: string,
  structuredContractValid: boolean,
  contractValid: boolean,
  rubricValid: boolean,
  verificationPassed: boolean,
  checksConsistent: boolean,
  blockingCriteriaPassed: boolean,
  exactHashes: boolean,
  maintainable: boolean,
  projection: SessionProjection,
  descriptor: SessionDescriptor
): number {
  const pass = (() => {
    switch (dimension) {
      case "requirements_fit":
        return structuredContractValid && contractValid && verificationPassed && exactHashes;
      case "design_conformance":
        return structuredContractValid && contractValid && rubricValid && maintainable;
      case "logic":
        return verificationPassed;
      case "tests":
        return checksConsistent;
      case "security_privacy":
        return blockingCriteriaPassed && exactHashes;
      case "reliability":
        return (
          verificationPassed && projection.lastMutationSequence < projection.verificationSequence
        );
      case "maintainability":
        return maintainable;
      case "scope_simplicity":
        return structuredContractValid && contractValid;
      case "performance_resources":
        return descriptor.limits.maxTotalCostMinorUnits === 0;
      case "operability":
        return projection.status === "evaluating" && projection.lastSequence > 0;
      default:
        return false;
    }
  })();
  return pass ? 5 : 0;
}
