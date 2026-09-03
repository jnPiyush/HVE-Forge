import { resolve } from "node:path";
import { canonicalizeValue, sha256Hex } from "../core/canonical-json.js";
import { loadHostCatalog } from "./catalog.js";
import {
  assertOwnedGeneratedHostFile,
  assertSafeHostRoot,
  normalizeHostRelativePath,
  readHostTextFile,
  removeHostFile,
  resolveHostPath,
  writeHostTextFileAtomic
} from "./path-safety.js";
import { loadHostProfile, normalizeHosts } from "./profiles.js";
import type {
  AgentCatalogItem,
  HostId,
  HostManifest,
  HostProfile,
  ManifestOutput,
  PlannedOutput,
  RuleCatalogItem
} from "./types.js";

export type RenderMode = "write" | "check" | "update";

export interface RenderOptions {
  readonly sourceRoot: string;
  readonly targetRoot: string;
  readonly hosts: readonly HostId[];
  readonly mode: RenderMode;
}

export interface RenderResult {
  readonly clean: boolean;
  readonly written: readonly string[];
  readonly changed: readonly string[];
  readonly missing: readonly string[];
  readonly deleted: readonly string[];
  readonly conflicts: readonly string[];
  readonly manifestPath: string;
}

const MANIFEST_PATH = ".hve/host-manifest.json";

export class RenderConflictError extends Error {
  public constructor(public readonly conflicts: readonly string[]) {
    super(`Generated artifact conflicts require operator resolution: ${conflicts.join(", ")}.`);
    this.name = "RenderConflictError";
  }
}

export async function planWorkspace(
  sourceRoot: string,
  hosts: readonly HostId[]
): Promise<{
  readonly outputs: readonly PlannedOutput[];
  readonly profiles: readonly HostProfile[];
}> {
  const root = resolve(sourceRoot);
  await assertSafeHostRoot(root, true);
  const catalog = await loadHostCatalog(root);
  const hostIds = normalizeHosts(hosts);
  const requestedProfiles = await Promise.all(hostIds.map((host) => loadHostProfile(root, host)));
  const supportedHostIds = hostIds.filter((host) => host !== "generic");
  const sharedProfile =
    supportedHostIds.length > 0
      ? (requestedProfiles.find((profile) => profile.hostId === "claude") ??
        (await loadHostProfile(root, "claude")))
      : null;
  const profiles =
    sharedProfile !== null && !requestedProfiles.some((profile) => profile.hostId === "claude")
      ? [...requestedProfiles, sharedProfile]
      : requestedProfiles;
  const outputs: PlannedOutput[] = [];

  if (
    sharedProfile?.agentDirectory !== null &&
    sharedProfile?.agentDirectory !== undefined &&
    sharedProfile.agentSuffix !== null
  ) {
    for (const agent of catalog.agents) {
      const source = await readSource(root, agent.source);
      const content = renderAgent(sharedProfile, agent, source.content, source.hash);
      outputs.push(
        output(
          agent.logicalId,
          "agent",
          `${sharedProfile.agentDirectory}/${agent.slug}${sharedProfile.agentSuffix}`,
          agent.source,
          source.hash,
          content,
          supportedHostIds
        )
      );
    }
  }

  for (const profile of requestedProfiles) {
    if (profile.ruleDirectory !== null && profile.ruleSuffix !== null) {
      for (const rule of catalog.rules) {
        const source = await readSource(root, rule.source);
        const content = renderRule(profile, rule, source.content, source.hash);
        outputs.push(
          output(
            rule.logicalId,
            "rule",
            `${profile.ruleDirectory}/${rule.slug}${profile.ruleSuffix}`,
            rule.source,
            source.hash,
            content,
            [profile.hostId]
          )
        );
      }
    }
  }

  for (const router of catalog.routers) {
    const source = await readSource(root, router.source);
    for (const profile of requestedProfiles) {
      const path = router.targets[profile.hostId];
      if (path === undefined) continue;
      outputs.push(
        output(
          router.logicalId,
          "router",
          path,
          router.source,
          source.hash,
          provenance(router.logicalId, router.source, source.hash) + source.content,
          [profile.hostId]
        )
      );
    }
  }

  const skillDirectory = supportedHostIds.length > 0 ? ".claude/skills" : ".agents/skills";
  if (requestedProfiles.some((profile) => profile.hostId === "generic")) {
    for (const skill of catalog.skills) {
      const source = await readSource(root, skill.source);
      outputs.push(
        output(
          skill.logicalId,
          "skill",
          `${skillDirectory}/${skill.name}/SKILL.md`,
          skill.source,
          source.hash,
          addProvenanceAfterFrontmatter(
            source.content,
            provenance(skill.logicalId, skill.source, source.hash)
          ),
          supportedHostIds.length > 0 ? supportedHostIds : ["generic"]
        )
      );
    }
  }

  outputs.sort((left, right) => left.path.localeCompare(right.path));
  assertUniqueOutputPaths(outputs);
  return { outputs, profiles };
}

