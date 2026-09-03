import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256Hex } from "../core/canonical-json.js";
import { assertNoLinks, assertNoLinksInAbsolutePath } from "./path-safety.js";
import { inspectSkills } from "./skills.js";
import { createStoreZip } from "./zip.js";

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const COLOR_ICON_SIZE = 192;
const OUTLINE_ICON_SIZE = 32;

export class CoworkPackageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CoworkPackageError";
  }
}

export interface CoworkManifest {
  readonly manifestVersion: "v2.2";
  readonly id: string;
  readonly version: string;
  readonly developer: { readonly name: string };
  readonly name: string;
  readonly description: string;
  readonly icons: { readonly color: string; readonly outline: string };
  readonly agentSkills: readonly { readonly file: string }[];
}

export interface CoworkPackageOptions {
  readonly skillsRoot: string;
  readonly colorIconPath: string;
  readonly outlineIconPath: string;
  readonly id?: string;
  readonly version?: string;
  readonly developerName?: string;
  readonly name?: string;
  readonly description?: string;
}

export interface CoworkPackageResult {
  readonly manifest: CoworkManifest;
  readonly archive: Uint8Array;
  readonly includedSkills: readonly string[];
  readonly excludedSkills: readonly { readonly name: string; readonly reason: string }[];
}

/** Deterministic, stable package identity so repeated renders never drift. */
const DEFAULT_PACKAGE_ID = formatAsGuid(sha256Hex("urn:hve-forge:cowork-plugin"));

/**
 * Builds an installable Cowork plugin package (manifest + icons + eligible skills) from the
 * canonical `hve/skills/` catalog. Cowork is a package render target, not a discovery root: it
 * has no scan paths, no agents directory, and no rules directory, so this does not go through
 * the host renderer. A skill is included only when its frontmatter declares
 * `cowork-eligible: true`; every other skill is excluded (never rendered in a degraded form)
 * because Cowork's managed container has no terminal and cannot install packages.
 */
export async function buildCoworkPackage(
  options: CoworkPackageOptions
): Promise<CoworkPackageResult> {
  const id = requireGuid(options.id ?? DEFAULT_PACKAGE_ID);
  const version = requireSemver(options.version ?? "0.2.0");
  const developerName = requireNonEmpty(options.developerName ?? "HVE-Forge", "developer name");
  const name = requireNonEmpty(options.name ?? "HVE-Forge", "package name");
  const description = requireNonEmpty(
    options.description ??
      "Deterministic, policy-approved bounded coding-task skills from the HVE-Forge harness.",
    "package description"
  );

  await Promise.all([
    assertNoLinksInAbsolutePath(options.skillsRoot),
    assertNoLinksInAbsolutePath(options.colorIconPath),
    assertNoLinksInAbsolutePath(options.outlineIconPath)
  ]);
  const [colorIcon, outlineIcon] = await Promise.all([
    readPngIcon(options.colorIconPath, COLOR_ICON_SIZE),
    readPngIcon(options.outlineIconPath, OUTLINE_ICON_SIZE)
  ]);

  const descriptors = await inspectSkills(options.skillsRoot);
  const includedSkills: string[] = [];
  const excludedSkills: { name: string; reason: string }[] = [];
  const agentSkills: { file: string }[] = [];
  const entries: { path: string; content: Uint8Array }[] = [
    { path: "color.png", content: colorIcon },
    { path: "outline.png", content: outlineIcon }
  ];

  for (const descriptor of descriptors) {
    if (!KEBAB_CASE.test(descriptor.name)) {
      throw new CoworkPackageError(`Skill name must be lowercase kebab-case: ${descriptor.name}.`);
    }
    const absolutePath = join(options.skillsRoot, ...descriptor.relativePath.split("/"));
    await assertNoLinks(options.skillsRoot, absolutePath);
    const bytes = await readFile(absolutePath);
    if (!isCoworkEligible(bytes)) {
      excludedSkills.push({
        name: descriptor.name,
        reason: "Skill is not marked cowork-eligible: true; it assumes host execution."
      });
      continue;
    }
    const archivePath = `skills/${descriptor.name}/SKILL.md`;
    entries.push({ path: archivePath, content: bytes });
    agentSkills.push({ file: archivePath });
    includedSkills.push(descriptor.name);
  }

  if (agentSkills.length === 0) {
    throw new CoworkPackageError(
      "No cowork-eligible skill was found; a package must declare at least one skill."
    );
  }

  const manifest: CoworkManifest = {
    manifestVersion: "v2.2",
    id,
    version,
    developer: { name: developerName },
    name,
    description,
    icons: { color: "color.png", outline: "outline.png" },
    agentSkills: sortByFile(agentSkills)
  };
  validateCoworkManifest(manifest);
  entries.push({
    path: "manifest.json",
    content: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  });
  entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

  return {
    manifest,
    archive: createStoreZip(entries),
    includedSkills: includedSkills.sort((left, right) => left.localeCompare(right)),
    excludedSkills: excludedSkills.sort((left, right) => left.name.localeCompare(right.name))
  };
}

