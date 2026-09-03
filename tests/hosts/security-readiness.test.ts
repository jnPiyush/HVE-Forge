import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectHostWorkspace } from "../../src/hosts/doctor.js";
import { renderWorkspace } from "../../src/hosts/renderer.js";

const roots: string[] = [];
const FORBIDDEN = ["Edit", "Write", "Bash", "PowerShell", "WebFetch", "WebSearch", "Agent"];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("host security readiness", () => {
  it("renders no native privileged tools in default generated agents", async () => {
    const target = await mkdtemp(join(tmpdir(), "hve-host-security-"));
    roots.push(target);
    await renderWorkspace({
      sourceRoot: resolve("."),
      targetRoot: target,
      hosts: ["vscode", "cursor", "claude"],
      mode: "write"
    });

    for (const name of [
      "hve-orchestrator",
      "hve-planner",
      "hve-engineer",
      "hve-reviewer",
      "hve-security",
      "hve-tester",
      "hve-release"
    ]) {
      const content = await readFile(join(target, ".claude/agents", `${name}.md`), "utf8");
      const toolLine = content.split(/\r?\n/u).find((line) => line.startsWith("tools:")) ?? "";
      const tools = toolLine
        .slice("tools:".length)
        .split(",")
        .map((tool) => tool.trim());
      for (const tool of FORBIDDEN) expect(tools).not.toContain(tool);
    }
  });

  it("reports structurally clean declarative hosts as advisory rather than ready", async () => {
    const target = await mkdtemp(join(tmpdir(), "hve-host-advisory-"));
    roots.push(target);
    await renderWorkspace({
      sourceRoot: resolve("."),
      targetRoot: target,
      hosts: ["vscode", "cursor", "claude"],
      mode: "write"
    });

    const report = await inspectHostWorkspace(resolve("."), target, ["vscode", "cursor", "claude"]);
    expect(report).toEqual(
      expect.objectContaining({
        structuralOk: true,
        securityReadiness: "advisory",
        ok: false
      })
    );
    expect(report.hosts.every((host) => host.enforcementTier === "declarative")).toBe(true);
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("declarative"),
        expect.stringContaining("does not prove kernel mediation")
      ])
    );
  });
});
