import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { repositoryFiles, repositoryRoot } from "./repository-files.mjs";

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is unavailable; run this check through npm.");
const result = spawnSync(
  process.execPath,
  [npmCli, "pack", "--dry-run", "--json", "--ignore-scripts"],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    maxBuffer: 4 * 1_048_576
  }
);
if (result.status !== 0) throw new Error(`npm pack failed: ${result.stderr}`);
const report = JSON.parse(result.stdout);
const files = (report[0]?.files?.map((item) => item.path) ?? []).sort();
const expected = await expectedPackageFiles();
const unexpected = files.filter((path) => !expected.has(path));
const missing = [...expected].filter((path) => !files.includes(path));
if (unexpected.length > 0 || missing.length > 0) {
  throw new Error(
    `Package allowlist failed. Unexpected: ${unexpected.join(", ") || "none"}; missing: ${missing.join(", ") || "none"}.`
  );
}
console.log(`[PASS] Package: ${files.length} exact allowlisted files; no unexpected content.`);

async function expectedPackageFiles() {
  const catalog = JSON.parse(await readFile(join(repositoryRoot, "hve/catalog.json"), "utf8"));
  const expected = new Set([
    "LICENSE",
    "README.md",
    "package.json",
    "hve/catalog.json",
    "hve/hosts/claude.json",
    "hve/hosts/cursor.json",
    "hve/hosts/generic.json",
    "hve/hosts/vscode.json",
    "config/contracts/exact-text-replacement.v1.json",
    "config/providers/fixture-anthropic.v1.json",
    "config/providers/fixture-openai.v1.json",
    "config/cowork/color.png",
    "config/cowork/outline.png",
    "evaluation/rubrics/coding-task.v1.json",
    "policies/organization-policy.v1.json",
    "prompts/coding-agent.v1.md",
    "prompts/coding-agent.v2.md",
    "prompts/evaluator.v1.md",
    "protocols/mcp/2026-07-28/conformance-matrix.json",
    "samples/fixture-repo/AGENTS.md",
    "samples/fixture-repo/src/Greeting.txt",
    "schemas/README.md",
    ...[
      "approval",
      "checkpoint",
      "evaluation",
      "event",
      "evidence",
      "handoff",
      "memory",
      "projection",
      "provider-capabilities",
      "task",
      "tool-call",
      "work-contract"
    ].map((name) => `schemas/v1/${name}.schema.json`),
    "schemas/v2/provider-turn.schema.json",
    "schemas/v2/trust-envelope.schema.json",
    "schemas/v2/session-event.schema.json",
    ...catalog.agents.map((item) => item.source),
    ...catalog.rules.map((item) => item.source),
    ...catalog.routers.map((item) => item.source),
    ...catalog.skills.map((item) => item.source)
  ]);
  for (const source of repositoryFiles().filter(
    (path) => /^src\/.+\.ts$/u.test(path) && !path.endsWith(".d.ts")
  )) {
    const stem = `dist/${source.slice("src/".length, -".ts".length)}`;
    for (const suffix of [".d.ts", ".d.ts.map", ".js", ".js.map"]) expected.add(`${stem}${suffix}`);
  }
  return expected;
}
