import { mkdtemp, readFile, rm } from "node:fs/promises";
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

describe("cowork-package CLI command", () => {
  it("packages the canonical eligible skills into an installable zip", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "hve-cli-cowork-"));
    roots.push(temporary);
    const destination = join(temporary, "hve-forge-cowork.zip");

    const result = capture();
    const exitCode = await runCli(
      ["cowork-package", "--repository-root", resolve("."), "--destination", destination],
      result.io
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.at(-1) ?? "{}") as {
      destination: string;
      includedSkills: readonly string[];
      excludedSkills: readonly { name: string; reason: string }[];
      manifestId: string;
    };
    expect(parsed.includedSkills).toContain("exact-text-replacement");
    expect(parsed.excludedSkills.some((entry) => entry.name === "hve-release")).toBe(true);
    expect(/^[0-9a-f-]{36}$/.test(parsed.manifestId)).toBe(true);

    const bytes = await readFile(destination);
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(bytes.subarray(0, 2).toString("ascii")).toBe("PK");
  });
});
