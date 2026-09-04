import type {
  EvaluationFinding,
  EvaluationSummary,
  VerificationSummary
} from "../core/completion.js";
import type { EventPayload, RunEvent } from "../core/events.js";
import type { ActionClass, PolicyDefinition, RunLimits } from "../core/policy.js";
import type { RunProjection } from "../core/runs.js";

export type InterruptionPoint =
  | "none"
  | "after-decision"
  | "after-tool-commit"
  | "after-verification"
  | "after-evaluation";

export enum HarnessExitCode {
  Completed = 0,
  InvalidInvocation = 2,
  PolicyDenied = 3,
  LimitExceeded = 4,
  RepeatedSignature = 5,
  ReplayIntegrityFailure = 6,
  EvaluationRejected = 7,
  InterruptedFixture = 8,
  Cancelled = 9,
  InternalFailure = 10,
  Blocked = 11
}

export interface RunAssetVersions {
  readonly promptVersion: string;
  readonly promptHash: string;
  readonly skillHashes: readonly string[];
  readonly evaluatorRubricVersion: string;
  readonly evaluatorRubricHash: string;
  readonly mcpProtocolVersion: string;
  readonly telemetryVersion: string;
  readonly toolSchemaVersion: string;
  readonly sandboxProfile: string;
}

export interface RuntimeAssetBundle {
  readonly versions: RunAssetVersions;
  readonly promptContent: string;
  readonly skillContents: readonly string[];
  readonly evaluatorRubricContent: string;
}

export interface SubmitRunRequest {
  readonly taskId: string;
  readonly objective: string;
  readonly sourceFixturePath: string;
  readonly runsRoot: string;
  readonly targetRelativePath: string;
  readonly expectedText: string;
  readonly replacementText: string;
  readonly providerId: string;
  readonly workContractHash: string;
  readonly workContractContent: string;
  readonly evaluatorRubricContent: string;
  readonly interruptionPoint: InterruptionPoint;
  readonly limits: RunLimits;
  readonly assets: RunAssetVersions;
}

export interface RunDescriptor {
  readonly schemaVersion: "1.0";
  readonly runId: string;
  readonly parentRunId: string | null;
  readonly taskId: string;
  readonly objective: string;
  readonly runRoot: string;
  readonly workspaceRoot: string;
  readonly stateRoot: string;
  readonly sourceFixturePath: string;
  readonly sourceFixtureHash: string;
  readonly targetRelativePath: string;
  readonly expectedTextHash: string;
  readonly replacementTextHash: string;
  readonly providerId: string;
  readonly providerAdapterVersion: string;
  readonly providerRequestedModel: string;
  readonly providerServedModel: string;
  readonly providerDiscoveredAt: string;
  readonly providerContextWindowTokens: number;
  readonly providerMaxOutputTokens: number;
  readonly providerCapabilitiesHash: string;
  readonly workContractHash: string;
  readonly policyVersion: string;
  readonly policyHash: string;
  readonly interruptionPoint: InterruptionPoint;
  readonly limits: RunLimits;
  readonly assets: RunAssetVersions;
  readonly createdAt: string;
}

export interface RunResult {
  readonly exitCode: HarnessExitCode;
  readonly descriptor: RunDescriptor;
  readonly projection: RunProjection;
  readonly semanticTraceHash: string;
  readonly messages: readonly string[];
}

export interface ReplayResult {
  readonly projection: RunProjection;
  readonly projectionHash: string;
  readonly semanticTraceHash: string;
  readonly eventCount: number;
}

export interface InstructionSource {
  readonly relativePath: string;
  readonly scope: string;
  readonly precedence: number;
  readonly contentHash: string;
  readonly byteLength: number;
  readonly trust: "repository";
}

export interface InstructionSelection {
  readonly relativePath: string | null;
  readonly contentHash: string;
  readonly byteLength: number;
  readonly content: string;
  readonly sources: readonly InstructionSource[];
  readonly conflicts: readonly string[];
}

export interface SkillDescriptor {
  readonly name: string;
  readonly description: string;
  readonly relativePath: string;
  readonly contentHash: string;
  readonly byteLength: number;
  readonly provenance: "repository";
  readonly license: string | null;
  readonly compatibility: string | null;
  readonly allowedTools: string | null;
  readonly allowedToolsExperimental: boolean;
}

