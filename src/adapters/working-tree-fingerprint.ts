import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { canonicalizeValue, sha256Hex } from "../core/canonical-json.js";
import { assertNoLinks } from "./path-safety.js";

/**
 * Fixed, code-owned exclusions for the working-tree fingerprint (SPEC-004 section 5.1).
 * Workspace instructions and repository configuration cannot add to or remove from this list;
 * it is a constant, not a policy input, so untrusted content can never widen what counts as
 * "unchanged".
 */
export const FIXED_FINGERPRINT_EXCLUSIONS: ReadonlySet<string> = new Set([
  ".git",
  ".hve",
  ".hve-control",
  "node_modules",
  "dist",
  "coverage",
  "coverage-merged",
  "artifacts"
]);

const DEFAULT_MAXIMUM_FILES = 50_000;

export class FingerprintError extends Error {
  public constructor(
    public readonly code: "BOUND_EXCEEDED" | "REPARSE_POINT" | "UNSUPPORTED_ENTRY",
    message: string
  ) {
    super(message);
    this.name = "FingerprintError";
  }
}

export interface WorkingTreeFingerprint {
  readonly fingerprint: string;
  readonly fileCount: number;
}

export interface FingerprintOptions {
  readonly maximumFiles?: number;
}

/**
 * Fully rehashes every relevant regular file under `rootPath`, tracked or untracked, skipping
 * only the fixed exclusions above. Fails closed -- throws rather than silently truncating -- if
 * the bounded file-count inventory is exceeded or a link/device/unsupported entry is found,
 * because a partial hash would be worse than no hash: it would look valid.
 */
export async function computeWorkingTreeFingerprint(
  rootPath: string,
  options: FingerprintOptions = {}
): Promise<WorkingTreeFingerprint> {
  const maximumFiles = options.maximumFiles ?? DEFAULT_MAXIMUM_FILES;
  if (!Number.isSafeInteger(maximumFiles) || maximumFiles < 1) {
    throw new RangeError("maximumFiles must be a positive safe integer.");
  }
  const root = resolve(rootPath);
  await assertNoLinks(root, root);
  const entries: { path: string; sha256: string }[] = [];
  await visit(root, root, entries, maximumFiles);
  entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return {
    fingerprint: sha256Hex(canonicalizeValue(entries)),
    fileCount: entries.length
  };
}

/** Convenience form matching a plain `(root: string) => Promise<string>` hash port. */
export async function computeWorkingTreeHash(
  rootPath: string,
  options: FingerprintOptions = {}
): Promise<string> {
  return (await computeWorkingTreeFingerprint(rootPath, options)).fingerprint;
}

async function visit(
  root: string,
  directory: string,
  entries: { path: string; sha256: string }[],
  maximumFiles: number
): Promise<void> {
  const children = await readdir(directory, { withFileTypes: true });
  children.sort((left, right) => left.name.localeCompare(right.name));
  for (const child of children) {
    if (FIXED_FINGERPRINT_EXCLUSIONS.has(child.name)) continue;
    const path = join(directory, child.name);
    const relativePath = relative(root, path).split(sep).join("/");
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      throw new FingerprintError(
        "REPARSE_POINT",
        `Working tree includes a link, which is excluded from fingerprinting: ${relativePath}.`
      );
    }
    if (metadata.isDirectory()) {
      await visit(root, path, entries, maximumFiles);
    } else if (metadata.isFile()) {
      if (entries.length >= maximumFiles) {
        throw new FingerprintError(
          "BOUND_EXCEEDED",
          `Working tree exceeds the bounded fingerprint inventory of ${maximumFiles} files.`
        );
      }
      entries.push({ path: relativePath, sha256: sha256Hex(await readFile(path)) });
    } else {
      throw new FingerprintError(
        "UNSUPPORTED_ENTRY",
        `Working tree includes an unsupported entry type: ${relativePath}.`
      );
    }
  }
}
