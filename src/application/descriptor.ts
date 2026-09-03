import { resolve, sep } from "node:path";
import { canonicalizeValue, sha256Hex } from "../core/canonical-json.js";
import type { RunDescriptor } from "./contracts.js";

export function computeRunDescriptorHash(descriptor: RunDescriptor): string {
  return sha256Hex(
    canonicalizeValue({
      schemaVersion: descriptor.schemaVersion,
      runId: descriptor.runId,
      parentRunId: descriptor.parentRunId,
      taskId: descriptor.taskId,
      objective: descriptor.objective,
      runRoot: normalizePath(descriptor.runRoot),
      workspaceRoot: normalizePath(descriptor.workspaceRoot),
      stateRoot: normalizePath(descriptor.stateRoot),
      sourceFixturePath: normalizePath(descriptor.sourceFixturePath),
      sourceFixtureHash: descriptor.sourceFixtureHash,
      targetRelativePath: descriptor.targetRelativePath,
      expectedTextHash: descriptor.expectedTextHash,
      replacementTextHash: descriptor.replacementTextHash,
      providerId: descriptor.providerId,
      providerAdapterVersion: descriptor.providerAdapterVersion,
      providerRequestedModel: descriptor.providerRequestedModel,
      providerServedModel: descriptor.providerServedModel,
      providerDiscoveredAt: descriptor.providerDiscoveredAt,
      providerContextWindowTokens: descriptor.providerContextWindowTokens,
      providerMaxOutputTokens: descriptor.providerMaxOutputTokens,
      providerCapabilitiesHash: descriptor.providerCapabilitiesHash,
      workContractHash: descriptor.workContractHash,
      policyVersion: descriptor.policyVersion,
      policyHash: descriptor.policyHash,
      interruptionPoint: interruptionName(descriptor.interruptionPoint),
      limits: {
        maxDecisions: descriptor.limits.maxDecisions,
        maxToolDispatches: descriptor.limits.maxToolDispatches,
        maxElapsedMilliseconds: descriptor.limits.maxElapsedMilliseconds,
        maxInputTokens: descriptor.limits.maxInputTokens,
        maxOutputTokens: descriptor.limits.maxOutputTokens,
        maxCostMinorUnits: descriptor.limits.maxCostMinorUnits
      },
      assets: {
        promptVersion: descriptor.assets.promptVersion,
        promptHash: descriptor.assets.promptHash,
        skillHashes: descriptor.assets.skillHashes,
        evaluatorRubricVersion: descriptor.assets.evaluatorRubricVersion,
        evaluatorRubricHash: descriptor.assets.evaluatorRubricHash,
        mcpProtocolVersion: descriptor.assets.mcpProtocolVersion,
        telemetryVersion: descriptor.assets.telemetryVersion,
        toolSchemaVersion: descriptor.assets.toolSchemaVersion,
        sandboxProfile: descriptor.assets.sandboxProfile
      },
      createdAt: descriptor.createdAt
    })
  );
}

function normalizePath(path: string): string {
  const normalized = resolve(path);
  return normalized.endsWith(sep) ? normalized.slice(0, -1) : normalized;
}

function interruptionName(value: RunDescriptor["interruptionPoint"]): string {
  switch (value) {
    case "none":
      return "None";
    case "after-decision":
      return "AfterDecision";
    case "after-tool-commit":
      return "AfterToolCommit";
    case "after-verification":
      return "AfterVerification";
    case "after-evaluation":
      return "AfterEvaluation";
  }
}
