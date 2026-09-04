import { cp, lstat, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { canonicalizeValue, sha256Hex } from "../core/canonical-json.js";
import { assertNoLinks, assertNoLinksInAbsolutePath, PathSafetyError } from "./path-safety.js";

export const CONTROL_DIRECTORY = ".hve-control";

export interface PreparedWorkspace {
  readonly workspaceRoot: string;
  readonly sourceRoot: string;
  readonly sourceFixtureHash: string;
}

export async function prepareWorkspace(
  sourceFixturePath: string,
  runRoot: string
): Promise<PreparedWorkspace> {
  const source = resolve(sourceFixturePath);
  const destination = resolve(runRoot);
  await assertNoLinksInAbsolutePath(source);
  await assertNoLinksInAbsolutePath(destination);
  const sourceMetadata = await stat(source);
  if (!sourceMetadata.isDirectory())
    throw new Error(`Source fixture is not a directory: ${source}.`);
  if (pathsOverlap(source, destination)) {
    throw new Error("Source fixture and run root must not contain one another.");
  }
  try {
    await lstat(destination);
    throw new Error(`Run root already exists: ${destination}.`);
  } catch (error) {
    if (!(isNodeError(error) && error.code === "ENOENT")) throw error;
  }
  await assertNoLinks(source, source);
  const sourceFixtureHash = await computeTreeHash(source);
  const sourceRoot = join(destination, "source");
  const workspaceRoot = join(destination, "workspace");
  try {
    await mkdir(join(destination, "state"), { recursive: true });
    await copyDirectory(source, sourceRoot);
    await copyDirectory(source, workspaceRoot);
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
  return { workspaceRoot, sourceRoot, sourceFixtureHash };
}

export async function computeTreeHash(rootPath: string): Promise<string> {
  const root = resolve(rootPath);
  const metadata = await stat(root);
  if (!metadata.isDirectory()) throw new Error(`Manifest root is not a directory: ${root}.`);
  await assertNoLinks(root, root);
  const entries: { path: string; sha256: string }[] = [];
  await visit(root, root, entries);
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return sha256Hex(canonicalizeValue(entries));
}

export async function assertTreeUnchanged(rootPath: string, expectedHash: string): Promise<void> {
  const actual = await computeTreeHash(rootPath);
  if (actual !== expectedHash) throw new Error("A protected manifest root changed during the run.");
}

export async function writeFileAtomic(
  targetPath: string,
  content: string | Uint8Array
): Promise<void> {
  const target = resolve(targetPath);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.hve-tmp`;
  try {
    const handle = await import("node:fs/promises").then(({ open }) => open(temporary, "wx"));
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function visit(
  root: string,
  directory: string,
  entries: { path: string; sha256: string }[]
): Promise<void> {
  const children = await readdir(directory, { withFileTypes: true });
  children.sort((left, right) => left.name.localeCompare(right.name));
  for (const child of children) {
    const path = join(directory, child.name);
    const relativePath = relative(root, path).split(sep).join("/");
    if (relativePath === CONTROL_DIRECTORY || relativePath.startsWith(`${CONTROL_DIRECTORY}/`)) {
      continue;
    }
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      throw new PathSafetyError("ReparsePoint", `Manifest includes a link: ${relativePath}.`);
    }
    if (metadata.isDirectory()) {
      await visit(root, path, entries);
    } else if (metadata.isFile()) {
      entries.push({ path: relativePath, sha256: sha256Hex(await readFile(path)) });
    } else {
      throw new PathSafetyError(
        "NotRegularFile",
        `Manifest includes an unsupported file type: ${relativePath}.`
      );
    }
  }
}

async function copyDirectory(source: string, destination: string): Promise<void> {
  await cp(source, destination, {
    recursive: true,
    errorOnExist: true,
    force: false,
    verbatimSymlinks: true,
    filter: async (path) => {
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) {
        throw new PathSafetyError("ReparsePoint", "Source fixture contains a link.");
      }
      return true;
    }
  });
}

function pathsOverlap(left: string, right: string): boolean {
  const fromLeft = relative(left, right);
  const fromRight = relative(right, left);
  // On Windows, path.relative() between paths on different drives (for example the repository
  // checkout on D: and the OS temp directory on C:, as GitHub Actions' hosted Windows runners are
  // commonly configured) returns the second argument unchanged instead of throwing, because no
  // relative path between the two roots exists. That unchanged absolute path never starts with
  // ".." and would otherwise be misread as one path containing the other; paths on different
  // roots can never overlap.
  if (isAbsolute(fromLeft) || isAbsolute(fromRight)) return false;
  return (
    fromLeft === "" ||
    (!fromLeft.startsWith(`..${sep}`) && fromLeft !== "..") ||
    (!fromRight.startsWith(`..${sep}`) && fromRight !== "..")
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
