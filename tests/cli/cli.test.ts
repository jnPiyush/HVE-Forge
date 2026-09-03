import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type CliIo, runCli } from "../../src/cli/application.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function capture(): { io: CliIo; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: { stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line) }
  };
}

describe("HVE CLI", () => {
  it("reports version and rejects an unknown command", async () => {
    const version = capture();
    expect(await runCli(["version"], version.io)).toBe(0);
    expect(version.stdout).toEqual(["hve 0.2.0"]);

    const unknown = capture();
    expect(await runCli(["unknown"], unknown.io)).toBe(2);
    expect(unknown.stderr[0]).toContain("Unknown command");
  });

  it("supports help and version aliases", async () => {
    for (const args of [[], ["help"], ["--help"], ["-h"]]) {
      const output = capture();
      expect(await runCli(args, output.io)).toBe(0);
      expect(output.stdout.join("\n")).toContain("hve init|render|update");
    }
    const version = capture();
    expect(await runCli(["--version"], version.io)).toBe(0);
    expect(version.stdout).toEqual(["hve 0.2.0"]);
  });

  it("renders and checks all supported host artifacts", async () => {
    const targetRoot = await mkdtemp(join(tmpdir(), "hve-cli-render-"));
    roots.push(targetRoot);
    const rendered = capture();
    expect(
      await runCli(
        [
          "render",
          "--repository-root",
          resolve("."),
          "--target-root",
          targetRoot,
          "--hosts",
          "vscode,cursor,claude"
        ],
        rendered.io
      )
    ).toBe(0);
    expect(JSON.parse(rendered.stdout.at(-1) ?? "{}").type).toBe("render");

    const checked = capture();
    expect(
      await runCli(
        [
          "render",
          "--check",
          "--repository-root",
          resolve("."),
          "--target-root",
          targetRoot,
          "--hosts",
          "vscode,cursor,claude"
        ],
        checked.io
      )
    ).toBe(0);
    expect(JSON.parse(checked.stdout.at(-1) ?? "{}").clean).toBe(true);

    const doctor = capture();
    expect(
      await runCli(
        [
          "doctor",
          "--repository-root",
          resolve("."),
          "--target-root",
          targetRoot,
          "--hosts",
          "vscode,cursor,claude"
        ],
        doctor.io
      )
    ).toBe(11);
    expect(JSON.parse(doctor.stdout.at(-1) ?? "{}")).toEqual(
      expect.objectContaining({ structuralOk: true, securityReadiness: "advisory", ok: false })
    );
  });

  it("runs and replays a fixture through JSON output", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "hve-cli-run-"));
    roots.push(temporary);
    const fixture = join(temporary, "fixture");
    const runsRoot = join(temporary, "runs");
    await mkdir(join(fixture, "src"), { recursive: true });
    await writeFile(join(fixture, "src/Greeting.txt"), "Hello from fixture\n", "utf8");

    const run = capture();
    expect(
      await runCli(
        [
          "run",
          "--repository-root",
          resolve("."),
          "--fixture",
          fixture,
          "--runs-root",
          runsRoot,
          "--quiet"
        ],
        run.io
      )
    ).toBe(0);
    const result = JSON.parse(run.stdout.at(-1) ?? "{}") as {
      runRoot: string;
      status: string;
      lastSequence: number;
    };
    expect(result.status).toBe("completed");
    expect(result.lastSequence).toBe(16);

    const replay = capture();
    expect(
      await runCli(
        ["replay", result.runRoot, "--repository-root", resolve("."), "--quiet"],
        replay.io
      )
    ).toBe(0);
    expect(JSON.parse(replay.stdout.at(-1) ?? "{}").eventCount).toBe(16);
  });

  it("returns policy denial for synthetic approval without executing anything", async () => {
    const approval = capture();
    expect(
      await runCli(
        ["approval", "--action", "publish", "--class", "external_write", "--resource", "example"],
        approval.io
      )
    ).toBe(3);
    const output = JSON.parse(approval.stdout.at(-1) ?? "{}") as {
      type: string;
      executable: boolean;
    };
    expect(output).toEqual(
      expect.objectContaining({ type: "approval-required", executable: false })
    );
  });

  it("supports lifecycle, discovery, handoff, reset, and evidence-only archive commands", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "hve-cli-lifecycle-"));
    roots.push(temporary);
    const fixture = join(temporary, "fixture");
    const runsRoot = join(temporary, "runs");
    await mkdir(join(fixture, "src"), { recursive: true });
    await writeFile(join(fixture, "src/Greeting.txt"), "Hello from fixture\n", "utf8");
    await writeFile(join(fixture, "AGENTS.md"), "# Fixture guidance\n", "utf8");
    const repositoryArgs = ["--repository-root", resolve("."), "--quiet"];
    const interrupted = capture();
    expect(
      await runCli(
        [
          "run",
          "--fixture",
          fixture,
          "--runs-root",
          runsRoot,
          "--interrupt",
          "after-decision",
          ...repositoryArgs
        ],
        interrupted.io
      )
    ).toBe(8);
    const interruptedResult = JSON.parse(interrupted.stdout.at(-1) ?? "{}") as {
      runRoot: string;
    };

    for (const command of ["inspect", "stream", "resume"] as const) {
      const output = capture();
      const args =
        command === "stream"
          ? [command, interruptedResult.runRoot, "--after", "0", ...repositoryArgs]
          : [command, interruptedResult.runRoot, ...repositoryArgs];
      expect(await runCli(args, output.io)).toBe(0);
      expect(output.stdout.length).toBeGreaterThan(0);
    }

    const skills = capture();
    expect(await runCli(["skills", ...repositoryArgs], skills.io)).toBe(0);
    expect(JSON.parse(skills.stdout[0] ?? "{}").skills.length).toBeGreaterThan(0);
    const activated = capture();
    expect(
      await runCli(
        ["skills", "--activate", "exact-text-replacement", ...repositoryArgs],
        activated.io
      )
    ).toBe(0);
    expect(JSON.parse(activated.stdout[0] ?? "{}").instructionsLoaded).toBe(true);

    const instructions = capture();
    expect(
      await runCli(
        [
          "instructions",
          "--workspace",
          join(interruptedResult.runRoot, "workspace"),
          "--target",
          "src/Greeting.txt",
          ...repositoryArgs
        ],
        instructions.io
      )
    ).toBe(0);
    expect(JSON.parse(instructions.stdout[0] ?? "{}").effective).toBe("AGENTS.md");

    const handoffPath = join(temporary, "handoff.json");
    const handoff = capture();
    expect(
      await runCli(
        ["handoff", interruptedResult.runRoot, "--destination", handoffPath, ...repositoryArgs],
        handoff.io
      )
    ).toBe(0);
    const reset = capture();
    expect(await runCli(["reset", handoffPath, ...repositoryArgs], reset.io)).toBe(0);

    const archivePath = join(temporary, "evidence.zip");
    const archive = capture();
    expect(
      await runCli(
        ["archive", interruptedResult.runRoot, "--destination", archivePath, ...repositoryArgs],
        archive.io
      )
    ).toBe(0);
    const archiveBytes = await import("node:fs/promises").then(({ readFile }) =>
      readFile(archivePath)
    );
    const archiveText = archiveBytes.toString("latin1");
    expect(archiveText).toContain("archive-manifest.json");
    expect(archiveText).toContain("state/events.jsonl");
    expect(archiveText).not.toContain("state/run.json");
    expect(archiveText).not.toContain("Hello from fixture");

    const mcp = capture();
    expect(await runCli(["mcp", ...repositoryArgs], mcp.io)).toBe(0);
    expect(JSON.parse(mcp.stdout[0] ?? "{}").type).toBe("mcp-conformance");
  });

  it("returns deterministic usage errors for invalid arguments", async () => {
    const cases = [
      ["unknown"],
      ["render", "--hosts"],
      ["render", "--hosts", "vscode", "--hosts", "cursor"],
      ["render", "--hosts", "unknown", "--repository-root", resolve(".")],
      ["render", "--hosts", ",", "--repository-root", resolve(".")],
      ["run", "--interrupt", "nowhere", "--repository-root", resolve(".")],
      ["run", "--max-decisions", "x", "--repository-root", resolve(".")],
      ["replay", "--repository-root", resolve(".")],
      ["approval", "--action", "x", "--class", "read", "--resource", "x"]
    ];
    for (const args of cases) {
      const output = capture();
      expect(await runCli(args, output.io)).toBe(2);
      expect(output.stderr).toHaveLength(1);
    }
  });

  it("reports a dirty rendered workspace as blocked", async () => {
    const targetRoot = await mkdtemp(join(tmpdir(), "hve-cli-dirty-"));
    roots.push(targetRoot);
    const rendered = capture();
    await runCli(
      [
        "render",
        "--repository-root",
        resolve("."),
        "--target-root",
        targetRoot,
        "--hosts",
        "vscode"
      ],
      rendered.io
    );
    await writeFile(join(targetRoot, ".claude/agents/hve-engineer.md"), "dirty", "utf8");
    const doctor = capture();
    expect(
      await runCli(
        [
          "doctor",
          "--repository-root",
          resolve("."),
          "--target-root",
          targetRoot,
          "--hosts",
          "vscode"
        ],
        doctor.io
      )
    ).toBe(11);
    expect(JSON.parse(doctor.stdout[0] ?? "{}").renderClean).toBe(false);
  });
});
