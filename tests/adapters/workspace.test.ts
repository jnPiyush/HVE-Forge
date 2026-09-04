import { access, cp as copy, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const copyState = vi.hoisted(() => ({ count: 0 }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    cp: vi.fn(async (...argumentsValue: Parameters<typeof actual.cp>) => {
      copyState.count++;
      if (copyState.count === 2) throw new Error("simulated second copy failure");
      return actual.cp(...argumentsValue);
    })
  };
});

import { prepareWorkspace } from "../../src/adapters/workspace.js";

const roots: string[] = [];

beforeEach(() => {
  copyState.count = 0;
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.mocked(copy).mockClear();
});

describe("workspace preparation", () => {
  it("rejects non-directory sources, overlapping roots, and existing destinations", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "hve-workspace-boundaries-")));
    roots.push(root);
    const sourceFile = join(root, "fixture.txt");
    await writeFile(sourceFile, "fixture\n", "utf8");
    await expect(prepareWorkspace(sourceFile, join(root, "run-file"))).rejects.toThrow(
      "Source fixture is not a directory"
    );

    const source = join(root, "fixture");
    await mkdir(source);
    await expect(prepareWorkspace(source, join(source, "nested-run"))).rejects.toThrow(
      "must not contain one another"
    );

    const destination = join(root, "existing-run");
    await mkdir(destination);
    await expect(prepareWorkspace(source, destination)).rejects.toThrow("Run root already exists");
  });

  it("removes a partially copied run root when preparation fails", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "hve-workspace-cleanup-")));
    roots.push(root);
    const source = join(root, "fixture");
    const destination = join(root, "run");
    await mkdir(source);
    await writeFile(join(source, "file.txt"), "fixture\n", "utf8");

    await expect(prepareWorkspace(source, destination)).rejects.toThrow(
      "simulated second copy failure"
    );
    await expect(access(destination)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