export async function renderWorkspace(options: RenderOptions): Promise<RenderResult> {
  const sourceRoot = resolve(options.sourceRoot);
  const targetRoot = resolve(options.targetRoot);
  await assertSafeHostRoot(sourceRoot, true);
  await assertSafeHostRoot(targetRoot, false);
  const plan = await planWorkspace(sourceRoot, options.hosts);
  const outputs = await Promise.all(
    plan.outputs.map(async (item) => {
      const sourcePath = resolveHostPath(sourceRoot, item.sourcePath);
      const targetPath = resolveHostPath(targetRoot, item.path);
      if (sourcePath !== targetPath) return item;
      const content = (await readHostTextFile(sourceRoot, item.sourcePath)) as string;
      return { ...item, content, outputHash: sha256Hex(content) };
    })
  );
  const profiles = plan.profiles;
  const catalog = await loadHostCatalog(sourceRoot);
  const allowedOwnership = await buildAllowedOwnership(sourceRoot, catalog);
  const manifestPath = resolveHostPath(targetRoot, MANIFEST_PATH);
  const previous = await readManifest(targetRoot);
  const previousByPath = new Map(previous?.outputs.map((item) => [item.path, item]) ?? []);
  const changed: string[] = [];
  const missing: string[] = [];
  const conflicts: string[] = [];
  const writes: PlannedOutput[] = [];

  for (const planned of outputs) {
    const current = await readHostTextFile(targetRoot, planned.path, true);
    if (current === null) {
      missing.push(planned.path);
      writes.push(planned);
      continue;
    }
    const currentHash = sha256Hex(current);
    if (currentHash === planned.outputHash) continue;
    changed.push(planned.path);
    const prior = previousByPath.get(planned.path);
    if (prior === undefined || prior.outputHash !== currentHash) {
      conflicts.push(planned.path);
    } else {
      writes.push(planned);
    }
  }

  const expectedPaths = new Set(outputs.map((item) => item.path));
  const orphans =
    previous?.outputs.filter((item) => !expectedPaths.has(item.path)).map((item) => item.path) ??
    [];
  for (const path of orphans) {
    const current = await readHostTextFile(targetRoot, path, true);
    const prior = previousByPath.get(path);
    if (current !== null && prior !== undefined && sha256Hex(current) !== prior.outputHash) {
      conflicts.push(path);
    }
  }

  const retainedOutputs =
    options.mode === "write" && previous !== null
      ? previous.outputs.filter(
          (item) => !expectedPaths.has(item.path) && !conflicts.includes(item.path)
        )
      : [];
  const manifest = createManifest(catalog.rendererVersion, profiles, outputs, retainedOutputs);
  const manifestContent = `${canonicalizeValue({
    schemaVersion: manifest.schemaVersion,
    rendererVersion: manifest.rendererVersion,
    profileVersions: manifest.profileVersions,
    outputs: manifest.outputs.map((item) => ({
      logicalId: item.logicalId,
      kind: item.kind,
      path: item.path,
      sourcePath: item.sourcePath,
      sourceHash: item.sourceHash,
      outputHash: item.outputHash,
      hosts: item.hosts
    }))
  })}\n`;
  const manifestChanged =
    (await readHostTextFile(targetRoot, MANIFEST_PATH, true)) !== manifestContent;
  const clean =
    changed.length === 0 &&
    missing.length === 0 &&
    conflicts.length === 0 &&
    orphans.length === 0 &&
    !manifestChanged;
  if (options.mode === "check") {
    return {
      clean,
      written: [],
      changed,
      missing,
      deleted: [],
      conflicts,
      manifestPath
    };
  }
  if (conflicts.length > 0) throw new RenderConflictError([...new Set(conflicts)].sort());

  const written: string[] = [];
  for (const planned of writes) {
    await writeHostTextFileAtomic(targetRoot, planned.path, planned.content);
    written.push(planned.path);
  }
  const deleted: string[] = [];
  if (options.mode === "update") {
    for (const path of orphans) {
      const prior = previousByPath.get(path);
      if (prior === undefined) throw new Error(`Manifest ownership is missing for ${path}.`);
      const allowed = allowedOwnership.get(prior.path);
      if (
        allowed === undefined ||
        allowed.logicalId !== prior.logicalId ||
        allowed.sourcePath !== prior.sourcePath ||
        allowed.sourceHash !== prior.sourceHash ||
        allowed.outputHash !== prior.outputHash
      ) {
        throw new Error(`Manifest ownership is not authorized for ${path}.`);
      }
      await assertOwnedGeneratedHostFile(
        targetRoot,
        allowed.path,
        allowed.logicalId,
        allowed.sourcePath,
        allowed.sourceHash,
        allowed.outputHash
      );
      if (await removeHostFile(targetRoot, path)) deleted.push(path);
    }
  }
  await writeHostTextFileAtomic(targetRoot, MANIFEST_PATH, manifestContent);
  return {
    clean: true,
    written,
    changed,
    missing,
    deleted,
    conflicts: [],
    manifestPath
  };
}

