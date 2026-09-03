import { join, resolve } from "node:path";
import { SchemaContractValidator } from "../adapters/contract-validator.js";
import { ExactTextReplaceHandler } from "../adapters/exact-text-replace.js";
import { FileWorkspaceManager } from "../adapters/file-workspace-manager.js";
import { selectInstructions } from "../adapters/instructions.js";
import { assertNoLinksInAbsolutePath, readConfinedRegularFile } from "../adapters/path-safety.js";
import { JsonPolicySource } from "../adapters/policy-source.js";
import { RecordedProvider } from "../adapters/provider.js";
import { FileSessionEventSink } from "../adapters/session-store.js";
import { FileSessionVerificationService } from "../adapters/session-verification.js";
import { computeWorkingTreeHash } from "../adapters/working-tree-fingerprint.js";
import {
  DirectoryListHandler,
  FileReadHandler,
  TextSearchHandler
} from "../adapters/workspace-read-tools.js";
import {
  AgentLoop,
  type AgentLoopRequest,
  type AgentLoopResult
} from "../application/agent-loop.js";
import type { SessionDescriptor } from "../application/session-contracts.js";
import type { CancellationSignal } from "../application/tool-dispatcher.js";
import { ToolDispatcher } from "../application/tool-dispatcher.js";
import { sha256Hex } from "../core/canonical-json.js";
import { validateSessionLimits } from "../core/sessions.js";
import { createToolRegistry } from "../core/tool-registry.js";

export interface SessionCompositionOptions {
  readonly repositoryRoot: string;
  readonly sourceFixturePath: string;
  readonly runsRoot: string;
  readonly targetRelativePath?: string;
  readonly expectedText?: string;
  readonly replacementText?: string;
  readonly maxTurns?: number;
  readonly maxToolDispatches?: number;
}

export interface SessionComposition {
  run(cancellation: CancellationSignal): Promise<AgentLoopResult>;
  readonly descriptor: SessionDescriptor;
}

/**
 * The demo multi-turn script: read the target file, then apply the approved exact replacement,
 * then signal completion. This exercises the full bounded loop (context assembly, sequential
 * tool dispatch, verification, evaluation, completion) using the same fixture task the schema-v1
 * CLI demo uses, so the two demos are directly comparable.
 */
function demoScript(
  targetRelativePath: string,
  expectedText: string,
  replacementText: string
): readonly Record<string, unknown>[] {
  const usage = {
    inputTokens: 120,
    outputTokens: 24,
    cachedTokens: 0,
    reasoningTokens: 0,
    costMode: "host_managed",
    costMinorUnits: null
  };
  return [
    {
      assistantText: "I will read the target file before making a change.",
      toolCalls: [
        {
          callId: "call-1",
          toolId: "workspace.read_file",
          arguments: { relativePath: targetRelativePath }
        }
      ],
      usage,
      finishReason: "tool_calls"
    },
    {
      assistantText: "Applying the approved exact replacement.",
      toolCalls: [
        {
          callId: "call-2",
          toolId: "workspace.replace_exact_text",
          arguments: { relativePath: targetRelativePath, expectedText, replacementText }
        }
      ],
      usage,
      finishReason: "tool_calls"
    },
    {
      assistantText: "The replacement is verified in the earlier turn; the session is complete.",
      toolCalls: [],
      usage: { ...usage, outputTokens: 8 },
      finishReason: "completed"
    }
  ];
}

