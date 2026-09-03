import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/core/canonical-json.js";
import { inspectHostWorkspace } from "../../src/hosts/doctor.js";
import {
  assertSafeHostRoot,
  normalizeHostRelativePath,
  readHostTextFile,
  removeHostFile,
  resolveHostPath,
  writeHostTextFileAtomic
} from "../../src/hosts/path-safety.js";
import { RenderConflictError, renderWorkspace } from "../../src/hosts/renderer.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hve-render-"));
  temporaryRoots.push(root);
  return root;
}

describe("host renderer", () => {
  it("renders one shared agent and skill copy with native host rules", async () => {
    const targetRoot = await temporaryRoot();
    const result = await renderWorkspace({
      sourceRoot: resolve("."),
      targetRoot,
      hosts: ["vscode", "cursor", "claude"],
      mode: "write"
    });

    expect(result.conflicts).toEqual([]);
    expect(result.written.length).toBeGreaterThan(10);
    await expect(readFile(join(targetRoot, "AGENTS.md"), "utf8")).resolves.toContain("HVE-Forge");
    await expect(
      readFile(join(targetRoot, ".claude/agents/hve-engineer.md"), "utf8")
    ).resolves.toContain("tools: Read, Grep, Glob, TodoWrite");
    await expect(
      readFile(join(targetRoot, ".cursor/rules/hve-typescript.mdc"), "utf8")
    ).resolves.toContain("alwaysApply: false");
    await expect(
      readFile(join(targetRoot, ".claude/agents/hve-reviewer.md"), "utf8")
    ).resolves.toContain("readonly: true");
    await expect(
      readFile(join(targetRoot, ".claude/agents/hve-engineer.md"), "utf8")
    ).resolves.toContain("readonly: true");
    await expect(
      readFile(join(targetRoot, ".claude/skills/exact-text-replacement/SKILL.md"), "utf8")
    ).resolves.toContain("logical-id: skill.exact-text-replacement");
    await expect(
      readFile(join(targetRoot, ".github/agents/hve-engineer.agent.md"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(targetRoot, ".cursor/agents/hve-engineer.md"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("renders generic skills without creating editor-specific agents", async () => {
    const targetRoot = await temporaryRoot();
    await renderWorkspace({
      sourceRoot: resolve("."),
      targetRoot,
      hosts: ["generic"],
      mode: "write"
    });

    await expect(
      readFile(join(targetRoot, ".agents/skills/hve-plan/SKILL.md"), "utf8")
    ).resolves.toContain("logical-id: skill.hve-plan");
    await expect(
      readFile(join(targetRoot, ".claude/agents/hve-planner.md"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("is deterministic and clean in check mode", async () => {
    const targetRoot = await temporaryRoot();
    const options = {
      sourceRoot: resolve("."),
      targetRoot,
      hosts: ["vscode", "cursor", "claude"] as const
    };
    await renderWorkspace({ ...options, mode: "write" });
    const check = await renderWorkspace({ ...options, mode: "check" });
    expect(check.clean).toBe(true);
    expect(check.changed).toEqual([]);
    expect(check.missing).toEqual([]);
  });

  it("refuses to overwrite a locally edited generated file", async () => {
    const targetRoot = await temporaryRoot();
    const options = {
      sourceRoot: resolve("."),
      targetRoot,
      hosts: ["vscode"] as const
    };
    await renderWorkspace({ ...options, mode: "write" });
    const generated = join(targetRoot, ".claude/agents/hve-engineer.md");
    await writeFile(generated, "operator content\n", "utf8");
    await expect(renderWorkspace({ ...options, mode: "write" })).rejects.toBeInstanceOf(
      RenderConflictError
    );
    await expect(readFile(generated, "utf8")).resolves.toBe("operator content\n");
  });

  it("rejects a linked target ancestor without writing outside the target root", async () => {
    const targetRoot = await temporaryRoot();
    const outside = await temporaryRoot();
    try {
      await symlink(outside, join(targetRoot, ".claude"), "junction");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EPERM") return;
      throw error;
    }

    await expect(
      renderWorkspace({
        sourceRoot: resolve("."),
        targetRoot,
        hosts: ["vscode"],
        mode: "write"
      })
    ).rejects.toThrow(/link|reparse/iu);
    await expect(readFile(join(outside, "agents/hve-engineer.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("rejects a linked canonical source tree", async () => {
    const sourceRoot = await temporaryRoot();
    const targetRoot = await temporaryRoot();
    try {
      await symlink(resolve("hve"), join(sourceRoot, "hve"), "junction");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EPERM") return;
      throw error;
    }

    await expect(
      renderWorkspace({ sourceRoot, targetRoot, hosts: ["vscode"], mode: "write" })
    ).rejects.toThrow(/link|reparse/iu);
  });

  it("reports capability tiers and no duplicate logical IDs", async () => {
    const targetRoot = await temporaryRoot();
    await renderWorkspace({
      sourceRoot: resolve("."),
      targetRoot,
      hosts: ["vscode", "cursor", "claude"],
      mode: "write"
    });
    const report = await inspectHostWorkspace(resolve("."), targetRoot, [
      "vscode",
      "cursor",
      "claude"
    ]);
    expect(report.structuralOk).toBe(true);
    expect(report.securityReadiness).toBe("advisory");
    expect(report.ok).toBe(false);
    expect(report.duplicates).toEqual([]);
    expect(report.hosts.map((host) => host.enforcementTier)).toEqual([
      "declarative",
      "declarative",
      "declarative"
    ]);
    expect(report.hosts.every((host) => host.hooksEnabled === false)).toBe(true);
  });

  it("detects unmanaged compatibility copies discovered by a host", async () => {
    const targetRoot = await temporaryRoot();
    await renderWorkspace({
      sourceRoot: resolve("."),
      targetRoot,
      hosts: ["vscode"],
      mode: "write"
    });
    const duplicateAgent = join(targetRoot, ".github/agents/hve-engineer.agent.md");
    const duplicateSkill = join(targetRoot, ".agents/skills/hve-plan/SKILL.md");
    const duplicateRule = join(
      targetRoot,
      ".github/instructions/hve-typescript-copy.instructions.md"
    );
    await mkdir(join(targetRoot, ".github/agents"), { recursive: true });
    await mkdir(join(targetRoot, ".agents/skills/hve-plan"), { recursive: true });
    await writeFile(
      duplicateAgent,
      '---\nname: "HVE Engineer"\ndescription: duplicate\n---\n',
      "utf8"
    );
    await writeFile(duplicateSkill, "---\nname: hve-plan\ndescription: duplicate\n---\n", "utf8");
    await writeFile(
      duplicateRule,
      [
        "---",
        "description: >",
        "  Apply strict TypeScript, ESM, runtime validation, dependency minimization,",
        "  and deterministic error-handling rules to Node source files.",
        'applyTo: "**/*.ts"',
        "---",
        "",
        "# Duplicate rule",
        ""
      ].join("\n"),
      "utf8"
    );

    const report = await inspectHostWorkspace(resolve("."), targetRoot, ["vscode"]);

    expect(report.ok).toBe(false);
    expect(report.duplicates).toEqual([
      {
        hostId: "vscode",
        logicalId: "agent.engineer",
        paths: [".claude/agents/hve-engineer.md", ".github/agents/hve-engineer.agent.md"]
      },
      {
        hostId: "vscode",
        logicalId: "rule.typescript",
        paths: [
          ".github/instructions/hve-typescript-copy.instructions.md",
          ".github/instructions/hve-typescript.instructions.md"
        ]
      },
      {
        hostId: "vscode",
        logicalId: "skill.hve-plan",
        paths: [".agents/skills/hve-plan/SKILL.md", ".claude/skills/hve-plan/SKILL.md"]
      }
    ]);
  });

  it("does not lose ownership of clean outputs omitted from a write render", async () => {
    const targetRoot = await temporaryRoot();
    const sourceRoot = resolve(".");
    await renderWorkspace({
      sourceRoot,
      targetRoot,
      hosts: ["vscode", "cursor", "claude"],
      mode: "write"
    });
    const cursorRule = join(targetRoot, ".cursor/rules/hve-typescript.mdc");

    await renderWorkspace({
      sourceRoot,
      targetRoot,
      hosts: ["vscode"],
      mode: "write"
    });
    const updated = await renderWorkspace({
      sourceRoot,
      targetRoot,
      hosts: ["vscode"],
      mode: "update"
    });

    expect(updated.deleted).toContain(".cursor/rules/hve-typescript.mdc");
    await expect(readFile(cursorRule, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not delete an unrelated file claimed by a forged target manifest", async () => {
    const targetRoot = await temporaryRoot();
    await renderWorkspace({
      sourceRoot: resolve("."),
      targetRoot,
      hosts: ["vscode"],
      mode: "write"
    });
    const unrelatedPath = join(targetRoot, "operator-notes.txt");
    const unrelatedContent = "operator-owned\n";
    await writeFile(unrelatedPath, unrelatedContent, "utf8");
    const manifestPath = join(targetRoot, ".hve/host-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      outputs: Array<Record<string, unknown>>;
    };
    manifest.outputs.push({
      logicalId: "agent.engineer",
      kind: "agent",
      path: "operator-notes.txt",
      sourcePath: "hve/agents/engineer.md",
      sourceHash: "a".repeat(64),
      outputHash: sha256Hex(unrelatedContent),
      hosts: ["vscode"]
    });
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");

    await expect(
      renderWorkspace({
        sourceRoot: resolve("."),
        targetRoot,
        hosts: ["vscode"],
        mode: "update"
      })
    ).rejects.toThrow(/ownership/iu);
    await expect(readFile(unrelatedPath, "utf8")).resolves.toBe(unrelatedContent);
  });

  it("does not delete forged content at a catalog-authorized orphan path", async () => {
    const targetRoot = await temporaryRoot();
    await renderWorkspace({
      sourceRoot: resolve("."),
      targetRoot,
      hosts: ["vscode", "cursor", "claude"],
      mode: "write"
    });
    const orphanRelativePath = ".cursor/rules/hve-typescript.mdc";
    const orphanPath = join(targetRoot, ...orphanRelativePath.split("/"));
    const manifestPath = join(targetRoot, ".hve/host-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      outputs: Array<Record<string, unknown>>;
    };
    const entry = manifest.outputs.find((item) => item["path"] === orphanRelativePath);
    expect(entry).toBeDefined();
    const forgedContent = [
      `<!-- Generated by HVE-Forge; logical-id: ${entry?.["logicalId"]}; source: ${entry?.["sourcePath"]}; source-sha256: ${entry?.["sourceHash"]}; DO NOT EDIT. -->`,
      "",
      "operator-owned content",
      ""
    ].join("\n");
    await writeFile(orphanPath, forgedContent, "utf8");
    if (entry !== undefined) entry["outputHash"] = sha256Hex(forgedContent);
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");

    await expect(
      renderWorkspace({
        sourceRoot: resolve("."),
        targetRoot,
        hosts: ["vscode"],
        mode: "update"
      })
    ).rejects.toThrow(/ownership/iu);
    await expect(readFile(orphanPath, "utf8")).resolves.toBe(forgedContent);
  });

  it("rejects unexpected host manifest fields", async () => {
    const targetRoot = await temporaryRoot();
    await renderWorkspace({
      sourceRoot: resolve("."),
      targetRoot,
      hosts: ["vscode"],
      mode: "write"
    });
    const manifestPath = join(targetRoot, ".hve/host-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    await writeFile(manifestPath, `${JSON.stringify({ ...manifest, unexpected: true })}\n`, "utf8");
    await expect(
      renderWorkspace({
        sourceRoot: resolve("."),
        targetRoot,
        hosts: ["vscode"],
        mode: "check"
      })
    ).rejects.toThrow("manifest fields");
  });

  it.each([
    ["non-object", () => null],
    ["schema", (manifest: Record<string, unknown>) => ({ ...manifest, schemaVersion: "2.0" })],
    [
      "renderer version",
      (manifest: Record<string, unknown>) => ({ ...manifest, rendererVersion: "latest" })
    ],
    [
      "profile name",
      (manifest: Record<string, unknown>) => ({
        ...manifest,
        profileVersions: { ...(manifest["profileVersions"] as object), unknown: "1.0.0" }
      })
    ],
    [
      "profile version",
      (manifest: Record<string, unknown>) => ({
        ...manifest,
        profileVersions: { ...(manifest["profileVersions"] as object), vscode: "latest" }
      })
    ],
    ["outputs", (manifest: Record<string, unknown>) => ({ ...manifest, outputs: null })],
    ["output object", (manifest: Record<string, unknown>) => ({ ...manifest, outputs: [null] })],
    [
      "output kind",
      (manifest: Record<string, unknown>) => changeFirstOutput(manifest, { kind: "unknown" })
    ],
    [
      "output hosts",
      (manifest: Record<string, unknown>) => changeFirstOutput(manifest, { hosts: [] })
    ],
    [
      "output host name",
      (manifest: Record<string, unknown>) => changeFirstOutput(manifest, { hosts: ["unknown"] })
    ],
    [
      "duplicate output hosts",
      (manifest: Record<string, unknown>) =>
        changeFirstOutput(manifest, { hosts: ["generic", "generic"] })
    ],
    [
      "logical ID",
      (manifest: Record<string, unknown>) => changeFirstOutput(manifest, { logicalId: "Bad ID" })
    ],
    [
      "source hash",
      (manifest: Record<string, unknown>) => changeFirstOutput(manifest, { sourceHash: "bad" })
    ],
    [
      "duplicate paths",
      (manifest: Record<string, unknown>) => ({
        ...manifest,
        outputs: [
          ...((manifest["outputs"] as unknown[]) ?? []),
          (manifest["outputs"] as unknown[])[0]
        ]
      })
    ]
  ] as const)("rejects invalid manifest %s", async (_name, mutate) => {
    const targetRoot = await temporaryRoot();
    await renderWorkspace({
      sourceRoot: resolve("."),
      targetRoot,
      hosts: ["vscode"],
      mode: "write"
    });
    const manifestPath = join(targetRoot, ".hve/host-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    await writeFile(manifestPath, `${JSON.stringify(mutate(manifest))}\n`, "utf8");
    await expect(
      renderWorkspace({
        sourceRoot: resolve("."),
        targetRoot,
        hosts: ["vscode"],
        mode: "check"
      })
    ).rejects.toThrow(/manifest/iu);
  });

  it("treats canonical skills as source assets when rendering into the source repository", async () => {
    const sourceRoot = resolve(".");
    const result = await renderWorkspace({
      sourceRoot,
      targetRoot: sourceRoot,
      hosts: ["vscode", "cursor", "claude"],
      mode: "check"
    });
    expect(result.conflicts).not.toContain(".claude/skills/hve-plan/SKILL.md");
  });
});

describe("host path safety", () => {
  it.each(["../outside", "a/../outside", "a\\b", "/absolute", "a//b", "./a"])(
    "rejects unsafe host path %s",
    (path) => {
      expect(() => normalizeHostRelativePath(path)).toThrow("normalized relative path");
    }
  );

  it("reads, writes, and removes only regular files under the target root", async () => {
    const root = await temporaryRoot();
    await writeHostTextFileAtomic(root, "nested/file.txt", "content");
    expect(await readHostTextFile(root, "nested/file.txt")).toBe("content");
    expect(await readHostTextFile(root, "missing.txt", true)).toBeNull();
    expect(await removeHostFile(root, "missing.txt")).toBe(false);
    expect(await removeHostFile(root, "nested/file.txt")).toBe(true);
    expect(resolveHostPath(root, "nested/file.txt")).toBe(join(root, "nested/file.txt"));
  });

  it("rejects missing required roots, file roots, and directory output targets", async () => {
    const root = await temporaryRoot();
    const fileRoot = join(root, "file-root");
    await writeFile(fileRoot, "content", "utf8");
    await expect(assertSafeHostRoot(join(root, "missing"), true)).rejects.toThrow("does not exist");
    await expect(assertSafeHostRoot(fileRoot, true)).rejects.toThrow("must be a directory");
    await mkdir(join(root, "directory-target"));
    await expect(readHostTextFile(root, "directory-target")).rejects.toThrow("not a file");
    await expect(writeHostTextFileAtomic(root, "directory-target", "content")).rejects.toThrow(
      "not a regular file"
    );
    await expect(removeHostFile(root, "directory-target")).rejects.toThrow("not a regular file");
  });
});

function changeFirstOutput(
  manifest: Record<string, unknown>,
  change: Record<string, unknown>
): Record<string, unknown> {
  const outputs = manifest["outputs"] as Array<Record<string, unknown>>;
  return { ...manifest, outputs: [{ ...outputs[0], ...change }, ...outputs.slice(1)] };
}