function renderAgent(
  profile: HostProfile,
  item: AgentCatalogItem,
  body: string,
  sourceHash: string
): string {
  const header = ["---"];
  if (profile.hostId === "vscode") {
    header.push(
      `name: ${yamlString(item.name)}`,
      `description: ${yamlString(item.description)}`,
      `tools: [${item.tools.join(", ")}]`,
      `user-invocable: ${item.userInvocable}`
    );
  } else {
    const mappedTools = mapClaudeTools(item.tools);
    header.push(
      `name: ${item.slug}`,
      `description: ${yamlString(item.description)}`,
      `tools: ${mappedTools.join(", ")}`,
      "model: inherit"
    );
    if (!item.tools.includes("edit")) header.push("readonly: true");
  }
  header.push("---", "");
  return `${header.join("\n")}${provenance(item.logicalId, item.source, sourceHash)}${body}`;
}

function renderRule(
  profile: HostProfile,
  item: RuleCatalogItem,
  body: string,
  sourceHash: string
): string {
  const header = ["---", `description: ${yamlString(item.description)}`];
  if (profile.hostId === "vscode") header.push(`applyTo: ${yamlString(item.applyTo)}`);
  if (profile.hostId === "cursor") {
    header.push(`globs: ${yamlString(item.applyTo)}`, `alwaysApply: ${item.alwaysApply}`);
  }
  header.push("---", "");
  return `${header.join("\n")}${provenance(item.logicalId, item.source, sourceHash)}${body}`;
}

function output(
  logicalId: string,
  kind: PlannedOutput["kind"],
  path: string,
  sourcePath: string,
  sourceHash: string,
  content: string,
  hosts: readonly HostId[]
): PlannedOutput {
  const normalizedPath = normalizeHostRelativePath(path);
  return {
    logicalId,
    kind,
    path: normalizedPath,
    sourcePath,
    sourceHash,
    content,
    outputHash: sha256Hex(content),
    hosts
  };
}