export async function createDefaultAgentSession(
  options: SessionCompositionOptions
): Promise<SessionComposition> {
  const repositoryRoot = resolve(options.repositoryRoot);
  const runsRoot = resolve(options.runsRoot);
  await Promise.all([
    assertNoLinksInAbsolutePath(repositoryRoot),
    assertNoLinksInAbsolutePath(runsRoot)
  ]);
  const targetRelativePath = options.targetRelativePath ?? "src/Greeting.txt";
  const expectedText = options.expectedText ?? "Hello from fixture";
  const replacementText = options.replacementText ?? "Hello from HVE-Forge";

  const [promptContent, skillContent, evaluatorRubricContent, workContractContent] =
    await Promise.all([
      readConfinedRegularFile(repositoryRoot, "prompts/coding-agent.v1.md").then((v) =>
        v.toString("utf8")
      ),
      readConfinedRegularFile(repositoryRoot, "hve/skills/exact-text-replacement/SKILL.md").then(
        (v) => v.toString("utf8")
      ),
      readConfinedRegularFile(repositoryRoot, "evaluation/rubrics/coding-task.v1.json").then((v) =>
        v.toString("utf8")
      ),
      readConfinedRegularFile(
        repositoryRoot,
        "config/contracts/exact-text-replacement.v1.json"
      ).then((v) => v.toString("utf8"))
    ]);

  const policyPath = join(repositoryRoot, "policies/organization-policy.v1.json");
  const policySource = new JsonPolicySource(policyPath);
  const policy = await policySource.load();
  const handlers = [
    new FileReadHandler(),
    new DirectoryListHandler(),
    new TextSearchHandler(),
    new ExactTextReplaceHandler()
  ];
  const registry = createToolRegistry(
    handlers.map((handler) => handler.descriptor),
    policy,
    { isolationBackendRegistered: false, egressReceiptsEnabled: false }
  );

  const providerSchema = await readConfinedRegularFile(
    repositoryRoot,
    "schemas/v1/provider-capabilities.schema.json"
  );
  const openAiFixture = await readConfinedRegularFile(
    repositoryRoot,
    "config/providers/fixture-openai.v1.json"
  );
  const provider = RecordedProvider.fromFixture(
    openAiFixture,
    providerSchema,
    "",
    demoScript(targetRelativePath, expectedText, replacementText)
  );

  const manager = new FileWorkspaceManager();
  const sessionId = `session-${sha256Hex(`${options.sourceFixturePath}:${Date.now()}`).slice(0, 32)}`;
  const runRoot = join(runsRoot, sessionId);
  const prepared = await manager.prepare(resolve(options.sourceFixturePath), runRoot);
  const workspaceRoot = prepared.workspaceRoot;
  const stateRoot = join(runRoot, "state");

  const clock = { now: () => new Date() };
  const contractValidator = new SchemaContractValidator(repositoryRoot);
  const workContractHash = sha256Hex(workContractContent);
  const evaluatorRubricHash = sha256Hex(evaluatorRubricContent);

  const descriptor: SessionDescriptor = {
    schemaVersion: "2.0",
    sessionId,
    parentSessionId: null,
    taskId: "fixture-task",
    objective:
      "Replace the fixture greeting with the approved text using a bounded multi-turn loop.",
    workspaceRoot,
    stateRoot,
    sourceFixturePath: prepared.sourceRoot,
    sourceFixtureHash: prepared.sourceFixtureHash,
    targetRelativePath,
    expectedText,
    replacementText,
    providerId: provider.id,
    workContractHash,
    policyVersion: policy.version,
    policyHash: policy.contentHash,
    limits: validateSessionLimits({
      maxTurns: options.maxTurns ?? 8,
      maxToolDispatches: options.maxToolDispatches ?? 16,
      maxElapsedMilliseconds: 300_000,
      maxOutputTokensPerTurn: 16_000,
      maxTotalOutputTokens: 64_000,
      maxTotalCostMinorUnits: 0,
      repeatedSignatureThreshold: 2,
      oscillationWindow: 6,
      maxConsecutiveFailedFixes: 3
    }),
    assets: {
      promptVersion: "coding-agent.v1",
      promptHash: sha256Hex(promptContent),
      skillHashes: [sha256Hex(skillContent)],
      evaluatorRubricVersion: "1.0.0",
      evaluatorRubricHash,
      toolSchemaVersion: "1.0.0",
      providerAdapterVersion: provider.capabilities.adapterVersion,
      sandboxProfile: "workspace-confinement-no-process-network"
    },
    createdAt: new Date().toISOString().replace("Z", "0000+00:00")
  };

  const loop = new AgentLoop({
    toolDispatcher: new ToolDispatcher(registry, policy, handlers),
    provider,
    verificationService: new FileSessionVerificationService(clock),
    contractValidator,
    instructionSelector: { select: selectInstructions },
    workspaceOps: { computeHash: computeWorkingTreeHash },
    clock,
    eventSink: new FileSessionEventSink(join(stateRoot, "events.jsonl"))
  });

  const request: AgentLoopRequest = {
    descriptor,
    workContractContent,
    evaluatorRubricContent,
    distributionInstructionContent: promptContent
  };

  return {
    descriptor,
    run: (cancellation: CancellationSignal) => loop.run(request, cancellation)
  };
}
