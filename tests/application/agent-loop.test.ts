import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExactTextReplaceHandler } from "../../src/adapters/exact-text-replace.js";
import { FileWorkspaceManager } from "../../src/adapters/file-workspace-manager.js";
import { selectInstructions } from "../../src/adapters/instructions.js";
import { JsonPolicySource } from "../../src/adapters/policy-source.js";
import { FileSessionVerificationService } from "../../src/adapters/session-verification.js";
import { computeWorkingTreeHash } from "../../src/adapters/working-tree-fingerprint.js";
import {
  DirectoryListHandler,
  FileReadHandler,
  TextSearchHandler
} from "../../src/adapters/workspace-read-tools.js";
import {
  AgentLoop,
  type AgentLoopDependencies,
  type AgentLoopRequest
} from "../../src/application/agent-loop.js";
import type {
  AtomicModelProvider,
  ModelTurnRequest
} from "../../src/application/model-provider.js";
import type { SessionDescriptor } from "../../src/application/session-contracts.js";
import type { CancellationSignal } from "../../src/application/tool-dispatcher.js";
import { ToolDispatcher } from "../../src/application/tool-dispatcher.js";
import { sha256Hex } from "../../src/core/canonical-json.js";
import { replaySession } from "../../src/core/sessions.js";
import { createToolRegistry } from "../../src/core/tool-registry.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function fixture(
  content: string
): Promise<{ workspaceRoot: string; sourceRoot: string; sourceFixtureHash: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "hve-session-")));
  roots.push(root);
  const sourceRoot = join(root, "source");
  await mkdir(join(sourceRoot, "src"), { recursive: true });
  await writeFile(join(sourceRoot, "src/Greeting.txt"), content, "utf8");
  const manager = new FileWorkspaceManager();
  const prepared = await manager.prepare(sourceRoot, join(root, "runs/run-1"));
  return {
    workspaceRoot: prepared.workspaceRoot,
    sourceRoot: prepared.sourceRoot,
    sourceFixtureHash: prepared.sourceFixtureHash
  };
}

function scriptedProvider(turns: readonly Record<string, unknown>[]): AtomicModelProvider {
  return {
    id: "test-provider",
    completeTurn: async (request: ModelTurnRequest) => {
      const index = Math.min(request.turnNumber - 1, turns.length - 1);
      return {
        schemaVersion: "2.0",
        turnId: `turn-${request.turnNumber}`,
        providerId: "test-provider",
        modelId: "test-model",
        ...turns[index]
      };
    }
  };
}

function usage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    inputTokens: 10,
    outputTokens: 5,
    cachedTokens: 0,
    reasoningTokens: 0,
    costMode: "host_managed",
    costMinorUnits: null,
    ...overrides
  };
}

async function buildDependencies(
  overrides: Partial<AgentLoopDependencies> = {}
): Promise<AgentLoopDependencies> {
  const policy = await new JsonPolicySource(resolve("policies/organization-policy.v1.json")).load();
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
  const clock = { now: () => new Date("2026-09-03T00:00:00.000Z") };
  return {
    toolDispatcher: new ToolDispatcher(registry, policy, handlers),
    provider: scriptedProvider([]),
    verificationService: new FileSessionVerificationService(clock),
    contractValidator: {
      parseWorkContract: async (content: string) => JSON.parse(content),
      parseEvaluatorRubric: async (content: string) => JSON.parse(content),
      parseHandoff: async (content: string) => JSON.parse(content)
    },
    instructionSelector: { select: selectInstructions },
    workspaceOps: { computeHash: computeWorkingTreeHash },
    clock,
    eventSink: { append: async () => {} },
    ...overrides
  };
}

function descriptor(
  workspaceRoot: string,
  sourceRoot: string,
  sourceFixtureHash: string,
  overrides: Partial<SessionDescriptor> = {}
): SessionDescriptor {
  return {
    schemaVersion: "2.0",
    sessionId: "session-1",
    parentSessionId: null,
    taskId: "fixture-task",
    objective: "Replace the fixture greeting with the approved text.",
    workspaceRoot,
    stateRoot: join(workspaceRoot, "../state"),
    sourceFixturePath: sourceRoot,
    sourceFixtureHash,
    targetRelativePath: "src/Greeting.txt",
    expectedText: "Hello from fixture",
    replacementText: "Hello from HVE-Forge",
    providerId: "test-provider",
    workContractHash: sha256Hex(JSON.stringify(workContract())),
    policyVersion: "1.0.0",
    policyHash: "b".repeat(64),
    limits: {
      maxTurns: 8,
      maxToolDispatches: 16,
      maxElapsedMilliseconds: 300_000,
      maxOutputTokensPerTurn: 16_000,
      maxTotalOutputTokens: 64_000,
      maxTotalCostMinorUnits: 0,
      repeatedSignatureThreshold: 2,
      oscillationWindow: 6,
      maxConsecutiveFailedFixes: 3
    },
    assets: {
      promptVersion: "prompt-v1",
      promptHash: "c".repeat(64),
      skillHashes: ["d".repeat(64)],
      evaluatorRubricVersion: "1.0.0",
      evaluatorRubricHash: sha256Hex(JSON.stringify(rubric())),
      toolSchemaVersion: "1.0.0",
      providerAdapterVersion: "1.0.0",
      sandboxProfile: "test-confinement"
    },
    createdAt: "2026-09-03T00:00:00.0000000+00:00",
    ...overrides
  };
}

