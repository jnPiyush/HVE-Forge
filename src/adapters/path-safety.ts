import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";

export type PathSafetyErrorCode =
  | "InvalidPath"
  | "Traversal"
  | "OutsideWorkspace"
  | "ReparsePoint"
  | "NotFound"
  | "NotRegularFile";

const WINDOWS_INVALID = /[<>"|?*]/;
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export class PathSafetyError extends Error {
  public constructor(
    public readonly code: PathSafetyErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "PathSafetyError";
  }
}

export function validateRelativePath(value: string): void {
  if (
    value.trim() === "" ||
    isAbsolute(value) ||
    win32.isAbsolute(value) ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.includes(":") ||
    WINDOWS_INVALID.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 0x20)
  ) {
    throw new PathSafetyError("InvalidPath", "Only safe relative workspace paths are allowed.");
  }
  const segments = value.split(/[\\/]/);
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        segment.endsWith(".") ||
        segment.endsWith(" ") ||
        WINDOWS_DEVICE.test(segment)
    )
  ) {
    throw new PathSafetyError("Traversal", "Path contains unsafe or traversal segments.");
  }
}

export async function resolveExistingRegularFile(
  workspaceRoot: string,
  relativePath: string
): Promise<string> {
  if (workspaceRoot.trim() === "") throw new TypeError("workspaceRoot is required.");
  validateRelativePath(relativePath);
  const root = resolve(workspaceRoot);
  await assertNoLinks(root, root);
  const candidate = resolve(root, ...relativePath.split(/[\\/]/));
  const fromRoot = relative(root, candidate);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new PathSafetyError("OutsideWorkspace", "Path escapes the workspace boundary.");
  }
  await assertNoLinks(root, candidate);
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(candidate);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new PathSafetyError("NotFound", "Target file does not exist.", { cause: error });
    }
    throw error;
  }
  if (metadata.isSymbolicLink()) {
    throw new PathSafetyError("ReparsePoint", "Symbolic-link targets are not allowed.");
  }
  if (!metadata.isFile()) {
    throw new PathSafetyError("NotRegularFile", "Target must be a regular file.");
  }
  return candidate;
}

export async function assertNoLinks(root: string, candidate: string): Promise<void> {
  const canonicalRoot = resolve(root);
  const canonicalCandidate = resolve(candidate);
  const fromRoot = relative(canonicalRoot, canonicalCandidate);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new PathSafetyError("OutsideWorkspace", "Path escapes the workspace boundary.");
  }
  await assertNoLinksInAbsolutePath(canonicalRoot);
  const segments = fromRoot === "" ? [] : fromRoot.split(sep);
  let current = canonicalRoot;
  for (const segment of segments) {
    current = resolve(current, segment);
    await rejectLinkIfPresent(current);
  }
}

export async function assertNoLinksInAbsolutePath(path: string): Promise<void> {
  const chain: string[] = [];
  let current = resolve(path);
  while (true) {
    chain.push(current);
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  chain.reverse();
  for (const candidate of chain) await rejectLinkIfPresent(candidate);
}

export async function readConfinedRegularFile(
  root: string,
  relativePath: string,
  maximumBytes = 1_048_576
): Promise<Buffer> {
  const path = await resolveExistingRegularFile(root, relativePath);
  return readRegularFileNoLinks(path, maximumBytes);
}

export async function readRegularFileNoLinks(
  path: string,
  maximumBytes = 1_048_576
): Promise<Buffer> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new RangeError("maximumBytes must be a positive safe integer.");
  }
  const target = resolve(path);
  await assertNoLinksInAbsolutePath(target);
  const metadata = await lstat(target);
  if (!metadata.isFile()) {
    throw new PathSafetyError("NotRegularFile", "Trusted input must be a regular file.");
  }
  if (metadata.size > maximumBytes) {
    throw new PathSafetyError("InvalidPath", "Trusted input exceeds its byte limit.");
  }
  await assertNoLinksInAbsolutePath(target);
  const content = await readFile(target);
  if (content.byteLength > maximumBytes) {
    throw new PathSafetyError("InvalidPath", "Trusted input exceeds its byte limit.");
  }
  return content;
}

async function rejectLinkIfPresent(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new PathSafetyError("ReparsePoint", "Links and reparse points are not allowed.");
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
