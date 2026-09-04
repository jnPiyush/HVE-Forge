import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { buildCoworkPackage } from "../adapters/cowork-package.js";
import { PathSafetyError, readConfinedRegularFile } from "../adapters/path-safety.js";
import { validateJsonSchema } from "../adapters/schema-validator.js";
import { computeWorkingTreeHash } from "../adapters/working-tree-fingerprint.js";
import { writeFileAtomic } from "../adapters/workspace.js";
import {
  type HandoffPacket,
  HarnessError,
  HarnessExitCode,
  type RunResult,
  type SubmitRunRequest
} from "../application/contracts.js";
import { SecretRedactor } from "../application/redactor.js";
import { canonicalizeJson, canonicalizeValue, sha256Hex } from "../core/canonical-json.js";
import { EventIntegrityError, serializeRunEvent } from "../core/events.js";
import { gradeFreshness } from "../core/freshness.js";
import { projectionHash } from "../core/runs.js";
import { sessionProjectionHash } from "../core/sessions.js";
import { inspectHostWorkspace } from "../hosts/doctor.js";
import { renderWorkspace } from "../hosts/renderer.js";
import type { HostId } from "../hosts/types.js";
import { createDefaultHarness, createDefaultSubmitRequest } from "./composition.js";
import {
  assertDistributionOverride,
  defaultDistributionRoot,
  loadDistributionIdentity
} from "./distribution-root.js";
import { createDefaultAgentSession } from "./session-composition.js";

export interface CliIo {
  stdout(line: string): void;
  stderr(line: string): void;
}

export interface CliEnvironment {
  readonly cwd?: string;
  readonly variables?: NodeJS.ProcessEnv;
  readonly distributionRoot?: string;
}

export class CliUsageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

const HOSTS = new Set<HostId>(["generic", "vscode", "cursor", "claude"]);