function provenance(logicalId: string, sourcePath: string, sourceHash: string): string {
  return `<!-- Generated by HVE-Forge; logical-id: ${logicalId}; source: ${sourcePath}; source-sha256: ${sourceHash}; DO NOT EDIT. -->\n\n`;
}

function addProvenanceAfterFrontmatter(content: string, marker: string): string {
  if (!content.startsWith("---\n")) {
    throw new Error("Generated skill source must begin with YAML frontmatter.");
  }
  const closingMarker = "\n---\n";
  const closingIndex = content.indexOf(closingMarker, 4);
  if (closingIndex < 0) {
    throw new Error("Generated skill source must close its YAML frontmatter.");
  }
  const bodyIndex = closingIndex + closingMarker.length;
  return `${content.slice(0, bodyIndex)}${marker}${content.slice(bodyIndex)}`;
}

async function readSource(
  sourceRoot: string,
  relativePath: string
): Promise<{ readonly content: string; readonly hash: string }> {
  const source = (await readHostTextFile(sourceRoot, relativePath)) as string;
  const content = source.replaceAll("\r\n", "\n");
  return { content, hash: sha256Hex(content) };
}

function createManifest(
  rendererVersion: string,
  profiles: readonly HostProfile[],
  outputs: readonly PlannedOutput[],
  retainedOutputs: readonly ManifestOutput[] = []
): HostManifest {
  const profileVersions = Object.fromEntries(
    profiles.map((profile) => [profile.hostId, profile.profileVersion])
  );
  const manifestOutputs: ManifestOutput[] = [
    ...outputs.map(({ content: _content, ...item }) => item),
    ...retainedOutputs
  ].sort((left, right) => left.path.localeCompare(right.path));
  return {
    schemaVersion: "1.0",
    rendererVersion,
    profileVersions,
    outputs: manifestOutputs
  };
}

async function buildAllowedOwnership(
  sourceRoot: string,
  _catalog: Awaited<ReturnType<typeof loadHostCatalog>>
): Promise<ReadonlyMap<string, ManifestOutput>> {
  const [supported, generic] = await Promise.all([
    planWorkspace(sourceRoot, ["vscode", "cursor", "claude"]),
    planWorkspace(sourceRoot, ["generic"])
  ]);
  const allowed = new Map<string, ManifestOutput>();
  for (const { content: _content, ...item } of [...supported.outputs, ...generic.outputs]) {
    const existing = allowed.get(item.path);
    if (
      existing !== undefined &&
      (existing.logicalId !== item.logicalId ||
        existing.sourcePath !== item.sourcePath ||
        existing.sourceHash !== item.sourceHash ||
        existing.outputHash !== item.outputHash)
    ) {
      throw new Error(`Trusted host output definitions conflict for ${item.path}.`);
    }
    allowed.set(item.path, item);
  }
  return allowed;
}

async function readManifest(targetRoot: string): Promise<HostManifest | null> {
  const content = await readHostTextFile(targetRoot, MANIFEST_PATH, true);
  if (content === null) return null;
  if (Buffer.byteLength(content, "utf8") > 4 * 1_048_576) {
    throw new Error("Generated host manifest is oversized.");
  }
  const value = JSON.parse(content) as unknown;
  return parseManifest(value);
}

