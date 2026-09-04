import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { SchemaContractValidator } from "../adapters/contract-validator.js";
import { ExactTextReplaceHandler } from "../adapters/exact-text-replace.js";
import { FileWorkspaceManager } from "../adapters/file-workspace-manager.js";
import { ScopedInstructionSelector } from "../adapters/instructions.js";
import { assertNoLinksInAbsolutePath, readConfinedRegularFile } from "../adapters/path-safety.js";
import { JsonPolicySource } from "../adapters/policy-source.js";
import { ProviderRegistry, RecordedProvider } from "../adapters/provider.js";
import { FileRunStore } from "../adapters/run-store.js";
import { AgentSkillCatalog } from "../adapters/skills.js";
import { FileTelemetryObserver } from "../adapters/telemetry.js";
import { FileVerificationService } from "../adapters/verification.js";
import {
  DirectoryListHandler,
  FileReadHandler,
  TextSearchHandler
} from "../adapters/workspace-read-tools.js";
import type {
  Clock,
  IdGenerator,
  InterruptionPoint,
  RuntimeAssetBundle,
  SubmitRunRequest
} from "../application/contracts.js";
import { ReadOnlyEvaluator } from "../application/evaluator.js";
import { HarnessService } from "../application/harness-service.js";
import { SecretRedactor } from "../application/redactor.js";
import { ToolDispatcher } from "../application/tool-dispatcher.js";
import { sha256Hex } from "../core/canonical-json.js";
import { createToolRegistry } from "../core/tool-registry.js";

export interface CompositionOptions {
  readonly repositoryRoot: string;
  readonly runsRoot: string;
  readonly policyPath?: string;
  readonly canary?: string;
  readonly clock?: Clock;
  readonly idGenerator?: IdGenerator;
}

export interface SubmitRequestOptions {
  readonly repositoryRoot: string;
  readonly sourceFixturePath: string;
  readonly runsRoot: string;
  readonly taskId?: string;
  readonly objective?: string;
  readonly targetRelativePath?: string;
  readonly expectedText?: string;
  readonly replacementText?: string;
  readonly providerId?: string;
  readonly interruptionPoint?: InterruptionPoint;
}

export async function createDefaultHarness(options: CompositionOptions): Promise<{
  readonly service: HarnessService;
}> {
  const repositoryRoot = resolve(options.repositoryRoot);
  const runsRoot = resolve(options.runsRoot);
  const policyPath = resolve(
    options.policyPath ?? join(repositoryRoot, "policies/organization-policy.v1.json")
  );
  await Promise.all([
    assertNoLinksInAbsolutePath(repositoryRoot),
    assertNoLinksInAbsolutePath(runsRoot),
    assertNoLinksInAbsolutePath(policyPath)
  ]);
  const runtimeAssets = await loadRuntimeAssets(repositoryRoot);
  const clock = options.clock ?? { now: () => new Date() };
  const idGenerator = options.idGenerator ?? { newRunId: () => `run-${randomUUID()}` };
  const providerSchema = await readConfinedRegularFile(
    repositoryRoot,
    "schemas/v1/provider-capabilities.schema.json"
  );
  const [openAiFixture, anthropicFixture] = await Promise.all([
    readConfinedRegularFile(repositoryRoot, "config/providers/fixture-openai.v1.json"),
    readConfinedRegularFile(repositoryRoot, "config/providers/fixture-anthropic.v1.json")
  ]);
  const providers = [
    RecordedProvider.fromFixture(openAiFixture, providerSchema, options.canary),
    RecordedProvider.fromFixture(anthropicFixture, providerSchema, options.canary)
  ];
  const policySource = new JsonPolicySource(policyPath);
  const policy = await policySource.load();
  const registrationPolicyPath = join(repositoryRoot, "policies/organization-policy.v1.json");
  const registrationPolicy =
    policyPath === registrationPolicyPath
      ? policy
      : await new JsonPolicySource(registrationPolicyPath).load();
  const toolHandlers = [
    new FileReadHandler(),
    new DirectoryListHandler(),
    new TextSearchHandler(),
    new ExactTextReplaceHandler()
  ];
  const toolRegistry = createToolRegistry(
    toolHandlers.map((handler) => handler.descriptor),
    registrationPolicy,
    { isolationBackendRegistered: false, egressReceiptsEnabled: false }
  );
  const service = new HarnessService({
    runStore: new FileRunStore(),
    workspaceManager: new FileWorkspaceManager(),
    instructionSelector: new ScopedInstructionSelector(),
    skillCatalog: new AgentSkillCatalog(),
    providers: new ProviderRegistry(providers),
    toolDispatcher: new ToolDispatcher(toolRegistry, policy, toolHandlers),
    policySource,
    contractValidator: new SchemaContractValidator(repositoryRoot),
    verificationService: new FileVerificationService(clock),
    evaluator: new ReadOnlyEvaluator(),
    runtimeAssets,
    clock,
    idGenerator,
    observer: new FileTelemetryObserver(join(dirname(runsRoot), "telemetry", "events.jsonl")),
    redactor: new SecretRedactor([options.canary ?? ""])
  });
  return { service };
}

