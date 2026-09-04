import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type {
  EvaluationArtifact,
  RunDescriptor,
  RunStore,
  VerificationArtifact
} from "../application/contracts.js";
import { computeRunDescriptorHash } from "../application/descriptor.js";
import {
  canonicalizeJson,
  canonicalizeValue,
  type JsonValue,
  sha256Hex
} from "../core/canonical-json.js";
import {
  createRunEvent,
  EMPTY_HASH,
  type EventPayload,
  parseRunEvent,
  type RunEvent,
  serializeRunEvent,
  validateRunEvent
} from "../core/events.js";
import { projectionHash, type RunProjection, replayRun } from "../core/runs.js";
import {
  assertNoLinks,
  assertNoLinksInAbsolutePath,
  readConfinedRegularFile
} from "./path-safety.js";
import { writeFileAtomic } from "./workspace.js";
import { createStoreZip } from "./zip.js";

const MAXIMUM_EVENT_LINE_BYTES = 1_048_576;
const MAXIMUM_ARCHIVE_ENTRY_BYTES = 4 * 1_048_576;
const EVENT_LEASE_MAX_AGE_MS = 10 * 60_000;
const EVENT_LEASE_CLOCK_SKEW_MS = 60_000;
const ARCHIVE_PATHS = [
  "state/events.jsonl",
  "state/projection.json",
  "state/checkpoint.json",
  "state/verification.internal.json",
  "state/evaluation.internal.json",
  "state/evidence/verification-final.json",
  "state/evaluations/evaluation-final.json",
  "state/tool-calls/tool-final.json"
] as const;

export class EventConcurrencyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EventConcurrencyError";
  }
}

export class FileRunStore implements RunStore {
  public async create(descriptor: RunDescriptor): Promise<void> {
    await mkdir(descriptor.stateRoot, { recursive: true });
    const path = metadataPath(descriptor.runRoot);
    if (await exists(path)) throw new Error("Run metadata already exists.");
    await writeFileAtomic(path, `${JSON.stringify(toPlain(descriptor), null, 2)}\n`);
  }

  public async load(runRoot: string): Promise<RunDescriptor> {
    const requestedRunRoot = trimSeparator(resolve(runRoot));
    await assertNoLinksInAbsolutePath(requestedRunRoot);
    const descriptor = parseDescriptor(
      await readConfinedRegularFile(requestedRunRoot, "state/run.json")
    );
    await validatePhysicalRoots(descriptor, requestedRunRoot);
    const events = await this.readEvents(descriptor);
    if (events.length === 0) throw new Error("Run metadata has no descriptor-binding event.");
    validateDescriptorBinding(descriptor, events[0] as RunEvent);
    return descriptor;
  }

  public async readEvents(descriptor: RunDescriptor): Promise<readonly RunEvent[]> {
    const path = eventsPath(descriptor);
    if (!(await exists(path))) return [];
    const content = await readFile(path, "utf8");
    const lines = content.split(/\r?\n/);
    if (lines.at(-1) === "") lines.pop();
    const events: RunEvent[] = [];
    let previousHash = EMPTY_HASH;
    let sequence = 1;
    for (const line of lines) {
      if (line === "" || Buffer.byteLength(line, "utf8") > MAXIMUM_EVENT_LINE_BYTES) {
        throw new Error("Event store contains an empty, torn, or oversized record.");
      }
      const event = parseRunEvent(line);
      validateRunEvent(event, descriptor.runId, sequence, previousHash);
      events.push(event);
      previousHash = event.eventHash;
      sequence++;
    }
    return events;
  }

