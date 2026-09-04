import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("installed distribution identity", () => {
  it("initializes an unrelated target without an internal repository-root argument", async () => {
    const target = await realpath(await mkdtemp(join(tmpdir(), "hve-distribution-ordinary-")));
    roots.push(target);
    const output = capture();

    expect(
      await runCli(["init", "--target-root", target, "--hosts", "vscode"], output.io, {
        cwd: target
      })
    ).toBe(0);

    expect(JSON.parse(output.stdout[0] ?? "{}")).toEqual(
      expect.objectContaining({ type: "init", clean: true })
    );
    expect(await readFile(join(target, ".hve/host-manifest.json"), "utf8")).toContain(
      '"rendererVersion":"0.2.0"'
    );
  });

  it("never treats poisoned target assets as the installed distribution", async () => {
    const target = await realpath(await mkdtemp(join(tmpdir(), "hve-distribution-poison-")));
    roots.push(target);
    await mkdir(join(target, "hve"), { recursive: true });
    await writeFile(
      join(target, "package.json"),
      '{"name":"@hve-forge/cli","version":"999.0.0"}\n',
      "utf8"
    );
    await writeFile(
      join(target, "hve/catalog.json"),
      '{"poison":"TARGET_POISON_SENTINEL"}\n',
      "utf8"
    );
    const output = capture();

    expect(
      await runCli(["init", "--target-root", target, "--hosts", "vscode"], output.io, {
        cwd: target
      })
    ).toBe(0);

    const generated = await Promise.all([
      readFile(join(target, "AGENTS.md"), "utf8"),
      readFile(join(target, ".claude/agents/hve-engineer.md"), "utf8"),
      readFile(join(target, ".hve/host-manifest.json"), "utf8")
    ]);
    expect(generated.join("\n")).not.toContain("TARGET_POISON_SENTINEL");
  });

  it("rejects a repository-root override that points at the target", async () => {
    const target = await realpath(await mkdtemp(join(tmpdir(), "hve-distribution-override-")));
    const outputRoot = join(target, "output");
    roots.push(target);
    await mkdir(join(target, "hve"), { recursive: true });
    await writeFile(join(target, "package.json"), '{"name":"@hve-forge/cli"}\n', "utf8");
    await writeFile(join(target, "hve/catalog.json"), "{}\n", "utf8");
    const output = capture();

    expect(
      await runCli(
        ["init", "--repository-root", target, "--target-root", outputRoot, "--hosts", "vscode"],
        output.io,
        { cwd: target }
      )
    ).toBe(2);
    expect(output.stderr).toEqual([
      "--repository-root cannot select distribution assets; it must match the installed package."
    ]);
  });
});