export async function runCli(
  args: readonly string[],
  io: CliIo,
  environment: CliEnvironment = {}
): Promise<number> {
  const variables = environment.variables ?? process.env;
  const redactor = new SecretRedactor([variables["HVE_FIXTURE_CANARY"] ?? ""]);
  try {
    if (args.length === 0 || ["help", "--help", "-h"].includes(args[0] ?? "")) {
      writeHelp(io);
      return HarnessExitCode.Completed;
    }
    if (["version", "--version"].includes(args[0] ?? "")) {
      io.stdout("hve 0.2.0");
      return HarnessExitCode.Completed;
    }
    const command = (args[0] as string).toLowerCase();
    const parsed = ParsedArguments.parse(args.slice(1));
    const cwd = resolve(environment.cwd ?? process.cwd());
    const distribution = await loadDistributionIdentity(
      environment.distributionRoot ?? defaultDistributionRoot()
    );
    assertDistributionOverride(parsed.get("repository-root"), distribution);
    const distributionRoot = distribution.root;

    if (["init", "render", "update", "doctor"].includes(command)) {
      return await runHostCommand(command, parsed, distributionRoot, cwd, io);
    }
    if (command === "approval") return runApproval(parsed, io);
    if (command === "mcp") return await runMcp(distributionRoot, io);
    if (command === "agent-run") return await runAgentSession(parsed, distributionRoot, io);
    if (command === "cowork-package") return await runCoworkPackage(parsed, distributionRoot, io);

    const runRootArgument = parsed.positionals[0] ?? "";
    const runsRoot = ["run", "submit"].includes(command)
      ? resolve(parsed.get("runs-root") ?? join(distributionRoot, ".hve/runs"))
      : runRootArgument === ""
        ? join(distributionRoot, ".hve/runs")
        : dirname(resolve(runRootArgument));
    const composition = await createDefaultHarness({
      repositoryRoot: distributionRoot,
      runsRoot,
      policyPath:
        parsed.get("policy") ?? join(distributionRoot, "policies/organization-policy.v1.json"),
      canary: variables["HVE_FIXTURE_CANARY"] ?? ""
    });
    const service = composition.service;

    switch (command) {
      case "run":
      case "submit": {
        const base = await createDefaultSubmitRequest({
          repositoryRoot: distributionRoot,
          sourceFixturePath: resolve(
            parsed.get("fixture") ?? join(distributionRoot, "samples/fixture-repo")
          ),
          runsRoot: resolve(parsed.get("runs-root") ?? join(distributionRoot, ".hve/runs")),
          taskId: parsed.get("task-id") ?? "fixture-task",
          objective:
            parsed.get("objective") ?? "Replace the fixture greeting with the approved text.",
          targetRelativePath: parsed.get("target") ?? "src/Greeting.txt",
          expectedText: decodeEscapes(parsed.get("expected") ?? "Hello from fixture"),
          replacementText: decodeEscapes(parsed.get("replacement") ?? "Hello from HVE-Forge"),
          providerId: parsed.get("provider") ?? "fixture-openai",
          interruptionPoint: parseInterruption(parsed.get("interrupt"))
        });
        const request: SubmitRunRequest = {
          ...base,
          limits: {
            maxDecisions: parsed.getInteger("max-decisions", 1),
            maxToolDispatches: parsed.getInteger("max-tool-dispatches", 1),
            maxElapsedMilliseconds: parsed.getInteger("max-elapsed-ms", 300_000),
            maxInputTokens: parsed.getInteger("max-input-tokens", 0),
            maxOutputTokens: parsed.getInteger("max-output-tokens", 0),
            maxCostMinorUnits: parsed.getInteger("max-cost-minor-units", 0)
          }
        };
        return writeRunResult(io, await service.submit(request));
      }
      case "resume":
        return writeRunResult(io, await service.resume(parsed.requireRunRoot()));
      case "retry":
        return writeRunResult(io, await service.retry(parsed.requireRunRoot()));
      case "fork":
        return writeRunResult(io, await service.fork(parsed.requireRunRoot()));
      case "pause":
        return writeRunResult(io, await service.pause(parsed.requireRunRoot()));
      case "cancel":
        return writeRunResult(io, await service.cancel(parsed.requireRunRoot()));
      case "inspect":
        return writeRunResult(io, await service.inspect(parsed.requireRunRoot()));
      case "replay": {
        const replay = await service.replay(parsed.requireRunRoot());
        io.stdout(
          JSON.stringify({
            type: "replay",
            runId: replay.projection.runId,
            status: replay.projection.status,
            eventCount: replay.eventCount,
            projectionHash: replay.projectionHash,
            semanticTraceHash: replay.semanticTraceHash
          })
        );
        return HarnessExitCode.Completed;
      }
      case "stream": {
        for (const event of await service.stream(
          parsed.requireRunRoot(),
          parsed.getInteger("after", 0)
        )) {
          io.stdout(serializeRunEvent(event));
        }
        return HarnessExitCode.Completed;
      }
      case "instructions": {
        const selection = await service.inspectInstructions(
          resolve(parsed.require("workspace")),
          parsed.require("target")
        );
        io.stdout(
          JSON.stringify({
            type: "instructions",
            effective: selection.relativePath,
            effectiveHash: selection.contentHash,
            byteLength: selection.byteLength,
            sources: selection.sources,
            conflicts: selection.conflicts
          })
        );
        return HarnessExitCode.Completed;
      }
      case "skills": {
        const root = resolve(parsed.get("root") ?? join(distributionRoot, "hve/skills"));
        const name = parsed.get("activate");
        if (name === undefined) {
          io.stdout(
            JSON.stringify({ type: "skills", root, skills: await service.inspectSkills(root) })
          );
        } else {
          const skill = await service.activateSkill(root, name);
          io.stdout(
            JSON.stringify({
              type: "skill",
              descriptor: skill.descriptor,
              instructionsLoaded: true,
              instructionBytes: Buffer.byteLength(skill.instructions, "utf8")
            })
          );
        }
        return HarnessExitCode.Completed;
      }
      case "handoff": {
        const packet = await service.createHandoff(parsed.requireRunRoot());
        const path = resolve(parsed.require("destination"));
        const bytes = canonicalizeJson(JSON.stringify(packet));
        await writeFileAtomic(path, bytes);
        io.stdout(
          JSON.stringify({
            type: "handoff",
            path,
            runId: packet.runId,
            sourceEventHead: packet.sourceEventHead,
            hash: sha256Hex(bytes)
          })
        );
        return HarnessExitCode.Completed;
      }
      case "reset": {
        if (parsed.positionals.length !== 1) {
          throw new CliUsageError("reset requires one handoff path.");
        }
        const bytes = await readFile(resolve(parsed.positionals[0] as string));
        const value = JSON.parse(canonicalizeJson(bytes)) as unknown;
        const schema = JSON.parse(
          await readFile(join(distributionRoot, "schemas/v1/handoff.schema.json"), "utf8")
        ) as unknown;
        const validation = validateJsonSchema(value, schema);
        if (!validation.valid) {
          throw new HarnessError(
            HarnessExitCode.ReplayIntegrityFailure,
            `Handoff is invalid: ${validation.errors.join("; ")}`
          );
        }
        return writeRunResult(io, await service.resumeFromHandoff(value as HandoffPacket));
      }
      case "archive": {
        const path = resolve(parsed.require("destination"));
        await service.archive(parsed.requireRunRoot(), path);
        const bytes = await readFile(path);
        io.stdout(
          JSON.stringify({
            type: "archive",
            path,
            byteLength: bytes.byteLength,
            sha256: sha256Hex(bytes)
          })
        );
        return HarnessExitCode.Completed;
      }
      default:
        throw new CliUsageError(`Unknown command: ${command}.`);
    }
  } catch (error) {
    if (
      error instanceof CliUsageError ||
      error instanceof TypeError ||
      error instanceof RangeError
    ) {
      io.stderr(redactor.redact(error.message));
      return HarnessExitCode.InvalidInvocation;
    }
    if (error instanceof HarnessError) {
      io.stderr(redactor.redact(error.message));
      return error.exitCode;
    }
    if (error instanceof EventIntegrityError) {
      io.stderr(redactor.redact(error.message));
      return HarnessExitCode.ReplayIntegrityFailure;
    }
    if (error instanceof PathSafetyError) {
      io.stderr(redactor.redact(error.message));
      return HarnessExitCode.PolicyDenied;
    }
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(redactor.redact(`Internal failure: ${message}`));
    return HarnessExitCode.InternalFailure;
  }
}