function parseManifest(value: unknown): HostManifest {
  const root = manifestObject(value, "manifest");
  manifestKeys(root, ["schemaVersion", "rendererVersion", "profileVersions", "outputs"]);
  if (root["schemaVersion"] !== "1.0") {
    throw new Error("Generated host manifest schema is unsupported.");
  }
  const rendererVersion = manifestString(root["rendererVersion"], "rendererVersion");
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(rendererVersion)) {
    throw new Error("Generated host manifest rendererVersion is invalid.");
  }
  const profileValue = manifestObject(root["profileVersions"], "profileVersions");
  const profileVersions: Record<string, string> = {};
  for (const [host, version] of Object.entries(profileValue)) {
    if (!["generic", "vscode", "cursor", "claude"].includes(host)) {
      throw new Error(`Generated host manifest profile is unknown: ${host}.`);
    }
    const parsedVersion = manifestString(version, `profileVersions.${host}`);
    if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(parsedVersion)) {
      throw new Error(`Generated host manifest profile version is invalid: ${host}.`);
    }
    profileVersions[host] = parsedVersion;
  }
  if (!Array.isArray(root["outputs"]) || root["outputs"].length > 10_000) {
    throw new Error("Generated host manifest outputs are invalid.");
  }
  const outputs = root["outputs"].map((item, index) => parseManifestOutput(item, index));
  if (new Set(outputs.map((item) => item.path)).size !== outputs.length) {
    throw new Error("Generated host manifest output paths must be unique.");
  }
  return { schemaVersion: "1.0", rendererVersion, profileVersions, outputs };
}

function parseManifestOutput(value: unknown, index: number): ManifestOutput {
  const item = manifestObject(value, `outputs[${index}]`);
  manifestKeys(item, [
    "logicalId",
    "kind",
    "path",
    "sourcePath",
    "sourceHash",
    "outputHash",
    "hosts"
  ]);
  const kind = manifestString(item["kind"], `outputs[${index}].kind`);
  if (!["agent", "rule", "router", "skill"].includes(kind)) {
    throw new Error(`Generated host manifest output kind is invalid: ${kind}.`);
  }
  if (!Array.isArray(item["hosts"]) || item["hosts"].length === 0) {
    throw new Error(`Generated host manifest hosts are invalid at index ${index}.`);
  }
  const hosts = item["hosts"].map((host) => {
    const value = manifestString(host, `outputs[${index}].hosts`);
    if (!["generic", "vscode", "cursor", "claude"].includes(value)) {
      throw new Error(`Generated host manifest output host is invalid: ${value}.`);
    }
    return value as HostId;
  });
  if (new Set(hosts).size !== hosts.length) {
    throw new Error(`Generated host manifest output hosts are duplicated at index ${index}.`);
  }
  const sourceHash = manifestHash(item["sourceHash"], `outputs[${index}].sourceHash`);
  const outputHash = manifestHash(item["outputHash"], `outputs[${index}].outputHash`);
  const logicalId = manifestString(item["logicalId"], `outputs[${index}].logicalId`);
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(logicalId)) {
    throw new Error(`Generated host manifest logical ID is invalid: ${logicalId}.`);
  }
  return {
    logicalId,
    kind: kind as ManifestOutput["kind"],
    path: normalizeHostRelativePath(manifestString(item["path"], `outputs[${index}].path`)),
    sourcePath: normalizeHostRelativePath(
      manifestString(item["sourcePath"], `outputs[${index}].sourcePath`)
    ),
    sourceHash,
    outputHash,
    hosts
  };
}

function manifestObject(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Generated host manifest ${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function manifestKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new Error(`Generated host manifest fields are invalid: ${required.join(", ")}.`);
  }
}

function manifestString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    throw new Error(`Generated host manifest ${name} is invalid.`);
  }
  return value;
}

function manifestHash(value: unknown, name: string): string {
  const hash = manifestString(value, name);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`Generated host manifest ${name} is invalid.`);
  return hash;
}

function assertUniqueOutputPaths(outputs: readonly PlannedOutput[]): void {
  const paths = new Set<string>();
  for (const item of outputs) {
    if (paths.has(item.path)) throw new Error(`Multiple catalog items render to ${item.path}.`);
    paths.add(item.path);
  }
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function mapClaudeTools(tools: readonly string[]): readonly string[] {
  const mapped = new Set<string>();
  for (const tool of tools) {
    for (const value of {
      read: ["Read"],
      edit: ["Edit", "Write"],
      search: ["Grep", "Glob"],
      execute: ["Bash", "PowerShell"],
      agent: ["Agent"],
      todo: ["TodoWrite"],
      web: ["WebFetch", "WebSearch"]
    }[tool] ?? []) {
      mapped.add(value);
    }
  }
  return [...mapped];
}
