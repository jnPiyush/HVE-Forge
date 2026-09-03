import type {
  ModelProvider,
  ProviderCapabilities,
  ProviderDecision,
  ProviderRequest,
  ProviderResolver
} from "../application/contracts.js";
import { HarnessError, HarnessExitCode } from "../application/contracts.js";
import type { AtomicModelProvider, ModelTurnRequest } from "../application/model-provider.js";
import type { CancellationSignal } from "../application/tool-dispatcher.js";
import { canonicalizeJson, sha256Hex } from "../core/canonical-json.js";
import { validateJsonSchema } from "./schema-validator.js";

const REQUIRED_UNSUPPORTED = new Set([
  "live_calls",
  "streaming",
  "parallel_tool_calls",
  "prompt_caching",
  "reasoning_handles",
  "session_resume",
  "session_fork",
  "batch"
]);

export class RecordedProvider implements ModelProvider, AtomicModelProvider {
  public constructor(
    public readonly id: string,
    public readonly capabilities: ProviderCapabilities,
    private readonly diagnosticCanary = "",
    private readonly scriptedTurns: readonly Record<string, unknown>[] = []
  ) {}

  public async decide(request: ProviderRequest): Promise<ProviderDecision> {
    return {
      decisionId: "decision-1",
      toolName: "workspace.replace_exact_text",
      arguments: {
        relativePath: request.targetRelativePath,
        expectedText: request.expectedText,
        replacementText: request.replacementText
      },
      idempotencyKey: "replace-1",
      sensitiveDiagnostics: `Recorded provider ${this.id} diagnostic: ${this.diagnosticCanary}`,
      inputTokens: 0,
      outputTokens: 0,
      costMinorUnits: 0
    };
  }

  /**
   * Completes one bounded turn. With no scripted turns (the default), returns the trivial
   * immediately-completed turn used by the legacy single-decision facade and its tests. When
   * constructed with scripted turns, each script entry is selected by `request.turnNumber - 1`
   * (clamped to the last entry), never by call order, so replaying or resuming the same turn
   * number is idempotent regardless of how many times the harness happens to invoke it.
   */
  public async completeTurn(
    request: ModelTurnRequest,
    _cancellation: CancellationSignal
  ): Promise<unknown> {
    if (this.scriptedTurns.length === 0) {
      return {
        schemaVersion: "2.0",
        turnId: `turn-${request.turnNumber}`,
        assistantText: "Recorded provider completed the bounded turn.",
        toolCalls: [],
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          reasoningTokens: 0,
          costMode: "host_managed",
          costMinorUnits: null
        },
        finishReason: "completed",
        providerId: this.id,
        modelId: this.capabilities.servedModel
      };
    }
    const index = Math.min(request.turnNumber - 1, this.scriptedTurns.length - 1);
    const scripted = this.scriptedTurns[index] as Record<string, unknown>;
    return {
      schemaVersion: "2.0",
      turnId: `turn-${request.turnNumber}`,
      ...scripted,
      providerId: this.id,
      modelId: this.capabilities.servedModel
    };
  }

  public static fromFixture(
    fixtureBytes: Uint8Array,
    schemaBytes: Uint8Array,
    canary = "",
    scriptedTurns: readonly Record<string, unknown>[] = []
  ): RecordedProvider {
    const canonical = canonicalizeJson(fixtureBytes);
    const fixture = JSON.parse(canonical) as unknown;
    const schema = JSON.parse(canonicalizeJson(schemaBytes)) as unknown;
    const validation = validateJsonSchema(fixture, schema);
    if (!validation.valid || !isObject(fixture)) {
      throw new Error(`Provider fixture is invalid: ${validation.errors.join("; ")}`);
    }
    const unsupported = stringArray(fixture["unsupportedCapabilities"], "unsupportedCapabilities");
    if (
      fixture["streaming"] !== false ||
      fixture["strictStructuredOutput"] !== true ||
      fixture["parallelToolCalls"] !== false ||
      fixture["promptCaching"] !== false ||
      fixture["opaqueReasoningHandles"] !== false ||
      fixture["sessionResume"] !== false ||
      fixture["sessionFork"] !== false ||
      fixture["batch"] !== false ||
      !setEquals(REQUIRED_UNSUPPORTED, new Set(unsupported))
    ) {
      throw new Error("Provider fixture capability metadata is unsafe.");
    }
    const capabilities: ProviderCapabilities = {
      providerId: text(fixture["providerId"], "providerId"),
      adapterVersion: text(fixture["adapterVersion"], "adapterVersion"),
      requestedModel: text(fixture["requestedModel"], "requestedModel"),
      servedModel: text(fixture["servedModel"], "servedModel"),
      discoveredAt: text(fixture["discoveredAt"], "discoveredAt"),
      contextWindowTokens: integer(fixture["contextWindowTokens"], "contextWindowTokens"),
      maxOutputTokens: integer(fixture["maxOutputTokens"], "maxOutputTokens"),
      contentHash: sha256Hex(canonical),
      streaming: false,
      strictStructuredOutput: true,
      parallelToolCalls: false,
      promptCaching: false,
      opaqueReasoningHandles: false,
      sessionResume: false,
      sessionFork: false,
      batch: false,
      unsupportedCapabilities: unsupported
    };
    return new RecordedProvider(capabilities.providerId, capabilities, canary, scriptedTurns);
  }
}

export class ProviderRegistry implements ProviderResolver {
  private readonly providers: ReadonlyMap<string, ModelProvider>;

  public constructor(providers: readonly ModelProvider[]) {
    this.providers = new Map(providers.map((provider) => [provider.id, provider]));
    if (this.providers.size !== providers.length) throw new Error("Provider IDs must be unique.");
  }

  public getRequired(providerId: string): ModelProvider {
    const provider = this.providers.get(providerId);
    if (provider === undefined) {
      throw new HarnessError(
        HarnessExitCode.InvalidInvocation,
        `Provider adapter is not registered: ${providerId}.`
      );
    }
    return provider;
  }
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required.`);
  return value;
}

function integer(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${name} is invalid.`);
  return value as number;
}

function stringArray(value: unknown, name: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${name} is invalid.`);
  }
  return value as string[];
}

function setEquals(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