export async function createDefaultSubmitRequest(
  options: SubmitRequestOptions
): Promise<SubmitRunRequest> {
  const repositoryRoot = resolve(options.repositoryRoot);
  await Promise.all([
    assertNoLinksInAbsolutePath(repositoryRoot),
    assertNoLinksInAbsolutePath(resolve(options.sourceFixturePath)),
    assertNoLinksInAbsolutePath(resolve(options.runsRoot))
  ]);
  const contractBytes = await readConfinedRegularFile(
    repositoryRoot,
    "config/contracts/exact-text-replacement.v1.json"
  );
  const runtimeAssets = await loadRuntimeAssets(repositoryRoot);
  return {
    taskId: options.taskId ?? "fixture-task",
    objective: options.objective ?? "Replace the fixture greeting with the approved text.",
    sourceFixturePath: resolve(options.sourceFixturePath),
    runsRoot: resolve(options.runsRoot),
    targetRelativePath: options.targetRelativePath ?? "src/Greeting.txt",
    expectedText: options.expectedText ?? "Hello from fixture",
    replacementText: options.replacementText ?? "Hello from HVE-Forge",
    providerId: options.providerId ?? "fixture-openai",
    workContractHash: sha256Hex(contractBytes),
    workContractContent: contractBytes.toString("utf8"),
    evaluatorRubricContent: runtimeAssets.evaluatorRubricContent,
    interruptionPoint: options.interruptionPoint ?? "none",
    limits: {
      maxDecisions: 1,
      maxToolDispatches: 1,
      maxElapsedMilliseconds: 300_000,
      maxInputTokens: 0,
      maxOutputTokens: 0,
      maxCostMinorUnits: 0
    },
    assets: runtimeAssets.versions
  };
}

async function loadRuntimeAssets(repositoryRoot: string): Promise<RuntimeAssetBundle> {
  const [promptContent, skillContent, evaluatorRubricContent] = await Promise.all([
    readConfinedRegularFile(repositoryRoot, "prompts/coding-agent.v1.md").then((value) =>
      value.toString("utf8")
    ),
    readConfinedRegularFile(repositoryRoot, "hve/skills/exact-text-replacement/SKILL.md").then(
      (value) => value.toString("utf8")
    ),
    readConfinedRegularFile(repositoryRoot, "evaluation/rubrics/coding-task.v1.json").then(
      (value) => value.toString("utf8")
    )
  ]);
  return {
    promptContent,
    skillContents: [skillContent],
    evaluatorRubricContent,
    versions: {
      promptVersion: "coding-agent.v1",
      promptHash: sha256Hex(promptContent),
      skillHashes: [sha256Hex(skillContent)],
      evaluatorRubricVersion: "1.0.0",
      evaluatorRubricHash: sha256Hex(evaluatorRubricContent),
      mcpProtocolVersion: "2026-07-28",
      telemetryVersion: "1.0.0",
      toolSchemaVersion: "1.0.0",
      sandboxProfile: "workspace-confinement-no-process-network"
    }
  };
}