  public async append(
    descriptor: RunDescriptor,
    eventType: string,
    payload: EventPayload,
    occurredAt: string,
    expectedSequence: number,
    expectedPreviousHash: string
  ): Promise<RunEvent> {
    const lockPath = join(descriptor.stateRoot, "events.lock");
    const lease = await acquireEventLease(lockPath);
    try {
      const events = await this.readEvents(descriptor);
      const actualSequence = events.length + 1;
      const actualHead = events.at(-1)?.eventHash ?? EMPTY_HASH;
      if (actualSequence !== expectedSequence || actualHead !== expectedPreviousHash) {
        throw new EventConcurrencyError(
          `Expected sequence/head ${expectedSequence}/${expectedPreviousHash}, observed ${actualSequence}/${actualHead}.`
        );
      }
      if (events.length === 0) {
        if (
          eventType !== "run.created" ||
          payload["descriptorHash"] !== computeRunDescriptorHash(descriptor)
        ) {
          throw new Error("First event must bind the complete run descriptor.");
        }
      } else {
        validateDescriptorBinding(descriptor, events[0] as RunEvent);
      }
      const event = createRunEvent(
        descriptor.runId,
        expectedSequence,
        { eventType, payload, occurredAt },
        expectedPreviousHash
      );
      const output = await open(eventsPath(descriptor), "a");
      try {
        await output.writeFile(`${serializeRunEvent(event)}\n`, "utf8");
        await output.sync();
      } finally {
        await output.close();
      }
      const updated = [...events, event];
      const projection = replayRun(descriptor.runId, updated);
      await writeProjection(descriptor, projection);
      if (event.eventType === "tool.dispatched" || event.eventType === "tool.completed") {
        await writeToolCall(descriptor, updated);
      }
      return event;
    } finally {
      await releaseEventLease(lockPath, lease);
    }
  }

  public async saveVerification(
    descriptor: RunDescriptor,
    artifact: VerificationArtifact
  ): Promise<void> {
    await writeCanonical(
      join(descriptor.stateRoot, "verification.internal.json"),
      artifactToJson(artifact)
    );
    await writeCanonical(join(descriptor.stateRoot, "evidence/verification-final.json"), {
      schemaVersion: "1.0",
      evidenceId: artifact.summary.evidenceId,
      runId: descriptor.runId,
      evidenceClass: "verification",
      producer: "hve.file-content",
      action: "Verify exact replacement and protected source manifest",
      workingDirectory: "workspace",
      startedAt: timestamp(artifact.summary.capturedAt),
      endedAt: timestamp(artifact.summary.capturedAt),
      expected: "Replacement present once, original absent, workspace hash bound, source unchanged",
      observed: `${artifact.summary.passedChecks}/${artifact.summary.discoveredChecks} checks passed`,
      checks: artifact.checks,
      result: {
        status:
          artifact.summary.passedChecks === artifact.summary.discoveredChecks ? "passed" : "failed",
        exitCode: artifact.summary.passedChecks === artifact.summary.discoveredChecks ? 0 : 1,
        discoveredTests: artifact.summary.discoveredTests,
        passedTests: artifact.summary.passedTests,
        cached: artifact.summary.cached
      },
      policyVersion: artifact.policyVersion,
      policyHash: artifact.policyHash,
      instructionDigest: artifact.instructionDigest,
      providerDecisionHash: artifact.providerDecisionHash,
      normalizedArgumentsHash: artifact.normalizedArgumentsHash,
      idempotencyKey: artifact.idempotencyKey,
      beforeFileHash: artifact.beforeFileHash,
      afterFileHash: artifact.afterFileHash,
      verifier: {
        identity: "hve.file-content",
        version: "1.0.0",
        resultHash: artifact.resultHash
      },
      sourceFixtureHash: artifact.sourceFixtureHash,
      sourceCommit: null,
      workspaceHash: artifact.summary.workspaceHash,
      eventChainHead: artifact.summary.eventChainHead,
      artifactHashes: [artifact.resultHash],
      freshness: { capturedAt: timestamp(artifact.summary.capturedAt), validUntilMutation: true }
    });
  }

  public async loadVerification(descriptor: RunDescriptor): Promise<VerificationArtifact> {
    const value = await readRequiredJson(join(descriptor.stateRoot, "verification.internal.json"));
    if (!isObject(value) || !isObject(value["summary"]))
      throw new Error("Verification artifact is invalid.");
    const summary = value["summary"];
    return {
      ...(value as unknown as Omit<VerificationArtifact, "summary">),
      summary: {
        ...(summary as unknown as Omit<VerificationArtifact["summary"], "capturedAt">),
        capturedAt: new Date(requiredString(summary, "capturedAt"))
      }
    };
  }

