import type { RunProjection } from "../core/runs.js";
import { projectionHash } from "../core/runs.js";
import type {
  EvaluationArtifact,
  EvaluatorRubric,
  RunDescriptor,
  VerificationArtifact,
  WorkContract
} from "./contracts.js";
import { blockingFinding } from "./contracts.js";

const DIMENSIONS = new Set([
  "requirements_fit",
  "design_conformance",
  "logic",
  "tests",
  "security_privacy",
  "reliability",
  "maintainability",
  "scope_simplicity",
  "performance_resources",
  "operability"
]);
const CRITERIA = new Set([
  "replacement-present-once",
  "expected-text-absent",
  "workspace-hash-bound",
  "source-fixture-unchanged"
]);
const SHA256 = /^[a-f0-9]{64}$/;

export class ReadOnlyEvaluator {
  public evaluate(
    descriptor: RunDescriptor,
    contract: WorkContract,
    rubric: EvaluatorRubric,
    projection: RunProjection,
    verification: VerificationArtifact,
    workspaceHash: string,
    expectedWorkContractHash: string,
    actualWorkContractHash: string,
    expectedRubricHash: string,
    actualRubricHash: string,
    evaluatedAt: string
  ): EvaluationArtifact {
    const findings = [];
    const rubricValid = isSupportedRubric(rubric, descriptor.assets.evaluatorRubricVersion);
    if (!rubricValid)
      findings.push(blockingFinding("rubric-invalid", "Evaluator rubric is unsupported."));
    const structuredContractValid =
      descriptor.objective.trim() !== "" &&
      descriptor.targetRelativePath.trim() !== "" &&
      descriptor.expectedTextHash.length === 64 &&
      descriptor.replacementTextHash.length === 64 &&
      descriptor.limits.maxDecisions === 1 &&
      descriptor.limits.maxToolDispatches === 1;
    const contractValid = isSupportedContract(contract, descriptor.taskId);
    if (!structuredContractValid || !contractValid) {
      findings.push(blockingFinding("contract-invalid", "Bounded run contract is incomplete."));
    }
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
    if (!blockingCriteriaPassed) {
      findings.push(
        blockingFinding("acceptance-criteria-failed", "Blocking criteria lack passing evidence.")
      );
    }
    if (!projection.verificationRecorded) {
      findings.push(blockingFinding("verification-missing", "Verification was not recorded."));
    }
    if (verification.summary.workspaceHash !== workspaceHash) {
      findings.push(
        blockingFinding("workspace-hash-mismatch", "Verification targets another workspace.")
      );
    }
    if (
      !checksConsistent ||
      verification.summary.passedChecks !== verification.summary.discoveredChecks
    ) {
      findings.push(blockingFinding("verification-failed", "Not all verification checks passed."));
    }
    if (expectedWorkContractHash !== actualWorkContractHash) {
      findings.push(blockingFinding("contract-hash-mismatch", "Work contract hash changed."));
    }
    if (expectedRubricHash !== actualRubricHash) {
      findings.push(blockingFinding("rubric-hash-mismatch", "Evaluator rubric hash changed."));
    }
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
      descriptor.schemaVersion === "1.0" &&
      SHA256.test(descriptor.policyHash) &&
      SHA256.test(descriptor.assets.promptHash) &&
      descriptor.assets.skillHashes.length > 0 &&
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
        projectionHash: projectionHash(projection),
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

export function isSupportedContract(contract: WorkContract, taskId: string): boolean {
  return (
    contract.schemaVersion === "1.0" &&
    contract.status === "active" &&
    contract.taskId === taskId &&
    contract.contractId.trim() !== "" &&
    contract.purpose.trim() !== "" &&
    contract.scope.length > 0 &&
    contract.notInScope.length > 0 &&
    contract.verificationMethods.length > 0 &&
    contract.runtimeEvidenceExpectations.length > 0 &&
    contract.risks.length > 0 &&
    contract.recoveryPath.trim() !== "" &&
    Date.parse(contract.updatedAt) >= Date.parse(contract.createdAt) &&
    contract.acceptanceCriteria.length > 0 &&
    contract.acceptanceCriteria.every(
      (criterion) =>
        criterion.blocking && criterion.statement.trim() !== "" && CRITERIA.has(criterion.id)
    ) &&
    new Set(contract.acceptanceCriteria.map((criterion) => criterion.id)).size ===
      contract.acceptanceCriteria.length &&
    setEquals(CRITERIA, new Set(contract.acceptanceCriteria.map((criterion) => criterion.id)))
  );
}

export function isSupportedRubric(rubric: EvaluatorRubric, expectedVersion: string): boolean {
  return (
    rubric.schemaVersion === "1.0" &&
    rubric.rubricVersion === expectedVersion &&
    rubric.dimensions.length > 0 &&
    new Set(rubric.dimensions).size === rubric.dimensions.length &&
    rubric.dimensions.every((dimension) => DIMENSIONS.has(dimension)) &&
    setEquals(DIMENSIONS, new Set(rubric.dimensions)) &&
    rubric.blockingSeverities.join("|") === "critical|high|medium" &&
    !rubric.generatorRationaleIsEvidence &&
    rubric.requiresReadOnlyEvaluator &&
    rubric.requiresExactFinalHashes
  );
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
  projection: RunProjection,
  descriptor: RunDescriptor
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
        return descriptor.limits.maxCostMinorUnits === 0;
      case "operability":
        return projection.status === "reviewing" && projection.lastSequence > 0;
      default:
        return false;
    }
  })();
  return pass ? 5 : 0;
}

function setEquals(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}
