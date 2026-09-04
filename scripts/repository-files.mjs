import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export const repositoryRoot = resolve(import.meta.dirname, "..");

export function repositoryFiles() {
  const result = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: repositoryRoot,
      encoding: "buffer",
      shell: false,
      windowsHide: true
    }
  );
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr.toString("utf8")}`);
  }
  return result.stdout.toString("utf8").split("\0").filter(Boolean).sort();
}