async function runHostCommand(
  command: string,
  parsed: ParsedArguments,
  repositoryRoot: string,
  cwd: string,
  io: CliIo
): Promise<number> {
  const targetRoot = resolve(parsed.get("target-root") ?? cwd);
  const hosts = parseHosts(parsed.get("hosts"));
  if (command === "doctor") {
    const report = await inspectHostWorkspace(repositoryRoot, targetRoot, hosts);
    io.stdout(JSON.stringify({ type: "doctor", ...report }));
    return report.ok ? HarnessExitCode.Completed : HarnessExitCode.Blocked;
  }
  const mode = command === "update" ? "update" : parsed.hasFlag("check") ? "check" : "write";
  const render = await renderWorkspace({ sourceRoot: repositoryRoot, targetRoot, hosts, mode });
  io.stdout(JSON.stringify({ type: command === "init" ? "init" : "render", mode, ...render }));
  return render.clean ? HarnessExitCode.Completed : HarnessExitCode.Blocked;
}

async function runAgentSession(
  parsed: ParsedArguments,
  repositoryRoot: string,
  io: CliIo
): Promise<number> {
  const runsRoot = resolve(parsed.get("runs-root") ?? join(repositoryRoot, ".hve/sessions"));
  const composition = await createDefaultAgentSession({
    repositoryRoot,
    sourceFixturePath: resolve(
      parsed.get("fixture") ?? join(repositoryRoot, "samples/fixture-repo")
    ),
    runsRoot,
    targetRelativePath: parsed.get("target") ?? "src/Greeting.txt",
    expectedText: decodeEscapes(parsed.get("expected") ?? "Hello from fixture"),
    replacementText: decodeEscapes(parsed.get("replacement") ?? "Hello from HVE-Forge"),
    maxTurns: parsed.getInteger("max-turns", 8),
    maxToolDispatches: parsed.getInteger("max-tool-dispatches", 16)
  });
  const result = await composition.run({ isCancellationRequested: false });
  const lastVerification = [...result.events]
    .reverse()
    .find((event) => event.eventType === "verification.recorded");
  const recordedFingerprint =
    typeof lastVerification?.payload["workspaceHash"] === "string"
      ? lastVerification.payload["workspaceHash"]
      : null;
  const currentFingerprint = await computeWorkingTreeHash(composition.descriptor.workspaceRoot);
  const evidenceFreshness = gradeFreshness(recordedFingerprint, currentFingerprint);
  io.stdout(
    JSON.stringify({
      type: "agent-session-result",
      sessionId: composition.descriptor.sessionId,
      status: result.projection.status,
      turnsUsed: result.projection.turnsUsed,
      toolDispatchesUsed: result.projection.toolDispatchesUsed,
      stopReason: result.projection.stopReason,
      terminalReason: result.projection.terminalReason,
      lastSequence: result.projection.lastSequence,
      eventChainHead: result.projection.eventChainHead,
      projectionHash: sessionProjectionHash(result.projection),
      semanticTraceHash: result.semanticTraceHash,
      evidenceFreshness,
      eventsPath: join(composition.descriptor.stateRoot, "events.jsonl")
    })
  );
  return exitCodeForSession(result.projection.status);
}

