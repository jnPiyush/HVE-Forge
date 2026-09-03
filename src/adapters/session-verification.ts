import { readFile } from "node:fs/promises";
import type { Clock } from "../application/contracts.js";
import type {
  SessionVerificationArtifact,
  SessionVerificationRequest,
  SessionVerificationService
} from "../application/session-contracts.js";
import { canonicalizeValue, sha256Hex } from "../core/canonical-json.js";
import { resolveExistingRegularFile } from "./path-safety.js";
import { computeWorkingTreeHash } from "./working-tree-fingerprint.js";
import { computeTreeHash } from "./workspace.js";

/**
 * Schema-v2 analog of `FileVerificationService`. Reads the descriptor's declared expectation
 * directly rather than a single decision's arguments, because a bounded session may reach the
 * same target state through any number of turns and tool calls.
 */
export class FileSessionVerificationService implements SessionVerificationService {
  public constructor(private readonly clock: Clock = { now: () => new Date() }) {}

  public async verify(request: SessionVerificationRequest): Promise<SessionVerificationArtifact> {
    const { descriptor } = request;
    const target = await resolveExistingRegularFile(
      descriptor.workspaceRoot,
      descriptor.targetRelativePath
    );
    const content = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(target));
    const workspaceHash = await computeWorkingTreeHash(descriptor.workspaceRoot);
    const sourceHash = await computeTreeHash(descriptor.sourceFixturePath);
    const replacementPresent = countOccurrences(content, descriptor.replacementText) === 1;
    const expectedAbsent = !content.includes(descriptor.expectedText);
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
        passed: true,
        observation: "Workspace hash captured at verification time."
      },
      {
        criterionId: "source-fixture-unchanged",
        passed: sourceUnchanged,
        observation: "Source fixture manifest hash is unchanged."
      }
    ];
    const resultHash = sha256Hex(
      canonicalizeValue({
        workspaceHash,
        replacementPresent,
        expectedAbsent,
        sourceUnchanged,
        checks,
        instructionDigest: request.instruction.contentHash,
        turnNumber: request.turnNumber,
        attemptNumber: request.attemptNumber
      })
    );
    return {
      summary: {
        evidenceId: `verification-turn-${request.turnNumber}-attempt-${request.attemptNumber}`,
        workspaceHash,
        eventChainHead: request.eventChainHead,
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
      instructionDigest: request.instruction.contentHash,
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
