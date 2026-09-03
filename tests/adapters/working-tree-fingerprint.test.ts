import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeWorkingTreeFingerprint,
  FingerprintError
} from "../../src/adapters/working-tree-fingerprint.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hve-fingerprint-"));
  roots.push(root);
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src/a.ts"), "export const a = 1;\n", "utf8");
  await writeFile(join(root, "README.md"), "# demo\n", "utf8");
  return root;
}

describe("computeWorkingTreeFingerprint", () => {
  it("is stable for an unchanged tree and changes when a relevant file changes", async () => {
    const root = await tree();
    const first = await computeWorkingTreeFingerprint(root);
    const second = await computeWorkingTreeFingerprint(root);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.fileCount).toBe(2);

    await writeFile(join(root, "src/a.ts"), "export const a = 2;\n", "utf8");
    const third = await computeWorkingTreeFingerprint(root);
    expect(third.fingerprint).not.toBe(first.fingerprint);
  });

  it("ignores fixed exclusions so dependency and build churn never affects the fingerprint", async () => {
    const root = await tree();
    const baseline = await computeWorkingTreeFingerprint(root);

    await mkdir(join(root, "node_modules/some-package"), { recursive: true });
    await writeFile(
      join(root, "node_modules/some-package/index.js"),
      "module.exports = {};",
      "utf8"
    );
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "dist/bundle.js"), "console.log(1);", "utf8");
    await mkdir(join(root, ".git"), { recursive: true });
    await writeFile(join(root, ".git/HEAD"), "ref: refs/heads/main\n", "utf8");
    await mkdir(join(root, "coverage"), { recursive: true });
    await writeFile(join(root, "coverage/summary.json"), "{}", "utf8");

    const afterChurn = await computeWorkingTreeFingerprint(root);
    expect(afterChurn.fingerprint).toBe(baseline.fingerprint);
    expect(afterChurn.fileCount).toBe(baseline.fileCount);
  });

  it("includes untracked-style new files, not only pre-existing ones", async () => {
    const root = await tree();
    const baseline = await computeWorkingTreeFingerprint(root);
    await writeFile(join(root, "src/new-untracked.ts"), "export const b = 2;\n", "utf8");
    const updated = await computeWorkingTreeFingerprint(root);
    expect(updated.fingerprint).not.toBe(baseline.fingerprint);
    expect(updated.fileCount).toBe(baseline.fileCount + 1);
  });

  it("fails closed on a bounded inventory overflow rather than hashing a partial tree", async () => {
    const root = await tree();
    await expect(computeWorkingTreeFingerprint(root, { maximumFiles: 1 })).rejects.toThrow(
      FingerprintError
    );
  });

  it("fails closed on a symbolic link inside the tree", async () => {
    const root = await tree();
    try {
      await symlink(join(root, "README.md"), join(root, "src/link.md"));
    } catch {
      return; // Symlink creation can require elevation on this platform; skip rather than fail.
    }
    await expect(computeWorkingTreeFingerprint(root)).rejects.toThrow(FingerprintError);
  });

  it("rejects a non-positive maximumFiles option", async () => {
    const root = await tree();
    await expect(computeWorkingTreeFingerprint(root, { maximumFiles: 0 })).rejects.toThrow(
      RangeError
    );
  });
});