  public async saveEvaluation(
    descriptor: RunDescriptor,
    artifact: EvaluationArtifact
  ): Promise<void> {
    await writeCanonical(
      join(descriptor.stateRoot, "evaluation.internal.json"),
      artifactToJson(artifact)
    );
    const scores = Object.fromEntries(
      Object.entries(artifact.scores).map(([dimension, score]) => [
        dimension,
        { score, evidenceReferences: artifact.evidenceHashes }
      ])
    );
    await writeCanonical(join(descriptor.stateRoot, "evaluations/evaluation-final.json"), {
      schemaVersion: "1.0",
      evaluationId: artifact.summary.evaluationId,
      runId: descriptor.runId,
      evaluatorId: "hve.read-only-evaluator",
      rubricVersion: descriptor.assets.evaluatorRubricVersion,
      capabilities: artifact.summary.capabilities,
      projectionHash: artifact.summary.projectionHash,
      workspaceHash: artifact.summary.workspaceHash,
      eventChainHead: artifact.summary.eventChainHead,
      evidenceHashes: artifact.evidenceHashes,
      scores,
      findings: artifact.summary.findings.map((finding) => ({
        ...finding,
        evidenceReferences: artifact.evidenceHashes
      })),
      verdict: artifact.summary.verdict,
      startedAt: artifact.startedAt,
      endedAt: artifact.endedAt
    });
  }

  public async loadEvaluation(descriptor: RunDescriptor): Promise<EvaluationArtifact> {
    return (await readRequiredJson(
      join(descriptor.stateRoot, "evaluation.internal.json")
    )) as EvaluationArtifact;
  }

  public async saveCheckpoint(
    descriptor: RunDescriptor,
    projection: RunProjection,
    workspaceHash: string,
    events: readonly RunEvent[]
  ): Promise<string> {
    const json = {
      schemaVersion: "1.0",
      checkpointId: "checkpoint-latest",
      runId: descriptor.runId,
      sequence: projection.lastSequence,
      eventChainHead: projection.eventChainHead,
      projectionHash: projectionHash(projection),
      workspaceHash,
      budget: {
        decisionsUsed: projection.decisionsUsed,
        toolDispatchesUsed: projection.toolDispatchesUsed,
        inputTokensUsed: sumUsage(events, "inputTokens"),
        outputTokensUsed: sumUsage(events, "outputTokens"),
        costMinorUnits: sumUsage(events, "costMinorUnits"),
        elapsedMilliseconds: Math.max(
          0,
          Date.parse(projection.updatedAt) - Date.parse(descriptor.createdAt)
        )
      },
      openFindings: [],
      nextAction: "verify",
      createdAt: projection.updatedAt
    };
    const canonical = canonicalizeValue(json);
    await writeFileAtomic(join(descriptor.stateRoot, "checkpoint.json"), canonical);
    return sha256Hex(canonical);
  }

  public async saveAsset(descriptor: RunDescriptor, name: string, content: string): Promise<void> {
    validateAssetName(name);
    await writeFileAtomic(join(descriptor.stateRoot, "assets", name), content);
  }

  public async loadAsset(descriptor: RunDescriptor, name: string): Promise<string> {
    validateAssetName(name);
    return readFile(join(descriptor.stateRoot, "assets", name), "utf8");
  }

  public async archive(descriptor: RunDescriptor, destinationPath: string): Promise<void> {
    const destination = resolve(destinationPath);
    const runRoot = trimSeparator(resolve(descriptor.runRoot));
    const fromRun = relative(runRoot, destination);
    if (fromRun === "" || (!fromRun.startsWith(`..${sep}`) && fromRun !== "..")) {
      throw new Error("Archive destination cannot be inside the run root.");
    }
    if (await exists(destination)) throw new Error("Archive destination already exists.");
    const entries: { path: string; content: Uint8Array }[] = [];
    const manifestEntries: JsonValue[] = [];
    for (const relativePath of ARCHIVE_PATHS) {
      const path = join(runRoot, ...relativePath.split("/"));
      if (!(await exists(path))) continue;
      await assertNoLinks(runRoot, path);
      const content = await readFile(path);
      if (content.byteLength > MAXIMUM_ARCHIVE_ENTRY_BYTES) {
        throw new Error(`Archive evidence file is too large: ${relativePath}.`);
      }
      validateArchiveContent(relativePath, content);
      entries.push({ path: relativePath, content });
      manifestEntries.push({
        path: relativePath,
        byteLength: content.byteLength,
        sha256: sha256Hex(content)
      });
    }
    const manifest = Buffer.from(
      canonicalizeValue({
        schemaVersion: "1.0",
        runId: descriptor.runId,
        entries: manifestEntries
      }),
      "utf8"
    );
    entries.push({ path: "archive-manifest.json", content: manifest });
    await mkdir(dirname(destination), { recursive: true });
    await writeFileAtomic(destination, createStoreZip(entries));
  }
}