async function runCoworkPackage(
  parsed: ParsedArguments,
  repositoryRoot: string,
  io: CliIo
): Promise<number> {
  const skillsRoot = resolve(parsed.get("skills-root") ?? join(repositoryRoot, "hve/skills"));
  const destination = resolve(
    parsed.get("destination") ?? join(repositoryRoot, ".hve/cowork/hve-forge-cowork.zip")
  );
  const result = await buildCoworkPackage({
    skillsRoot,
    colorIconPath: resolve(
      parsed.get("color-icon") ?? join(repositoryRoot, "config/cowork/color.png")
    ),
    outlineIconPath: resolve(
      parsed.get("outline-icon") ?? join(repositoryRoot, "config/cowork/outline.png")
    ),
    ...optionalField("id", parsed.get("id")),
    ...optionalField("version", parsed.get("package-version")),
    ...optionalField("developerName", parsed.get("developer")),
    ...optionalField("name", parsed.get("name")),
    ...optionalField("description", parsed.get("description"))
  });
  await writeFileAtomic(destination, result.archive);
  io.stdout(
    JSON.stringify({
      type: "cowork-package",
      destination,
      byteLength: result.archive.byteLength,
      sha256: sha256Hex(result.archive),
      manifestId: result.manifest.id,
      manifestVersion: result.manifest.version,
      includedSkills: result.includedSkills,
      excludedSkills: result.excludedSkills
    })
  );
  return HarnessExitCode.Completed;
}

function exitCodeForSession(status: string): HarnessExitCode {
  switch (status) {
    case "completed":
      return HarnessExitCode.Completed;
    case "cancelled":
      return HarnessExitCode.Cancelled;
    case "blocked":
      return HarnessExitCode.Blocked;
    case "failed":
      return HarnessExitCode.InternalFailure;
    default:
      return HarnessExitCode.Blocked;
  }
}

async function runMcp(repositoryRoot: string, io: CliIo): Promise<number> {
  const matrix = JSON.parse(
    (
      await readConfinedRegularFile(
        repositoryRoot,
        "protocols/mcp/2026-07-28/conformance-matrix.json"
      )
    ).toString("utf8")
  ) as unknown;
  io.stdout(JSON.stringify({ type: "mcp-conformance", matrix }));
  return HarnessExitCode.Completed;
}

function runApproval(parsed: ParsedArguments, io: CliIo): number {
  const action = parsed.require("action");
  const actionClass = parsed.require("class");
  if (!["external_write", "destructive", "privileged", "secret_bearing"].includes(actionClass)) {
    throw new CliUsageError(`Synthetic approval class is not high-risk: ${actionClass}.`);
  }
  const resource = parsed.require("resource");
  const actionHash = sha256Hex(canonicalizeValue({ action, actionClass, resource }));
  const requestedAt = new Date();
  io.stdout(
    JSON.stringify({
      type: "approval-required",
      request: {
        schemaVersion: "1.0",
        approvalId: `approval-${actionHash.slice(0, 32)}`,
        runId: "synthetic-run",
        requesterId: "agent:generator",
        approverId: null,
        actionClass,
        action,
        actionHash,
        risk: "high",
        resources: [resource],
        redactedArguments: [],
        expectedEffect: "The requested high-risk action would affect the named resource.",
        alternatives: ["Keep the action local and read-only."],
        requestedAt: requestedAt.toISOString(),
        expiresAt: new Date(requestedAt.getTime() + 5 * 60_000).toISOString(),
        decidedAt: null,
        status: "pending",
        decisionReason: null
      },
      executable: false,
      reason: "No risky capability is registered; human and policy approval are both required."
    })
  );
  return HarnessExitCode.PolicyDenied;
}

function writeRunResult(io: CliIo, result: RunResult): number {
  io.stdout(
    JSON.stringify({
      type: "result",
      exitCode: result.exitCode,
      runId: result.descriptor.runId,
      parentRunId: result.descriptor.parentRunId,
      runRoot: result.descriptor.runRoot,
      status: result.projection.status,
      lastSequence: result.projection.lastSequence,
      eventChainHead: result.projection.eventChainHead,
      projectionHash: projectionHash(result.projection),
      semanticTraceHash: result.semanticTraceHash,
      messages: result.messages
    })
  );
  return result.exitCode;
}