function workContract(): unknown {
  return {
    schemaVersion: "1.0",
    contractId: "exact-text-replacement.v1",
    taskId: "fixture-task",
    status: "active",
    purpose: "Verify one policy-approved exact text replacement in an isolated copied workspace.",
    scope: ["Replace one exact occurrence in one existing regular UTF-8 file."],
    notInScope: ["Live provider calls."],
    acceptanceCriteria: [
      { id: "replacement-present-once", statement: "s", blocking: true },
      { id: "expected-text-absent", statement: "s", blocking: true },
      { id: "workspace-hash-bound", statement: "s", blocking: true },
      { id: "source-fixture-unchanged", statement: "s", blocking: true }
    ],
    verificationMethods: ["m"],
    runtimeEvidenceExpectations: ["e"],
    risks: ["r"],
    recoveryPath: "Retry in a fresh run root.",
    createdAt: "2026-08-31T00:00:00Z",
    updatedAt: "2026-08-31T00:00:00Z"
  };
}

function rubric(): unknown {
  return {
    schemaVersion: "1.0",
    rubricVersion: "1.0.0",
    dimensions: [
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
    ],
    blockingSeverities: ["critical", "high", "medium"],
    generatorRationaleIsEvidence: false,
    requiresReadOnlyEvaluator: true,
    requiresExactFinalHashes: true
  };
}

function request(descriptorValue: SessionDescriptor): AgentLoopRequest {
  return {
    descriptor: descriptorValue,
    workContractContent: JSON.stringify(workContract()),
    evaluatorRubricContent: JSON.stringify(rubric()),
    distributionInstructionContent: "Obey policy. Use only the offered tools."
  };
}

const NOT_CANCELLED: CancellationSignal = { isCancellationRequested: false };