export function hashArtifact(value: unknown): string {
  return sha256Hex(canonicalizeValue(toPlain(value) as JsonValue));
}

function parseDescriptor(bytes: Uint8Array): RunDescriptor {
  const value = JSON.parse(canonicalizeJson(bytes)) as unknown;
  if (!isObject(value)) throw new Error("Run metadata must be an object.");
  const required = [
    "schemaVersion",
    "runId",
    "parentRunId",
    "taskId",
    "objective",
    "runRoot",
    "workspaceRoot",
    "stateRoot",
    "sourceFixturePath",
    "sourceFixtureHash",
    "targetRelativePath",
    "expectedTextHash",
    "replacementTextHash",
    "providerId",
    "providerAdapterVersion",
    "providerRequestedModel",
    "providerServedModel",
    "providerDiscoveredAt",
    "providerContextWindowTokens",
    "providerMaxOutputTokens",
    "providerCapabilitiesHash",
    "workContractHash",
    "policyVersion",
    "policyHash",
    "interruptionPoint",
    "limits",
    "assets",
    "createdAt"
  ];
  if (Object.keys(value).sort().join("|") !== required.sort().join("|")) {
    throw new Error("Run metadata fields are invalid.");
  }
  return value as unknown as RunDescriptor;
}

async function validatePhysicalRoots(
  descriptor: RunDescriptor,
  requestedRunRoot: string
): Promise<void> {
  const expectedState = join(requestedRunRoot, "state");
  const expectedWorkspace = join(requestedRunRoot, "workspace");
  const expectedSource = join(requestedRunRoot, "source");
  if (
    descriptor.schemaVersion !== "1.0" ||
    !pathEquals(descriptor.runRoot, requestedRunRoot) ||
    !pathEquals(descriptor.stateRoot, expectedState) ||
    !pathEquals(descriptor.workspaceRoot, expectedWorkspace) ||
    !pathEquals(descriptor.sourceFixturePath, expectedSource) ||
    descriptor.runId !== requestedRunRoot.split(sep).at(-1) ||
    !(await exists(expectedState)) ||
    !(await exists(expectedWorkspace)) ||
    !(await exists(expectedSource))
  ) {
    throw new Error("Run metadata physical roots do not match the requested run directory.");
  }
  await assertNoLinks(requestedRunRoot, expectedState);
  await assertNoLinks(requestedRunRoot, expectedWorkspace);
  await assertNoLinks(requestedRunRoot, expectedSource);
}

function validateDescriptorBinding(descriptor: RunDescriptor, first: RunEvent): void {
  if (
    first.sequence !== 1 ||
    first.eventType !== "run.created" ||
    first.payload["descriptorHash"] !== computeRunDescriptorHash(descriptor)
  ) {
    throw new Error("Run metadata does not match its hash-chained descriptor binding.");
  }
}

async function writeProjection(
  descriptor: RunDescriptor,
  projection: RunProjection
): Promise<void> {
  await writeCanonical(join(descriptor.stateRoot, "projection.json"), {
    schemaVersion: "1.0",
    ...projection
  });
}

