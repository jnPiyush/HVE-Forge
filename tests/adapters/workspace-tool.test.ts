import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExactTextReplaceTool } from "../../src/adapters/exact-text-replace.js";
import {
  PathSafetyError,
  resolveExistingRegularFile,
  validateRelativePath
} from "../../src/adapters/path-safety.js";
import { computeTreeHash } from "../../src/adapters/workspace.js";
import { canonicalizeValue, sha256Hex } from "../../src/core/canonical-json.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function createWorkspace(): Promise<{ workspace: string; state: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "hve-tool-")));
  roots.push(root);
  const workspace = join(root, "workspace");
  const state = join(root, "state");
  await mkdir(join(workspace, "src"), { recursive: true });
  await mkdir(state, { recursive: true });
  await writeFile(join(workspace, "src/Greeting.txt"), "Hello from fixture\r\n", "utf8");
  return { workspace, state };
}

describe("path safety", () => {
  it.each([
    "../outside.txt",
    "a/../outside.txt",
    "/absolute.txt",
    "C:\\absolute.txt",
    "file.txt:stream",
    "CON",
    "trailing. ",
    "a/*.txt"
  ])("rejects unsafe path %s", (path) => {
    expect(() => validateRelativePath(path)).toThrow(PathSafetyError);
  });

  it("resolves only an existing regular file", async () => {
    const { workspace } = await createWorkspace();
    await expect(resolveExistingRegularFile(workspace, "src/Greeting.txt")).resolves.toBe(
      join(workspace, "src/Greeting.txt")
    );
    await expect(resolveExistingRegularFile(workspace, "src")).rejects.toThrow(PathSafetyError);
  });

  it("rejects a symbolic link component when supported", async () => {
    const { workspace } = await createWorkspace();
    const outside = join(dirname(workspace), "outside");
    await mkdir(outside);
    await writeFile(join(outside, "secret.txt"), "secret", "utf8");
    try {
      await symlink(outside, join(workspace, "linked"), "junction");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EPERM") return;
      throw error;
    }
    await expect(resolveExistingRegularFile(workspace, "linked/secret.txt")).rejects.toThrow(
      PathSafetyError
    );
  });
});

describe("workspace hashing and exact replacement", () => {
  it("hashes sorted file entries and excludes private control state", async () => {
    const { workspace } = await createWorkspace();
    const before = await computeTreeHash(workspace);
    await mkdir(join(workspace, ".hve-control"));
    await writeFile(join(workspace, ".hve-control/private.bin"), "private", "utf8");
    expect(await computeTreeHash(workspace)).toBe(before);
    await writeFile(join(workspace, "src/other.txt"), "new", "utf8");
    expect(await computeTreeHash(workspace)).not.toBe(before);
  });

  it("commits one replacement and reconciles the receipt idempotently", async () => {
    const { workspace, state } = await createWorkspace();
    const argumentsValue = {
      relativePath: "src/Greeting.txt",
      expectedText: "Hello from fixture",
      replacementText: "Hello from HVE-Forge"
    };
    const argumentsHash = sha256Hex(canonicalizeValue(argumentsValue));
    const tool = new ExactTextReplaceTool();
    const first = await tool.execute(
      { workspaceRoot: workspace, stateRoot: state, idempotencyKey: "replace-1", argumentsHash },
      argumentsValue
    );
    const second = await tool.execute(
      { workspaceRoot: workspace, stateRoot: state, idempotencyKey: "replace-1", argumentsHash },
      argumentsValue
    );
    expect(first.isSuccess).toBe(true);
    expect(first.replayedReceipt).toBe(false);
    expect(second.isSuccess).toBe(true);
    expect(second.replayedReceipt).toBe(true);
    expect(await readFile(join(workspace, "src/Greeting.txt"), "utf8")).toBe(
      "Hello from HVE-Forge\r\n"
    );
  });

  it("rejects ambiguous text and idempotency-key reuse", async () => {
    const { workspace, state } = await createWorkspace();
    const tool = new ExactTextReplaceTool();
    const bad = await tool.execute(
      {
        workspaceRoot: workspace,
        stateRoot: state,
        idempotencyKey: "replace-1",
        argumentsHash: "a".repeat(64)
      },
      { relativePath: "src/Greeting.txt", expectedText: "missing", replacementText: "x" }
    );
    expect(bad.errorCode).toBe("EXPECTED_TEXT_COUNT");

    const goodArgs = {
      relativePath: "src/Greeting.txt",
      expectedText: "Hello from fixture",
      replacementText: "first"
    };
    await tool.execute(
      {
        workspaceRoot: workspace,
        stateRoot: state,
        idempotencyKey: "replace-2",
        argumentsHash: sha256Hex(canonicalizeValue(goodArgs))
      },
      goodArgs
    );
    const conflict = await tool.execute(
      {
        workspaceRoot: workspace,
        stateRoot: state,
        idempotencyKey: "replace-2",
        argumentsHash: "b".repeat(64)
      },
      { ...goodArgs, replacementText: "second" }
    );
    expect(conflict.errorCode).toBe("IDEMPOTENCY_CONFLICT");
  });
});