describe("AgentLoop", () => {
  it("completes a bounded read-then-fix-then-done session and replays deterministically", async () => {
    const { workspaceRoot, sourceRoot, sourceFixtureHash } = await fixture("Hello from fixture\n");
    const provider = scriptedProvider([
      {
        assistantText: "Let me look at the file first.",
        toolCalls: [
          {
            callId: "call-1",
            toolId: "workspace.read_file",
            arguments: { relativePath: "src/Greeting.txt" }
          }
        ],
        usage: usage(),
        finishReason: "tool_calls"
      },
      {
        assistantText: "Now I will apply the fix.",
        toolCalls: [
          {
            callId: "call-2",
            toolId: "workspace.replace_exact_text",
            arguments: {
              relativePath: "src/Greeting.txt",
              expectedText: "Hello from fixture",
              replacementText: "Hello from HVE-Forge"
            }
          }
        ],
        usage: usage(),
        finishReason: "tool_calls"
      },
      {
        assistantText: "Done.",
        toolCalls: [],
        usage: usage({ outputTokens: 2 }),
        finishReason: "completed"
      }
    ]);
    const dependencies = await buildDependencies({ provider });
    const loop = new AgentLoop(dependencies);
    const sessionDescriptor = descriptor(workspaceRoot, sourceRoot, sourceFixtureHash);

    const result = await loop.run(request(sessionDescriptor), NOT_CANCELLED);

    expect(result.projection.status).toBe("completed");
    expect(result.projection.turnsUsed).toBe(3);
    expect(result.projection.toolDispatchesUsed).toBe(2);
    expect(await readFile(join(workspaceRoot, "src/Greeting.txt"), "utf8")).toBe(
      "Hello from HVE-Forge\n"
    );
    expect(await readFile(join(sourceRoot, "src/Greeting.txt"), "utf8")).toBe(
      "Hello from fixture\n"
    );

    const replayed = replaySession(sessionDescriptor.sessionId, result.events);
    expect(replayed).toEqual(result.projection);
  });

  it("stops when the decision (turn) budget is exhausted", async () => {
    const { workspaceRoot, sourceRoot, sourceFixtureHash } = await fixture("Hello from fixture\n");
    const provider = scriptedProvider([
      {
        assistantText: "Reading again.",
        toolCalls: [
          {
            callId: "call-1",
            toolId: "workspace.read_file",
            arguments: { relativePath: "src/Greeting.txt" }
          }
        ],
        usage: usage(),
        finishReason: "tool_calls"
      }
    ]);
    const dependencies = await buildDependencies({ provider });
    const loop = new AgentLoop(dependencies);
    const sessionDescriptor = descriptor(workspaceRoot, sourceRoot, sourceFixtureHash, {
      limits: { ...descriptor(workspaceRoot, sourceRoot, sourceFixtureHash).limits, maxTurns: 1 }
    });

    const result = await loop.run(request(sessionDescriptor), NOT_CANCELLED);

    expect(result.projection.status).toBe("blocked");
    expect(result.projection.stopReason).toBe("decision_budget_exhausted");
    const stopEvent = result.events.find((event) => event.eventType === "loop.stopped");
    expect(stopEvent?.payload["reason"]).toBe("decision_budget_exhausted");
    replaySession(sessionDescriptor.sessionId, result.events);
  });

  it("detects oscillation from a repeated action signature", async () => {
    const { workspaceRoot, sourceRoot, sourceFixtureHash } = await fixture("Hello from fixture\n");
    const readCall = {
      assistantText: "Reading the file.",
      toolCalls: [
        {
          callId: "call-1",
          toolId: "workspace.read_file",
          arguments: { relativePath: "src/Greeting.txt" }
        }
      ],
      usage: usage(),
      finishReason: "tool_calls"
    };
    const provider = scriptedProvider([readCall, readCall]);
    const dependencies = await buildDependencies({ provider });
    const loop = new AgentLoop(dependencies);
    const sessionDescriptor = descriptor(workspaceRoot, sourceRoot, sourceFixtureHash);

    const result = await loop.run(request(sessionDescriptor), NOT_CANCELLED);

    expect(result.projection.status).toBe("blocked");
    expect(result.projection.stopReason).toBe("oscillation_detected");
    expect(result.projection.turnsUsed).toBe(2);
    expect(result.projection.toolDispatchesUsed).toBe(1);
    replaySession(sessionDescriptor.sessionId, result.events);
  });

  it("stops after consecutive failed verification attempts", async () => {
    const { workspaceRoot, sourceRoot, sourceFixtureHash } = await fixture(
      "Hello from fixture\nLine two\nLine three\n"
    );
    const provider = scriptedProvider([
      {
        assistantText: "Editing an unrelated line.",
        toolCalls: [
          {
            callId: "call-1",
            toolId: "workspace.replace_exact_text",
            arguments: {
              relativePath: "src/Greeting.txt",
              expectedText: "Line two",
              replacementText: "Line TWO edited"
            }
          }
        ],
        usage: usage(),
        finishReason: "tool_calls"
      },
      {
        assistantText: "Editing another unrelated line.",
        toolCalls: [
          {
            callId: "call-2",
            toolId: "workspace.replace_exact_text",
            arguments: {
              relativePath: "src/Greeting.txt",
              expectedText: "Line three",
              replacementText: "Line THREE edited"
            }
          }
        ],
        usage: usage(),
        finishReason: "tool_calls"
      }
    ]);
    const dependencies = await buildDependencies({ provider });
    const loop = new AgentLoop(dependencies);
    const sessionDescriptor = descriptor(workspaceRoot, sourceRoot, sourceFixtureHash, {
      limits: {
        ...descriptor(workspaceRoot, sourceRoot, sourceFixtureHash).limits,
        maxConsecutiveFailedFixes: 2
      }
    });

    const result = await loop.run(request(sessionDescriptor), NOT_CANCELLED);

    expect(result.projection.status).toBe("blocked");
    expect(result.projection.stopReason).toBe("failed_fix_exhausted");
    expect(result.projection.consecutiveFailedFixes).toBe(2);
    replaySession(sessionDescriptor.sessionId, result.events);
  });

  it("blocks immediately on a tool dispatch failure", async () => {
    const { workspaceRoot, sourceRoot, sourceFixtureHash } = await fixture("Hello from fixture\n");
    const provider = scriptedProvider([
      {
        assistantText: "Applying a bad fix.",
        toolCalls: [
          {
            callId: "call-1",
            toolId: "workspace.replace_exact_text",
            arguments: {
              relativePath: "src/Greeting.txt",
              expectedText: "NONEXISTENT_TEXT",
              replacementText: "Anything"
            }
          }
        ],
        usage: usage(),
        finishReason: "tool_calls"
      }
    ]);
    const dependencies = await buildDependencies({ provider });
    const loop = new AgentLoop(dependencies);
    const sessionDescriptor = descriptor(workspaceRoot, sourceRoot, sourceFixtureHash);

    const result = await loop.run(request(sessionDescriptor), NOT_CANCELLED);

    expect(result.projection.status).toBe("blocked");
    expect(result.projection.terminalReason).toBe("EXPECTED_TEXT_COUNT");
    replaySession(sessionDescriptor.sessionId, result.events);
  });

  it("cancels before requesting any turn when cancellation is already requested", async () => {
    const { workspaceRoot, sourceRoot, sourceFixtureHash } = await fixture("Hello from fixture\n");
    const dependencies = await buildDependencies({ provider: scriptedProvider([]) });
    const loop = new AgentLoop(dependencies);
    const sessionDescriptor = descriptor(workspaceRoot, sourceRoot, sourceFixtureHash);

    const result = await loop.run(request(sessionDescriptor), { isCancellationRequested: true });

    expect(result.projection.status).toBe("cancelled");
    expect(result.projection.turnsUsed).toBe(0);
    replaySession(sessionDescriptor.sessionId, result.events);
  });

  it("completes a session whose model finishes immediately with zero tool calls", async () => {
    // The fixture already contains the replacement text, so verification legitimately passes
    // without a single tool dispatch or workspace mutation. This used to crash `AgentLoop.run`
    // with `SessionProjectionError` because `verification.recorded` required a committed
    // mutation regardless of whether the workspace already satisfied the work contract.
    const { workspaceRoot, sourceRoot, sourceFixtureHash } =
      await fixture("Hello from HVE-Forge\n");
    const provider = scriptedProvider([
      {
        assistantText: "The file already has the expected text; nothing to change.",
        toolCalls: [],
        usage: usage(),
        finishReason: "completed"
      }
    ]);
    const dependencies = await buildDependencies({ provider });
    const loop = new AgentLoop(dependencies);
    const sessionDescriptor = descriptor(workspaceRoot, sourceRoot, sourceFixtureHash);

    const result = await loop.run(request(sessionDescriptor), NOT_CANCELLED);

    expect(result.projection.status).toBe("completed");
    expect(result.projection.turnsUsed).toBe(1);
    expect(result.projection.toolDispatchesUsed).toBe(0);
    expect(result.projection.workspaceMutations).toBe(0);
    const replayed = replaySession(sessionDescriptor.sessionId, result.events);
    expect(replayed).toEqual(result.projection);
  });

  it("stops when only the tool-dispatch budget is exhausted, not the turn budget", async () => {
    // maxToolDispatches is exhausted after the first read while maxTurns (8, the default) is
    // nowhere close. Each turn requests a structurally different read so the action signature
    // never repeats, isolating the tool-dispatch budget from oscillation detection. The reducer
    // used to accept `decision_budget_exhausted` only when `turnsUsed >= maxTurns`, so this
    // legitimate stop crashed the loop with `SessionProjectionError` before the fix.
    const { workspaceRoot, sourceRoot, sourceFixtureHash } = await fixture("Hello from fixture\n");
    const provider = scriptedProvider([
      {
        assistantText: "Reading the file.",
        toolCalls: [
          {
            callId: "call-1",
            toolId: "workspace.read_file",
            arguments: { relativePath: "src/Greeting.txt" }
          }
        ],
        usage: usage(),
        finishReason: "tool_calls"
      },
      {
        assistantText: "Listing the directory.",
        toolCalls: [
          {
            callId: "call-2",
            toolId: "workspace.list_directory",
            arguments: { relativePath: "src" }
          }
        ],
        usage: usage(),
        finishReason: "tool_calls"
      }
    ]);
    const dependencies = await buildDependencies({ provider });
    const loop = new AgentLoop(dependencies);
    const sessionDescriptor = descriptor(workspaceRoot, sourceRoot, sourceFixtureHash, {
      limits: {
        ...descriptor(workspaceRoot, sourceRoot, sourceFixtureHash).limits,
        maxToolDispatches: 1
      }
    });

    const result = await loop.run(request(sessionDescriptor), NOT_CANCELLED);

    expect(result.projection.status).toBe("blocked");
    expect(result.projection.stopReason).toBe("decision_budget_exhausted");
    expect(result.projection.toolDispatchesUsed).toBe(1);
    expect(result.projection.turnsUsed).toBeLessThan(sessionDescriptor.limits.maxTurns);
    replaySession(sessionDescriptor.sessionId, result.events);
  });
});
