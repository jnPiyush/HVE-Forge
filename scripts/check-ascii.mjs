import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { repositoryFiles, repositoryRoot } from "./repository-files.mjs";

const extensions = new Set([
  ".ts",
  ".mjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".txt",
  ".ps1",
  ".cs",
  ".csproj",
  ".props",
  ".slnx"
]);
const violations = [];
const paths = repositoryFiles();

for (const relativePath of paths) {
  if (
    !extensions.has(extname(relativePath)) &&
    ![".gitignore", ".npmrc", ".node-version"].includes(relativePath)
  ) {
    continue;
  }
  const path = join(repositoryRoot, relativePath);
  if ((await stat(path)).size > 2 * 1_048_576) {
    violations.push(`${relativePath}: exceeds 2 MiB scanner limit`);
    continue;
  }
  const bytes = await readFile(path);
  if (bytes.some((byte) => byte > 0x7f)) violations.push(relativePath);
}

if (violations.length > 0) {
  throw new Error(`Non-ASCII repository content:\n${violations.join("\n")}`);
}
console.log(`[PASS] ASCII: ${paths.length} repository paths inspected.`);