async function writeToolCall(
  descriptor: RunDescriptor,
  events: readonly RunEvent[]
): Promise<void> {
  const provider = lastEvent(events, "provider.decision_recorded");
  const dispatched = lastEvent(events, "tool.dispatched");
  if (provider === undefined || dispatched === undefined) return;
  const completed = lastEvent(events, "tool.completed");
  await writeCanonical(join(descriptor.stateRoot, "tool-calls/tool-final.json"), {
    schemaVersion: "1.0",
    toolCallId: requiredPayloadString(dispatched, "toolCallId"),
    runId: descriptor.runId,
    toolName: requiredPayloadString(dispatched, "toolName"),
    toolVersion: "1.0.0",
    actionClass: "workspace_write",
    arguments: [
      { name: "relativePath", classification: "public", value: descriptor.targetRelativePath },
      {
        name: "expectedTextSha256",
        classification: "sensitive",
        value: descriptor.expectedTextHash
      },
      {
        name: "replacementTextSha256",
        classification: "sensitive",
        value: descriptor.replacementTextHash
      }
    ],
    argumentsHash: requiredPayloadString(provider, "argumentsHash"),
    idempotencyKey: requiredPayloadString(dispatched, "idempotencyKey"),
    policyDecisionId: "policy-final",
    status: completed === undefined ? "running" : requiredPayloadString(completed, "outcome"),
    requestedAt: provider.occurredAt,
    startedAt: dispatched.occurredAt,
    endedAt: completed?.occurredAt ?? null,
    resultReference: completed === undefined ? null : "idempotency/replace-1.json"
  });
}

async function writeCanonical(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, canonicalizeValue(toPlain(value) as JsonValue));
}

async function readRequiredJson(path: string): Promise<unknown> {
  if (!(await exists(path))) throw new Error(`Required run artifact was not found: ${path}.`);
  return JSON.parse(canonicalizeJson(await readFile(path))) as unknown;
}

function artifactToJson(value: unknown): JsonValue {
  return toPlain(value) as JsonValue;
}

function toPlain(value: unknown): unknown {
  if (value instanceof Date) return timestamp(value);
  if (Array.isArray(value)) return value.map(toPlain);
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toPlain(item)]));
  }
  return value;
}

function timestamp(value: Date): string {
  return value.toISOString().replace("Z", "0000+00:00");
}

function sumUsage(events: readonly RunEvent[], property: string): number {
  return events
    .filter((event) => event.eventType === "provider.decision_recorded")
    .reduce((total, event) => {
      const value = event.payload[property];
      return total + (typeof value === "number" ? value : 0);
    }, 0);
}

function validateArchiveContent(path: string, content: Uint8Array): void {
  if (path === "state/events.jsonl") {
    for (const line of Buffer.from(content).toString("utf8").split(/\r?\n/).filter(Boolean)) {
      parseRunEvent(line);
    }
    return;
  }
  const value = JSON.parse(canonicalizeJson(content)) as unknown;
  if (!isObject(value)) throw new Error(`Archive evidence is not a JSON object: ${path}.`);
}

function requiredPayloadString(event: RunEvent, name: string): string {
  const value = event.payload[name];
  if (typeof value !== "string" || value === "")
    throw new Error(`Event payload ${name} is required.`);
  return value;
}

function requiredString(value: Record<string, unknown>, name: string): string {
  const result = value[name];
  if (typeof result !== "string" || result === "") throw new Error(`${name} is required.`);
  return result;
}

function lastEvent(events: readonly RunEvent[], eventType: string): RunEvent | undefined {
  return events.findLast((event) => event.eventType === eventType);
}

interface EventLease {
  readonly schemaVersion: "1.0";
  readonly ownerPid: number;
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly token: string;
}

async function acquireEventLease(lockPath: string): Promise<EventLease> {
  await assertNoLinks(dirname(lockPath), lockPath);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const acquiredAt = new Date();
    const lease: EventLease = {
      schemaVersion: "1.0",
      ownerPid: process.pid,
      acquiredAt: acquiredAt.toISOString(),
      expiresAt: new Date(acquiredAt.getTime() + EVENT_LEASE_MAX_AGE_MS).toISOString(),
      token: randomUUID()
    };
    const stagingPath = `${lockPath}.${lease.token}.pending`;
    await writeFile(stagingPath, `${JSON.stringify(lease)}\n`, {
      encoding: "utf8",
      flag: "wx",
      flush: true
    });
    try {
      await link(stagingPath, lockPath);
      return lease;
    } catch (error) {
      if (!(isNodeError(error) && error.code === "EEXIST")) throw error;
    } finally {
      await rm(stagingPath, { force: true });
    }
    if (attempt === 0 && (await reclaimStaleEventLease(lockPath))) continue;
    throw new EventConcurrencyError("Another writer holds the event lease.");
  }
  throw new EventConcurrencyError("The event lease could not be acquired.");
}