function parseHosts(value: string | undefined): readonly HostId[] {
  const hosts = (value ?? "vscode,cursor,claude")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  if (hosts.length === 0 || hosts.some((host) => !HOSTS.has(host as HostId))) {
    throw new CliUsageError("--hosts must list generic, vscode, cursor, or claude.");
  }
  return hosts as HostId[];
}

/** Omits a key entirely when its value is undefined, satisfying `exactOptionalPropertyTypes`. */
function optionalField<K extends string>(key: K, value: string | undefined): { [P in K]?: string } {
  return value === undefined ? ({} as never) : ({ [key]: value } as { [P in K]: string });
}

function parseInterruption(value: string | undefined): SubmitRunRequest["interruptionPoint"] {
  if (value === undefined || value === "none") return "none";
  if (
    value === "after-decision" ||
    value === "after-tool-commit" ||
    value === "after-verification" ||
    value === "after-evaluation"
  ) {
    return value;
  }
  throw new CliUsageError(`Unknown interruption point: ${value}.`);
}

function decodeEscapes(value: string): string {
  return value.replaceAll("\\r", "\r").replaceAll("\\n", "\n").replaceAll("\\t", "\t");
}

function writeHelp(io: CliIo): void {
  io.stdout("HVE-Forge deterministic cross-editor coding harness");
  io.stdout("Commands:");
  io.stdout("  hve init|render|update [--target-root PATH] [--hosts vscode,cursor,claude]");
  io.stdout("  hve render --check [--target-root PATH]");
  io.stdout("  hve doctor [--target-root PATH]");
  io.stdout(
    "  hve run|submit [--fixture PATH] [--target PATH] [--expected TEXT] [--replacement TEXT]"
  );
  io.stdout("  hve inspect|stream|pause|resume|cancel|retry|fork|replay RUN_ROOT");
  io.stdout("  hve instructions --workspace PATH --target RELATIVE_PATH");
  io.stdout("  hve skills [--root PATH] [--activate NAME]");
  io.stdout(
    "  hve agent-run [--fixture PATH] [--target PATH] [--expected TEXT] [--replacement TEXT]" +
      " [--max-turns N] [--max-tool-dispatches N]"
  );
  io.stdout(
    "  hve cowork-package [--skills-root PATH] [--destination PATH] [--color-icon PATH]" +
      " [--outline-icon PATH]"
  );
  io.stdout("  hve mcp | handoff | reset | approval | archive | version");
  io.stdout("No process, shell, network, browser, secret, or remote-write tool is registered.");
}

class ParsedArguments {
  private constructor(
    public readonly positionals: readonly string[],
    private readonly options: ReadonlyMap<string, string | null>
  ) {}

  public static parse(values: readonly string[]): ParsedArguments {
    const positionals: string[] = [];
    const options = new Map<string, string | null>();
    for (let index = 0; index < values.length; index++) {
      const current = values[index] as string;
      if (!current.startsWith("--")) {
        positionals.push(current);
        continue;
      }
      const name = current.slice(2);
      if (name === "" || options.has(name)) throw new CliUsageError(`Invalid option: ${current}.`);
      if (name === "quiet" || name === "check") {
        options.set(name, null);
        continue;
      }
      const next = values[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new CliUsageError(`Option ${current} requires a value.`);
      }
      options.set(name, next);
      index++;
    }
    return new ParsedArguments(positionals, options);
  }

  public get(name: string): string | undefined {
    const value = this.options.get(name);
    return typeof value === "string" ? value : undefined;
  }

  public require(name: string): string {
    const value = this.get(name);
    if (value === undefined) throw new CliUsageError(`Option --${name} is required.`);
    return value;
  }

  public hasFlag(name: string): boolean {
    return this.options.has(name);
  }

  public getInteger(name: string, defaultValue: number): number {
    const value = this.get(name);
    if (value === undefined) return defaultValue;
    if (!/^-?\d+$/.test(value)) throw new CliUsageError(`Option --${name} must be an integer.`);
    const result = Number(value);
    if (!Number.isSafeInteger(result)) throw new CliUsageError(`Option --${name} is out of range.`);
    return result;
  }

  public requireRunRoot(): string {
    if (this.positionals.length !== 1) {
      throw new CliUsageError("Command requires exactly one run-root positional argument.");
    }
    return resolve(this.positionals[0] as string);
  }
}
