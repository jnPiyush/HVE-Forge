import { lstat, readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { ActivatedSkill, SkillCatalog, SkillDescriptor } from "../application/contracts.js";
import { sha256Hex } from "../core/canonical-json.js";
import { assertNoLinks } from "./path-safety.js";

const MAXIMUM_SKILL_BYTES = 102_400;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

export async function inspectSkills(skillsRoot: string): Promise<readonly SkillDescriptor[]> {
  const root = resolve(skillsRoot);
  try {
    if (!(await lstat(root)).isDirectory()) return [];
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
  await assertNoLinks(root, root);
  const paths: string[] = [];
  await findSkills(root, root, paths);
  const descriptors = await Promise.all(paths.map((path) => inspectSkill(root, path)));
  return descriptors.sort((left, right) => left.name.localeCompare(right.name));
}

export async function activateSkill(skillsRoot: string, name: string): Promise<ActivatedSkill> {
  if (!SKILL_NAME.test(name)) throw new Error("Skill name must be lowercase kebab-case.");
  const skills = await inspectSkills(skillsRoot);
  const descriptor = skills.find((skill) => skill.name === name);
  if (descriptor === undefined) throw new Error(`Skill was not found: ${name}.`);
  const path = resolve(skillsRoot, ...descriptor.relativePath.split("/"));
  return { descriptor, instructions: decode(await readFile(path), path) };
}

async function findSkills(root: string, directory: string, paths: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) throw new Error(`Skill path contains a link: ${path}.`);
    if (metadata.isDirectory()) await findSkills(root, path, paths);
    if (metadata.isFile() && entry.name === "SKILL.md") paths.push(path);
  }
}

async function inspectSkill(root: string, path: string): Promise<SkillDescriptor> {
  await assertNoLinks(root, path);
  const bytes = await readFile(path);
  if (bytes.byteLength > MAXIMUM_SKILL_BYTES) {
    throw new Error(`Skill file exceeds ${MAXIMUM_SKILL_BYTES} bytes: ${path}.`);
  }
  const content = decode(bytes, path);
  const frontmatter = parseFrontmatter(content, path);
  const name = required(frontmatter, "name", path);
  const description = required(frontmatter, "description", path);
  if (!SKILL_NAME.test(name) || name !== dirname(path).split(sep).at(-1)) {
    throw new Error(`Skill name must match its kebab-case directory: ${path}.`);
  }
  if (description.length < 50) throw new Error(`Skill description is too short: ${path}.`);
  validateReferences(root, dirname(path), content);
  return {
    name,
    description,
    relativePath: relative(root, path).split(sep).join("/"),
    contentHash: sha256Hex(bytes),
    byteLength: bytes.byteLength,
    provenance: "repository",
    license: frontmatter.get("license") ?? null,
    compatibility: frontmatter.get("compatibility") ?? null,
    allowedTools: frontmatter.get("allowed-tools") ?? null,
    allowedToolsExperimental: frontmatter.has("allowed-tools")
  };
}

function parseFrontmatter(content: string, path: string): Map<string, string> {
  const lines = content.replaceAll("\r\n", "\n").split("\n");
  if (lines[0] !== "---") throw new Error(`Skill is missing YAML frontmatter: ${path}.`);
  const end = lines.indexOf("---", 1);
  if (end < 2) throw new Error(`Skill frontmatter is not terminated: ${path}.`);
  const values = new Map<string, string>();
  for (let index = 1; index < end; index += 1) {
    const line = lines[index] as string;
    if (line.includes("\t")) {
      throw new Error(`Tabs are not allowed in skill frontmatter line ${index + 1}: ${path}.`);
    }
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (leadingSpaces(line) > 0) continue;
    const match = /^([A-Za-z0-9-]+):(?:\s*(.*))?$/u.exec(line);
    if (match?.[1] === undefined) {
      throw new Error(`Invalid skill frontmatter line ${index + 1}: ${path}.`);
    }
    const key = match[1];
    if (values.has(key)) throw new Error(`Duplicate skill frontmatter key ${key}: ${path}.`);
    const rawValue = match[2] ?? "";
    if (/^[>|][+-]?$/u.test(rawValue)) {
      const block = readIndentedBlock(lines, index + 1, end);
      values.set(key, rawValue.startsWith(">") ? foldBlock(block.lines) : block.lines.join("\n"));
      index = block.nextIndex - 1;
      continue;
    }
    if (rawValue === "" && key === "allowed-tools") {
      const block = readIndentedBlock(lines, index + 1, end);
      const tools = block.lines
        .map((item) => /^-\s+(.+)$/u.exec(item)?.[1])
        .filter((item): item is string => item !== undefined)
        .map(parseScalar);
      values.set(key, tools.join(", "));
      index = block.nextIndex - 1;
      continue;
    }
    const value = rawValue === "" ? "" : parseScalar(rawValue);
    values.set(key, value);
  }
  return values;
}

function readIndentedBlock(
  lines: readonly string[],
  startIndex: number,
  endIndex: number
): { readonly lines: readonly string[]; readonly nextIndex: number } {
  const raw: string[] = [];
  let index = startIndex;
  while (index < endIndex) {
    const line = lines[index] as string;
    if (line.trim() !== "" && leadingSpaces(line) === 0) break;
    raw.push(line);
    index += 1;
  }
  const indents = raw.filter((line) => line.trim() !== "").map(leadingSpaces);
  const indentation = indents.length === 0 ? 0 : Math.min(...indents);
  const normalized = raw.map((line) => (line.trim() === "" ? "" : line.slice(indentation)));
  while (normalized.at(-1) === "") normalized.pop();
  return { lines: normalized, nextIndex: index };
}

function foldBlock(lines: readonly string[]): string {
  return lines.join("\n").replace(/([^\n])\n(?=[^\n])/gu, "$1 ");
}

function parseScalar(rawValue: string): string {
  const value = rawValue.trim();
  if (value.startsWith('"')) {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "string") throw new Error("Quoted skill metadata must be a string.");
    return parsed;
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) {
      throw new Error("Single-quoted skill metadata is not terminated.");
    }
    return value.slice(1, -1).replaceAll("''", "'");
  }
  const comment = value.indexOf(" #");
  return (comment < 0 ? value : value.slice(0, comment)).trimEnd();
}

function leadingSpaces(value: string): number {
  return /^ */u.exec(value)?.[0].length ?? 0;
}

function validateReferences(root: string, directory: string, content: string): void {
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1]?.split("#")[0];
    if (target === undefined || target === "" || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) continue;
    const resolved = resolve(directory, decodeURIComponent(target));
    const fromRoot = relative(root, resolved);
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
      throw new Error(`Skill reference escapes the skills root: ${target}.`);
    }
  }
}

function required(values: ReadonlyMap<string, string>, key: string, path: string): string {
  const value = values.get(key);
  if (value === undefined || value.trim() === "") {
    throw new Error(`Skill frontmatter field ${key} is required: ${path}.`);
  }
  return value;
}

function decode(bytes: Uint8Array, path: string): string {
  try {
    return STRICT_UTF8.decode(bytes);
  } catch (error) {
    throw new Error(`Skill file is not valid UTF-8: ${path}.`, { cause: error });
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export class AgentSkillCatalog implements SkillCatalog {
  public inspect(skillsRoot: string): Promise<readonly SkillDescriptor[]> {
    return inspectSkills(skillsRoot);
  }

  public activate(skillsRoot: string, name: string): Promise<ActivatedSkill> {
    return activateSkill(skillsRoot, name);
  }
}