/** Strictly validates a manifest object against the supported Cowork schema; no extra fields. */
export function validateCoworkManifest(value: unknown): CoworkManifest {
  const root = requireObject(value, "manifest");
  const expected = new Set([
    "manifestVersion",
    "id",
    "version",
    "developer",
    "name",
    "description",
    "icons",
    "agentSkills"
  ]);
  for (const key of Object.keys(root)) {
    if (!expected.delete(key)) throw new CoworkPackageError(`Unexpected manifest field: ${key}.`);
  }
  if (expected.size > 0) {
    throw new CoworkPackageError(`Manifest is missing fields: ${[...expected].sort().join(", ")}.`);
  }
  if (root["manifestVersion"] !== "v2.2") {
    throw new CoworkPackageError("manifest.manifestVersion must be v2.2.");
  }
  const id = requireGuid(root["id"]);
  const version = requireSemver(root["version"]);
  const developer = requireObject(root["developer"], "developer");
  if (Object.keys(developer).join("|") !== "name") {
    throw new CoworkPackageError("manifest.developer must contain only name.");
  }
  const developerName = requireNonEmpty(developer["name"], "developer name");
  const name = requireNonEmpty(root["name"], "name");
  const description = requireNonEmpty(root["description"], "description");
  const icons = requireObject(root["icons"], "icons");
  if (Object.keys(icons).sort().join("|") !== "color|outline") {
    throw new CoworkPackageError("manifest.icons must contain exactly color and outline.");
  }
  const color = requireNonEmpty(icons["color"], "icons.color");
  const outline = requireNonEmpty(icons["outline"], "icons.outline");
  const agentSkillsValue = root["agentSkills"];
  if (!Array.isArray(agentSkillsValue) || agentSkillsValue.length === 0) {
    throw new CoworkPackageError("manifest.agentSkills must be a non-empty array.");
  }
  const agentSkills = agentSkillsValue.map((entry) => {
    const entryObject = requireObject(entry, "agentSkills[]");
    if (Object.keys(entryObject).join("|") !== "file") {
      throw new CoworkPackageError("Each agentSkills entry must contain only file.");
    }
    const file = requireNonEmpty(entryObject["file"], "agentSkills[].file");
    if (!/^skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/SKILL\.md$/.test(file)) {
      throw new CoworkPackageError(`agentSkills[].file has an invalid path: ${file}.`);
    }
    return { file };
  });
  if (new Set(agentSkills.map((entry) => entry.file)).size !== agentSkills.length) {
    throw new CoworkPackageError("manifest.agentSkills entries must be unique.");
  }
  return {
    manifestVersion: "v2.2",
    id,
    version,
    developer: { name: developerName },
    name,
    description,
    icons: { color, outline },
    agentSkills
  };
}

function isCoworkEligible(bytes: Uint8Array): boolean {
  const text = Buffer.from(bytes).toString("utf8");
  const end = text.indexOf("\n---", 3);
  const frontmatter = end < 0 ? text : text.slice(0, end);
  return /^cowork-eligible:\s*true\s*$/m.test(frontmatter);
}

async function readPngIcon(path: string, requiredSize: number): Promise<Uint8Array> {
  const bytes = await readFile(path);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new CoworkPackageError(`Icon is not a valid PNG file: ${path}.`);
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== requiredSize || height !== requiredSize) {
    throw new CoworkPackageError(
      `Icon ${path} must be exactly ${requiredSize}x${requiredSize} pixels; observed ${width}x${height}.`
    );
  }
  return bytes;
}

function sortByFile(entries: readonly { file: string }[]): readonly { file: string }[] {
  return [...entries].sort((left, right) =>
    left.file < right.file ? -1 : left.file > right.file ? 1 : 0
  );
}

function formatAsGuid(hash: string): string {
  const hex = hash.slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function requireGuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new CoworkPackageError("Package id must be a GUID.");
  }
  return value.toLowerCase();
}

function requireSemver(value: unknown): string {
  if (typeof value !== "string" || !SEMVER.test(value)) {
    throw new CoworkPackageError("Package version must be major.minor.patch.");
  }
  return value;
}

function requireNonEmpty(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CoworkPackageError(`${name} must be a non-empty string.`);
  }
  return value;
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CoworkPackageError(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}