async function reclaimStaleEventLease(lockPath: string): Promise<boolean> {
  await assertNoLinks(dirname(lockPath), lockPath);
  const before = await lstatOptional(lockPath);
  if (before === null) return true;
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new EventConcurrencyError("The event lease is not a regular file.");
  }
  const content = await readFile(lockPath, "utf8");
  if (Buffer.byteLength(content, "utf8") > 4_096) {
    throw new EventConcurrencyError("The event lease record is oversized.");
  }
  const lease = parseEventLease(content);
  const effectiveExpiry = Math.min(
    Date.parse(lease.expiresAt),
    Number(before.mtimeMs) + EVENT_LEASE_MAX_AGE_MS
  );
  if (Date.now() < effectiveExpiry && isProcessAlive(lease.ownerPid)) return false;
  const after = await lstatOptional(lockPath);
  if (
    after === null ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    (await readFile(lockPath, "utf8")) !== content
  ) {
    return false;
  }
  await rm(lockPath);
  await rm(`${lockPath}.${lease.token}.pending`, { force: true });
  return true;
}

async function releaseEventLease(lockPath: string, lease: EventLease): Promise<void> {
  await assertNoLinks(dirname(lockPath), lockPath);
  const current = parseEventLease(await readFile(lockPath, "utf8"));
  if (current.ownerPid !== lease.ownerPid || current.token !== lease.token) {
    throw new EventConcurrencyError("The event lease changed while held by this writer.");
  }
  await rm(lockPath);
}

function parseEventLease(content: string): EventLease {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new EventConcurrencyError(`The event lease record is malformed: ${String(error)}.`);
  }
  if (!isObject(value)) throw new EventConcurrencyError("The event lease record is malformed.");
  const keys = Object.keys(value).sort().join("|");
  if (keys !== "acquiredAt|expiresAt|ownerPid|schemaVersion|token") {
    throw new EventConcurrencyError("The event lease fields are invalid.");
  }
  const ownerPid = value["ownerPid"];
  const acquiredAt = value["acquiredAt"];
  const expiresAt = value["expiresAt"];
  const token = value["token"];
  const acquiredMilliseconds = typeof acquiredAt === "string" ? Date.parse(acquiredAt) : Number.NaN;
  const expiresMilliseconds = typeof expiresAt === "string" ? Date.parse(expiresAt) : Number.NaN;
  if (
    value["schemaVersion"] !== "1.0" ||
    !Number.isSafeInteger(ownerPid) ||
    typeof ownerPid !== "number" ||
    ownerPid < 1 ||
    typeof acquiredAt !== "string" ||
    Number.isNaN(acquiredMilliseconds) ||
    acquiredMilliseconds > Date.now() + EVENT_LEASE_CLOCK_SKEW_MS ||
    typeof expiresAt !== "string" ||
    expiresMilliseconds - acquiredMilliseconds !== EVENT_LEASE_MAX_AGE_MS ||
    typeof token !== "string" ||
    !/^[A-Za-z0-9-]{1,128}$/.test(token)
  ) {
    throw new EventConcurrencyError("The event lease values are invalid.");
  }
  return { schemaVersion: "1.0", ownerPid, acquiredAt, expiresAt, token };
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if (isNodeError(error) && (error.code === "ESRCH" || error.code === "EINVAL")) return false;
    if (isNodeError(error) && error.code === "EPERM") return true;
    throw error;
  }
}

async function lstatOptional(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

function metadataPath(runRoot: string): string {
  return join(runRoot, "state", "run.json");
}

function eventsPath(descriptor: RunDescriptor): string {
  return join(descriptor.stateRoot, "events.jsonl");
}

function pathEquals(left: string, right: string): boolean {
  const comparisonLeft = trimSeparator(resolve(left));
  const comparisonRight = trimSeparator(resolve(right));
  return process.platform === "win32"
    ? comparisonLeft.toLowerCase() === comparisonRight.toLowerCase()
    : comparisonLeft === comparisonRight;
}

function trimSeparator(path: string): string {
  return path.endsWith(sep) ? path.slice(0, -1) : path;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function validateAssetName(name: string): void {
  if (!/^[a-z0-9][a-z0-9.-]{0,127}$/.test(name)) {
    throw new Error("Run asset name is invalid.");
  }
}
