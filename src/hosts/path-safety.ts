import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export class HostPathSafetyError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HostPathSafetyError";
  }
}

export function normalizeHostRelativePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/$/u, "");
  if (
    normalized.startsWith("/") ||
    path.includes("\\") ||
    normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new HostPathSafetyError(`Host path must be a normalized relative path: ${path}.`);
  }
  return normalized;
}

export function resolveHostPath(root: string, relativePath: string): string {
  const normalized = normalizeHostRelativePath(relativePath);
  const rootPath = resolve(root);
  const target = resolve(rootPath, ...normalized.split("/"));
  const fromRoot = relative(rootPath, target);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new HostPathSafetyError(`Host path escapes its root: ${relativePath}.`);
  }
  return target;
}

export async function assertSafeHostRoot(root: string, mustExist: boolean): Promise<void> {
  const rootPath = resolve(root);
  await assertNoLinksInPath(rootPath);
  const metadata = await lstatOptional(rootPath);
  if (metadata === null) {
    if (mustExist) throw new HostPathSafetyError(`Host root does not exist: ${rootPath}.`);
    return;
  }
  if (!metadata.isDirectory()) {
    throw new HostPathSafetyError(`Host root must be a directory: ${rootPath}.`);
  }
}

export async function assertNoLinksInPath(path: string): Promise<void> {
  const chain: string[] = [];
  let current = resolve(path);
  while (true) {
    chain.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  chain.reverse();
  for (let index = 0; index < chain.length; index += 1) {
    const candidate = chain[index] as string;
    const metadata = await lstatOptional(candidate);
    if (metadata === null) continue;
    if (metadata.isSymbolicLink()) {
      throw new HostPathSafetyError(`Host path contains a link or reparse point: ${candidate}.`);
    }
    if (index < chain.length - 1 && !metadata.isDirectory()) {
      throw new HostPathSafetyError(`Host path ancestor is not a directory: ${candidate}.`);
    }
  }
}

export async function readHostTextFile(
  root: string,
  relativePath: string,
  optional = false
): Promise<string | null> {
  const target = resolveHostPath(root, relativePath);
  await assertNoLinksInPath(target);
  const metadata = await lstatOptional(target);
  if (metadata === null) {
    if (optional) return null;
    throw new HostPathSafetyError(`Host file does not exist: ${relativePath}.`);
  }
  if (!metadata.isFile())
    throw new HostPathSafetyError(`Host path is not a file: ${relativePath}.`);
  await assertNoLinksInPath(target);
  const content = await readFile(target, "utf8");
  // Every generated host artifact is written with LF line endings (writeHostTextFileAtomic never
  // emits `\r`), but a checked-out working copy can still contain CRLF: git's autocrlf conversion
  // on checkout is a per-machine/per-runner setting, not a property of the LF-normalized blob this
  // repository stores. Normalizing here keeps content identity (and therefore hash comparisons
  // used for conflict detection) independent of that checkout-time behavior.
  return content.replaceAll("\r\n", "\n");
}

export async function writeHostTextFileAtomic(
  root: string,
  relativePath: string,
  content: string
): Promise<void> {
  const target = resolveHostPath(root, relativePath);
  const parent = dirname(target);
  await assertSafeHostRoot(root, false);
  await assertNoLinksInPath(target);
  await mkdir(parent, { recursive: true });
  await assertNoLinksInPath(parent);
  const existing = await lstatOptional(target);
  if (existing !== null && !existing.isFile()) {
    throw new HostPathSafetyError(`Host output is not a regular file: ${relativePath}.`);
  }
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertNoLinksInPath(parent);
    await assertNoLinksInPath(temporary);
    await assertNoLinksInPath(target);
    await rename(temporary, target);
    await assertNoLinksInPath(target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function removeHostFile(root: string, relativePath: string): Promise<boolean> {
  const target = resolveHostPath(root, relativePath);
  await assertSafeHostRoot(root, true);
  await assertNoLinksInPath(target);
  const metadata = await lstatOptional(target);
  if (metadata === null) return false;
  if (!metadata.isFile()) {
    throw new HostPathSafetyError(`Obsolete host output is not a regular file: ${relativePath}.`);
  }
  await assertNoLinksInPath(target);
  await rm(target);
  return true;
}

export async function assertOwnedGeneratedHostFile(
  root: string,
  relativePath: string,
  logicalId: string,
  sourcePath: string,
  sourceHash: string,
  outputHash: string
): Promise<void> {
  const content = await readHostTextFile(root, relativePath);
  if (content === null || sha256(content) !== outputHash) {
    throw new HostPathSafetyError(`Obsolete host output hash is invalid: ${relativePath}.`);
  }
  const marker = `<!-- Generated by HVE-Forge; logical-id: ${logicalId}; source: ${sourcePath}; source-sha256: ${sourceHash}; DO NOT EDIT. -->`;
  if (!content.includes(marker)) {
    throw new HostPathSafetyError(`Obsolete host output lacks valid provenance: ${relativePath}.`);
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
