import { lstat, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type {
  InstructionSelection,
  InstructionSelector,
  InstructionSource
} from "../application/contracts.js";
import { sha256Hex } from "../core/canonical-json.js";
import { assertNoLinks, resolveExistingRegularFile } from "./path-safety.js";

const MAXIMUM_INSTRUCTION_BYTES = 65_536;
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

export async function selectInstructions(
  workspaceRoot: string,
  targetRelativePath: string
): Promise<InstructionSelection> {
  const root = resolve(workspaceRoot);
  const target = await resolveExistingRegularFile(root, targetRelativePath);
  let current: string | null = dirname(target);
  const sources: { source: InstructionSource; content: string }[] = [];
  while (current !== null && isWithin(root, current)) {
    const candidate = join(current, "AGENTS.md");
    try {
      const metadata = await lstat(candidate);
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new Error("Scoped instruction must be a regular file without links.");
      }
      await assertNoLinks(root, candidate);
      if (metadata.size > MAXIMUM_INSTRUCTION_BYTES) {
        throw new Error("Scoped instruction file exceeds 64 KiB.");
      }
      const bytes = await readFile(candidate);
      const content = decode(bytes);
      const relativePath = relative(root, candidate).split(sep).join("/");
      const scopePath = relative(root, current).split(sep).join("/");
      sources.push({
        source: {
          relativePath,
          scope: scopePath === "" ? "/" : `${scopePath}/`,
          precedence: sources.length,
          contentHash: sha256Hex(bytes),
          byteLength: bytes.byteLength,
          trust: "repository"
        },
        content
      });
    } catch (error) {
      if (!(isNodeError(error) && error.code === "ENOENT")) throw error;
    }
    if (current === root) break;
    const parent = dirname(current);
    current = parent === current ? null : parent;
  }
  if (sources.length === 0) {
    return {
      relativePath: null,
      contentHash: sha256Hex(new Uint8Array()),
      byteLength: 0,
      content: "",
      sources: [],
      conflicts: []
    };
  }
  const effective = sources[0];
  if (effective === undefined) throw new Error("Instruction selection failed.");
  return {
    relativePath: effective.source.relativePath,
    contentHash: effective.source.contentHash,
    byteLength: effective.source.byteLength,
    content: effective.content,
    sources: sources.map((item) => item.source),
    conflicts: sources
      .slice(1)
      .map(
        (parent) =>
          `${effective.source.relativePath} overrides ${parent.source.relativePath} for the target scope.`
      )
  };
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`));
}

function decode(bytes: Uint8Array): string {
  try {
    return STRICT_UTF8.decode(bytes);
  } catch (error) {
    throw new Error("Scoped instruction file is not valid UTF-8.", { cause: error });
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export class ScopedInstructionSelector implements InstructionSelector {
  public select(workspaceRoot: string, targetRelativePath: string): Promise<InstructionSelection> {
    return selectInstructions(workspaceRoot, targetRelativePath);
  }
}
