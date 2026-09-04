import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
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

describe("agent-run CLI command", () => {
  it("completes a bounded multi-turn session end to end and writes a durable event log", async () => {
    const temporary = await realpath(await mkdtemp(join(tmpdir(), "hve-cli-agent-run-")));
    roots.push(temporary);
    const fixture = join(temporary, "fixture");
    const runsRoot = join(temporary, "sessions");
    await mkdir(join(fixture, "src"), { recursive: true });
    await writeFile(join(fixture, "src/Greeting.txt"), "Hello from fixture\n", "utf8");

    const result = capture();
    const exitCode = await runCli(
      [
        "agent-run",
        "--repository-root",
        resolve("."),
        "--fixture",
        fixture,
        "--runs-root",
        runsRoot
      ],
      result.io
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.at(-1) ?? "{}") as {
      status: string;
      turnsUsed: number;
      toolDispatchesUsed: number;
      evidenceFreshness: string;
      eventsPath: string;
    };
    expect(parsed.status).toBe("completed");
    expect(parsed.turnsUsed).toBe(3);
    expect(parsed.toolDispatchesUsed).toBe(2);
    expect(parsed.evidenceFreshness).toBe("FRESH");
    const events = (await readFile(parsed.eventsPath, "utf8")).trim().split("\n");
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.parse(events[0] as string).eventType).toBe("session.created");
  });

  it("rejects an out-of-range turn budget the same way other numeric flags are validated", async () => {
    const temporary = await realpath(await mkdtemp(join(tmpdir(), "hve-cli-agent-run-bad-")));
    roots.push(temporary);
    const fixture = join(temporary, "fixture");
    await mkdir(join(fixture, "src"), { recursive: true });
    await writeFile(join(fixture, "src/Greeting.txt"), "Hello from fixture\n", "utf8");

    const result = capture();
    const exitCode = await runCli(
      [
        "agent-run",
        "--repository-root",
        resolve("."),
        "--fixture",
        fixture,
        "--runs-root",
        join(temporary, "sessions"),
        "--max-turns",
        "0"
      ],
      result.io
    );
    expect(exitCode).toBe(2);
  });
});