export interface ActivatedSkill {
  readonly descriptor: SkillDescriptor;
  readonly instructions: string;
}

export interface ProviderCapabilities {
  readonly providerId: string;
  readonly adapterVersion: string;
  readonly requestedModel: string;
  readonly servedModel: string;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  readonly discoveredAt: string;
  readonly contentHash: string;
  readonly streaming: boolean;
  readonly strictStructuredOutput: boolean;
  readonly parallelToolCalls: boolean;
  readonly promptCaching: boolean;
  readonly opaqueReasoningHandles: boolean;
  readonly sessionResume: boolean;
  readonly sessionFork: boolean;
  readonly batch: boolean;
  readonly unsupportedCapabilities: readonly string[];
}

export interface ProviderRequest {
  readonly taskId: string;
  readonly objective: string;
  readonly targetRelativePath: string;
  readonly expectedText: string;
  readonly replacementText: string;
  readonly projection: RunProjection;
}

export interface ProviderDecision {
  readonly decisionId: string;
  readonly toolName: string;
  readonly arguments: ReplaceTextArguments;
  readonly idempotencyKey: string;
  readonly sensitiveDiagnostics: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMinorUnits: number;
}

export interface ReplaceTextArguments {
  readonly relativePath: string;
  readonly expectedText: string;
  readonly replacementText: string;
}

export interface ToolExecutionContext {
  readonly workspaceRoot: string;
  readonly stateRoot: string;
  readonly idempotencyKey: string;
  readonly argumentsHash: string;
}

export interface ToolResult {
  readonly isSuccess: boolean;
  readonly errorCode: string | null;
  readonly message: string;
  readonly beforeFileHash: string | null;
  readonly afterFileHash: string | null;
  readonly workspaceHash: string;
  readonly replayedReceipt: boolean;
}

export interface ReplacementIntent extends ReplaceTextArguments {
  readonly argumentsHash: string;
}

export interface VerificationCheck {
  readonly criterionId: string;
  readonly passed: boolean;
  readonly observation: string;
}

export interface VerificationArtifact {
  readonly summary: VerificationSummary;
  readonly checks: readonly VerificationCheck[];
  readonly policyVersion: string;
  readonly policyHash: string;
  readonly instructionDigest: string;
  readonly providerDecisionHash: string;
  readonly normalizedArgumentsHash: string;
  readonly idempotencyKey: string;
  readonly beforeFileHash: string | null;
  readonly afterFileHash: string | null;
  readonly sourceFixtureHash: string;
  readonly resultHash: string;
}

export interface WorkContractCriterion {
  readonly id: string;
  readonly statement: string;
  readonly blocking: boolean;
}

