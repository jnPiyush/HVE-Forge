import { readFile } from "node:fs/promises";
import type {
  Clock,
  InstructionSelection,
  ProviderDecision,
  RunDescriptor,
  ToolResult,
  VerificationArtifact,
  VerificationService
} from "../application/contracts.js";
import { canonicalizeValue, sha256Hex } from "../core/canonical-json.js";
import type { RunProjection } from "../core/runs.js";
import { resolveExistingRegularFile } from "./path-safety.js";
import { computeArgumentsHash } from "./protected-intent.js";
import { computeTreeHash } from "./workspace.js";

export class FileVerificationService implements VerificationService {
  public constructor(private readonly clock: Clock) {}

  public async verify(
    descriptor: RunDescriptor,
    projection: RunProjection,
    instruction: InstructionSelection,
    decision: ProviderDecision,
    toolResult: ToolResult
  ): Promise<VerificationArtifact> {
    const target = await resolveExistingRegularFile(
      descriptor.workspaceRoot,
      descriptor.targetRelativePath
    );
    const content = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(target));
    const workspaceHash = await computeTreeHash(descriptor.workspaceRoot);
    const sourceHash = await computeTreeHash(descriptor.sourceFixturePath);
    const replacementPresent = countOccurrences(content, decision.arguments.replacementText) === 1;
    const expectedAbsent = !content.includes(decision.arguments.expectedText);
    const workspaceMatches = workspaceHash === toolResult.workspaceHash;
    const sourceUnchanged = sourceHash === descriptor.sourceFixtureHash;
    const checks = [
      {
        criterionId: "replacement-present-once",
        passed: replacementPresent,
        observation: "Replacement occurrence count equals one."
      },
      {
        criterionId: "expected-text-absent",
        passed: expectedAbsent,
        observation: "Expected text occurrence count equals zero."
      },
      {
        criterionId: "workspace-hash-bound",
        passed: workspaceMatches,
        observation: "Workspace hash matches the committed tool result."
      },
      {
        criterionId: "source-fixture-unchanged",
        passed: sourceUnchanged,
        observation: "Source fixture manifest hash is unchanged."
      }
    ];
    const argumentsHash = computeArgumentsHash(decision.arguments);
    const providerDecisionHash = sha256Hex(
      canonicalizeValue({
        decisionId: decision.decisionId,
        toolName: decision.toolName,
        argumentsHash,
        idempotencyKey: decision.idempotencyKey
      })
    );
    const resultHash = sha256Hex(
      canonicalizeValue({
        workspaceHash,
        replacementPresent,
        expectedAbsent,
        workspaceMatches,
        sourceUnchanged,
        checks,
        instructionDigest: instruction.contentHash,
        providerDecisionHash,
        argumentsHash
      })
    );
    return {
      summary: {
        evidenceId: "verification-final",
        workspaceHash,
        eventChainHead: projection.eventChainHead,
        discoveredChecks: checks.length,
        passedChecks: checks.filter((check) => check.passed).length,
        discoveredTests: null,
        passedTests: null,
        baselinePassingTests: null,
        cached: false,
        capturedAt: this.clock.now()
      },
      checks,
      policyVersion: descriptor.policyVersion,
      policyHash: descriptor.policyHash,
      instructionDigest: instruction.contentHash,
      providerDecisionHash,
      normalizedArgumentsHash: argumentsHash,
      idempotencyKey: decision.idempotencyKey,
      beforeFileHash: toolResult.beforeFileHash,
      afterFileHash: toolResult.afterFileHash,
      sourceFixtureHash: descriptor.sourceFixtureHash,
      resultHash
    };
  }
}

function countOccurrences(input: string, value: string): number {
  let count = 0;
  let offset = 0;
  while (true) {
    const match = input.indexOf(value, offset);
    if (match < 0) return count;
    count++;
    offset = match + value.length;
  }
}
