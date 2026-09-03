import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExactTextReplaceHandler } from "../../src/adapters/exact-text-replace.js";
import {
  DirectoryListHandler,
  FileReadHandler,
  TextSearchHandler
} from "../../src/adapters/workspace-read-tools.js";
import { ToolDispatcher } from "../../src/application/tool-dispatcher.js";
import type { PolicyDefinition } from "../../src/core/policy.js";
import { createToolRegistry } from "../../src/core/tool-registry.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function workspace(): Promise<{ root: string; state: string }> {
  const outer = await mkdtemp(join(tmpdir(), "hve-read-tools-"));
  roots.push(outer);
  const root = join(outer, "workspace");
  const state = join(outer, "state");
  await Promise.all([
    mkdir(join(root, "src"), { recursive: true }),
    mkdir(join(root, ".git"), { recursive: true }),
    mkdir(state, { recursive: true })
  ]);
  await writeFile(join(root, "src/a.ts"), "first\r\nneedle here\r\nlast\r\n", "utf8");
  await writeFile(join(root, "src/b.ts"), "needle again\n", "utf8");
  await writeFile(join(root, ".env"), "TOKEN=secret\n", "utf8");
  await writeFile(join(root, ".git/config"), "secret remote\n", "utf8");
  return { root, state };
}

function dispatcher() {
  const handlers = [
    new FileReadHandler(),
    new DirectoryListHandler(),
    new TextSearchHandler(),
    new ExactTextReplaceHandler()
  ];
  const policy: PolicyDefinition = {
    version: "1.0.0",
    contentHash: "a".repeat(64),
    defaultEffect: "deny",
    defaultRuleId: "default-deny",
    rules: handlers.map((handler) => ({
      ruleId: `allow-${handler.descriptor.toolId.replaceAll(".", "-")}`,
      effect: "allow" as const,
      toolName: handler.descriptor.toolId,
      actionClass: handler.descriptor.capabilityClass === "write" ? "workspace_write" : "read"
    }))
  };
  const registry = createToolRegistry(
    handlers.map((handler) => handler.descriptor),
    policy,
    { isolationBackendRegistered: false, egressReceiptsEnabled: false }
  );
  return new ToolDispatcher(registry, policy, handlers);
}

function data(result: Awaited<ReturnType<ToolDispatcher["dispatch"]>>): Record<string, unknown> {
  expect(result.isSuccess).toBe(true);
  return JSON.parse(result.output?.content ?? "{}") as Record<string, unknown>;
}

describe("bounded workspace read tools", () => {
  it("reads a strict UTF-8 file with hashes and explicit truncation", async () => {
    const { root, state } = await workspace();
    const result = await dispatcher().dispatch(
      { workspaceRoot: root, stateRoot: state, cancellation: { isCancellationRequested: false } },
      {
        toolId: "workspace.read_file",
        idempotencyKey: "read-1",
        arguments: { relativePath: "src/a.ts" }
      }
    );
    expect(data(result)).toEqual(
      expect.objectContaining({
        relativePath: "src/a.ts",
        content: "first\r\nneedle here\r\nlast\r\n",
        truncated: false
      })
    );
  });

  it("lists root entries deterministically without exposing protected paths", async () => {
    const { root, state } = await workspace();
    const result = await dispatcher().dispatch(
      { workspaceRoot: root, stateRoot: state, cancellation: { isCancellationRequested: false } },
      {
        toolId: "workspace.list_directory",
        idempotencyKey: "list-1",
        arguments: { relativePath: "." }
      }
    );
    const entries = data(result)["entries"] as { name: string }[];
    expect(entries.map((entry) => entry.name)).toEqual(["src"]);
  });

  it("searches literal text with deterministic CRLF-aware positions", async () => {
    const { root, state } = await workspace();
    const result = await dispatcher().dispatch(
      { workspaceRoot: root, stateRoot: state, cancellation: { isCancellationRequested: false } },
      {
        toolId: "workspace.search_text",
        idempotencyKey: "search-1",
        arguments: { query: "needle" }
      }
    );
    expect(data(result)["matches"]).toEqual([
      { relativePath: "src/a.ts", line: 2, column: 1, preview: "needle here" },
      { relativePath: "src/b.ts", line: 1, column: 1, preview: "needle again" }
    ]);
  });

  it("denies direct reads of credentials and control state", async () => {
    const { root, state } = await workspace();
    for (const relativePath of [".env", ".git/config", ".hve/state.json", "secret.pem"]) {
      const result = await dispatcher().dispatch(
        { workspaceRoot: root, stateRoot: state, cancellation: { isCancellationRequested: false } },
        {
          toolId: "workspace.read_file",
          idempotencyKey: "protected-1",
          arguments: { relativePath }
        }
      );
      expect(result.error?.code).toBe("SENSITIVE_PATH");
    }
  });

  it("rejects a linked directory without reading outside the workspace", async () => {
    const { root, state } = await workspace();
    const outside = join(dirname(root), "outside");
    await mkdir(outside);
    await writeFile(join(outside, "public.txt"), "outside secret", "utf8");
    try {
      await symlink(outside, join(root, "linked"), "junction");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EPERM") return;
      throw error;
    }
    const result = await dispatcher().dispatch(
      { workspaceRoot: root, stateRoot: state, cancellation: { isCancellationRequested: false } },
      {
        toolId: "workspace.read_file",
        idempotencyKey: "link-1",
        arguments: { relativePath: "linked/public.txt" }
      }
    );
    expect(result.isSuccess).toBe(false);
    expect(result.error?.code).toMatch(/^PATH_/u);
  });

  it("routes exact replacement through the same dispatcher", async () => {
    const { root, state } = await workspace();
    const result = await dispatcher().dispatch(
      { workspaceRoot: root, stateRoot: state, cancellation: { isCancellationRequested: false } },
      {
        toolId: "workspace.replace_exact_text",
        idempotencyKey: "replace-1",
        arguments: {
          relativePath: "src/b.ts",
          expectedText: "needle again",
          replacementText: "replacement"
        }
      }
    );
    expect(result.isSuccess).toBe(true);
    expect(result.mutation?.afterFileHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(await readFile(join(root, "src/b.ts"), "utf8")).toBe("replacement\n");
  });
});