export interface WorkContract {
  readonly schemaVersion: "1.0";
  readonly contractId: string;
  readonly taskId: string;
  readonly status: string;
  readonly purpose: string;
  readonly scope: readonly string[];
  readonly notInScope: readonly string[];
  readonly acceptanceCriteria: readonly WorkContractCriterion[];
  readonly verificationMethods: readonly string[];
  readonly runtimeEvidenceExpectations: readonly string[];
  readonly risks: readonly string[];
  readonly recoveryPath: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EvaluatorRubric {
  readonly schemaVersion: "1.0";
  readonly rubricVersion: string;
  readonly dimensions: readonly string[];
  readonly blockingSeverities: readonly string[];
  readonly generatorRationaleIsEvidence: boolean;
  readonly requiresReadOnlyEvaluator: boolean;
  readonly requiresExactFinalHashes: boolean;
}

export interface EvaluationArtifact {
  readonly summary: EvaluationSummary;
  readonly scores: Readonly<Record<string, number>>;
  readonly evidenceHashes: readonly string[];
  readonly startedAt: string;
  readonly endedAt: string;
}

export interface HandoffPacket {
  readonly schemaVersion: "1.0";
  readonly handoffId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly objective: string;
  readonly contractReference: string;
  readonly completedWork: readonly string[];
  readonly workspace: {
    readonly repository: string | null;
    readonly branch: string | null;
    readonly commit: string | null;
    readonly sourceFixtureHash: string;
    readonly workspaceHash: string;
    readonly runRoot: string;
  };
  readonly changedFiles: readonly string[];
  readonly commands: readonly {
    readonly action: string;
    readonly result: "passed" | "failed" | "blocked" | "cancelled";
    readonly evidenceReference: string;
  }[];
  readonly activeFindings: readonly string[];
  readonly assumptions: readonly string[];
  readonly budget: {
    readonly remainingDecisions: number;
    readonly remainingToolDispatches: number;
    readonly remainingInputTokens: number;
    readonly remainingOutputTokens: number;
    readonly remainingCostMinorUnits: number;
    readonly remainingSeconds: number;
  };
  readonly nextAction: string;
  readonly artifactReferences: readonly string[];
  readonly sourceEventHead: string;
  readonly createdAt: string;
}

export interface RunStore {
  create(descriptor: RunDescriptor): Promise<void>;
  load(runRoot: string): Promise<RunDescriptor>;
  readEvents(descriptor: RunDescriptor): Promise<readonly RunEvent[]>;
  append(
    descriptor: RunDescriptor,
    eventType: string,
    payload: EventPayload,
    occurredAt: string,
    expectedSequence: number,
    expectedPreviousHash: string
  ): Promise<RunEvent>;
  saveVerification(descriptor: RunDescriptor, artifact: VerificationArtifact): Promise<void>;
  loadVerification(descriptor: RunDescriptor): Promise<VerificationArtifact>;
  saveEvaluation(descriptor: RunDescriptor, artifact: EvaluationArtifact): Promise<void>;
  loadEvaluation(descriptor: RunDescriptor): Promise<EvaluationArtifact>;
  saveCheckpoint(
    descriptor: RunDescriptor,
    projection: RunProjection,
    workspaceHash: string,
    events: readonly RunEvent[]
  ): Promise<string>;
  saveAsset(descriptor: RunDescriptor, name: string, content: string): Promise<void>;
  loadAsset(descriptor: RunDescriptor, name: string): Promise<string>;
  archive(descriptor: RunDescriptor, destinationPath: string): Promise<void>;
}

export interface ModelProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  decide(request: ProviderRequest): Promise<ProviderDecision>;
}

export interface ProviderResolver {
  getRequired(providerId: string): ModelProvider;
}

export interface WorkspaceManager {
  prepare(
    sourceFixturePath: string,
    runRoot: string
  ): Promise<{
    readonly workspaceRoot: string;
    readonly sourceRoot: string;
    readonly sourceFixtureHash: string;
  }>;
  computeHash(rootPath: string): Promise<string>;
  assertUnchanged(rootPath: string, expectedHash: string): Promise<void>;
  saveReplacementIntent(
    runRoot: string,
    workspaceRoot: string,
    runId: string,
    intent: ReplacementIntent
  ): Promise<void>;
  loadReplacementIntent(descriptor: RunDescriptor): Promise<ReplacementIntent>;
}

export interface InstructionSelector {
  select(workspaceRoot: string, targetRelativePath: string): Promise<InstructionSelection>;
}

export interface SkillCatalog {
  inspect(skillsRoot: string): Promise<readonly SkillDescriptor[]>;
  activate(skillsRoot: string, name: string): Promise<ActivatedSkill>;
}

export interface PolicySource {
  load(): Promise<PolicyDefinition>;
}

export interface WorkspaceTool {
  readonly name: string;
  readonly version: string;
  readonly actionClass: ActionClass;
  execute(context: ToolExecutionContext, argumentsValue: ReplaceTextArguments): Promise<ToolResult>;
}

export interface RuntimeContractValidator {
  parseWorkContract(content: string): Promise<WorkContract>;
  parseEvaluatorRubric(content: string): Promise<EvaluatorRubric>;
  parseHandoff(content: string): Promise<HandoffPacket>;
}

export interface VerificationService {
  verify(
    descriptor: RunDescriptor,
    projection: RunProjection,
    instruction: InstructionSelection,
    decision: ProviderDecision,
    toolResult: ToolResult
  ): Promise<VerificationArtifact>;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  newRunId(): string;
}

export interface RunObserver {
  eventAppended(event: RunEvent): Promise<void>;
}

export class HarnessError extends Error {
  public constructor(
    public readonly exitCode: HarnessExitCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "HarnessError";
  }
}

export function blockingFinding(
  id: string,
  summary: string
): EvaluationFinding & {
  readonly summary: string;
  readonly waiverReference: null;
} {
  return {
    findingId: id,
    severity: "high",
    summary,
    waived: false,
    waiverReference: null
  };
}
