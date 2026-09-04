import { spawnSync } from "node:child_process";
import { repositoryRoot } from "./repository-files.mjs";

const result = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
  cwd: repositoryRoot,
  encoding: "utf8",
  shell: false,
  windowsHide: true
});
if (result.status !== 0) {
  throw new Error(`git status failed: ${result.stderr}`);
}
const lines = result.stdout.split("\n").filter(Boolean);
if (lines.length > 0) {
  throw new Error(
    `Release candidate source is not fully tracked. Commit or discard these paths first:\n${lines.join("\n")}`
  );
}
console.log("[PASS] Tracked input: the working tree has no uncommitted or untracked changes.");
