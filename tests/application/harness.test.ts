import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { FileRunStore } from "../../src/adapters/run-store.js";
import { HarnessExitCode } from "../../src/application/contracts.js";
import { createDefaultHarness, createDefaultSubmitRequest } from "../../src/cli/composition.js";

const roots: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function fixture(): Promise<{ root: string; runsRoot: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "hve-run-")));
  roots.push(root);
  const source = join(root, "fixture");
  const runsRoot = join(root, ".hve/runs");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src/Greeting.txt"), "Hello from fixture\n", "utf8");
  await writeFile(join(source, "AGENTS.md"), "# Fixture guidance\n", "utf8");
  return { root: source, runsRoot };
}

describe("HarnessService", () => {
  it("runs the bounded fixture through verified completion and pure replay", async () => {
    const workspace = await fixture();
    const composition = await createDefaultHarness({
      repositoryRoot: resolve("."),
      runsRoot: workspace.runsRoot
    });
    const request = await createDefaultSubmitRequest({
      repositoryRoot: resolve("."),
      sourceFixturePath: workspace.root,
      runsRoot: workspace.runsRoot
    });

    const result = await composition.service.submit(request);
    expect(result.exitCode).toBe(HarnessExitCode.Completed);
    expect(result.projection.status).toBe("completed");
    expect(result.projection.lastSequence).toBe(16);
    expect(await readFile(join(result.descriptor.workspaceRoot, "src/Greeting.txt"), "utf8")).toBe(
      "Hello from HVE-Forge\n"
    );
    expect(await readFile(join(workspace.root, "src/Greeting.txt"), "utf8")).toBe(
      "Hello from fixture\n"
    );

    const replay = await composition.service.replay(result.descriptor.runRoot);
    expect(replay.projection).toEqual(result.projection);
    expect(replay.semanticTraceHash).toBe(result.semanticTraceHash);
    expect(replay.eventCount).toBe(16);
  });

  it.each([
    "after-decision",
    "after-tool-commit",
    "after-verification",
    "after-evaluation"
  ] as const)("resumes safely after %s interruption", async (interruptionPoint) => {
    const workspace = await fixture();
    const composition = await createDefaultHarness({
      repositoryRoot: resolve("."),
      runsRoot: workspace.runsRoot
    });
    const request = await createDefaultSubmitRequest({
      repositoryRoot: resolve("."),
      sourceFixturePath: workspace.root,
      runsRoot: workspace.runsRoot,
      interruptionPoint
    });
    const interrupted = await composition.service.submit(request);
    expect(interrupted.exitCode).toBe(HarnessExitCode.InterruptedFixture);
    const resumed = await composition.service.resume(interrupted.descriptor.runRoot);
    expect(resumed.exitCode).toBe(HarnessExitCode.Completed);
    expect(resumed.projection.status).toBe("completed");
  });

  it("fails replay after event tampering", async () => {
    const workspace = await fixture();
    const composition = await createDefaultHarness({
      repositoryRoot: resolve("."),
      runsRoot: workspace.runsRoot
    });
    const request = await createDefaultSubmitRequest({
      repositoryRoot: resolve("."),
      sourceFixturePath: workspace.root,
      runsRoot: workspace.runsRoot
    });
    const result = await composition.service.submit(request);
    const eventPath = join(result.descriptor.stateRoot, "events.jsonl");
    const events = await readFile(eventPath, "utf8");
    await writeFile(eventPath, events.replace("Prepare isolated workspace", "tampered"), "utf8");
    await expect(composition.service.replay(result.descriptor.runRoot)).rejects.toThrow(
      "hash is invalid"
    );
  });

  it("blocks a policy denial before tool execution", async () => {
    const workspace = await fixture();
    const policyPath = join(workspace.root, "deny-policy.json");
    await writeFile(
      policyPath,
      JSON.stringify({
        schemaVersion: "1.0",
        policyVersion: "1.0.0",
        defaultEffect: "deny",
        defaultRuleId: "default-deny",
        rules: []
      }),
      "utf8"
    );
    const composition = await createDefaultHarness({
      repositoryRoot: resolve("."),
      runsRoot: workspace.runsRoot,
      policyPath
    });
    const request = await createDefaultSubmitRequest({
      repositoryRoot: resolve("."),
      sourceFixturePath: workspace.root,
      runsRoot: workspace.runsRoot
    });
    const result = await composition.service.submit(request);
    expect(result.exitCode).toBe(HarnessExitCode.PolicyDenied);
    expect(result.projection.status).toBe("blocked");
    expect(await readFile(join(workspace.root, "src/Greeting.txt"), "utf8")).toContain("fixture");
  });

  it("supports pause, cancel, retry, fork, stream, and terminal idempotence", async () => {
    const workspace = await fixture();
    const composition = await createDefaultHarness({
      repositoryRoot: resolve("."),
      runsRoot: workspace.runsRoot
    });
    const request = await createDefaultSubmitRequest({
      repositoryRoot: resolve("."),
      sourceFixturePath: workspace.root,
      runsRoot: workspace.runsRoot,
      interruptionPoint: "after-decision"
    });
    const interrupted = await composition.service.submit(request);
    expect(
      (await composition.service.stream(interrupted.descriptor.runRoot, 0)).length
    ).toBeGreaterThan(0);
    await expect(composition.service.stream(interrupted.descriptor.runRoot, -1)).rejects.toThrow(
      RangeError
    );
    const paused = await composition.service.pause(interrupted.descriptor.runRoot);
    expect(paused.exitCode).toBe(HarnessExitCode.InterruptedFixture);
    const cancelled = await composition.service.cancel(interrupted.descriptor.runRoot);
    expect(cancelled.exitCode).toBe(HarnessExitCode.Cancelled);
    expect((await composition.service.cancel(interrupted.descriptor.runRoot)).exitCode).toBe(
      HarnessExitCode.Cancelled
    );
    const retried = await composition.service.retry(interrupted.descriptor.runRoot);
    expect(retried.exitCode).toBe(HarnessExitCode.Completed);
    expect(retried.descriptor.parentRunId).toBe(interrupted.descriptor.runId);
    const forked = await composition.service.fork(retried.descriptor.runRoot);
    expect(forked.exitCode).toBe(HarnessExitCode.Completed);
    expect(forked.descriptor.parentRunId).toBe(retried.descriptor.runId);
    expect((await composition.service.pause(forked.descriptor.runRoot)).exitCode).toBe(
      HarnessExitCode.Completed
    );
  });

  it("rejects a handoff changed after creation", async () => {
    const workspace = await fixture();
    const composition = await createDefaultHarness({
      repositoryRoot: resolve("."),
      runsRoot: workspace.runsRoot
    });
    const request = await createDefaultSubmitRequest({
      repositoryRoot: resolve("."),
      sourceFixturePath: workspace.root,
      runsRoot: workspace.runsRoot,
      interruptionPoint: "after-decision"
    });
    const interrupted = await composition.service.submit(request);
    const handoff = await composition.service.createHandoff(interrupted.descriptor.runRoot);
    await expect(
      composition.service.resumeFromHandoff({ ...handoff, sourceEventHead: "b".repeat(64) })
    ).rejects.toMatchObject({ exitCode: HarnessExitCode.ReplayIntegrityFailure });
    expect((await composition.service.resumeFromHandoff(handoff)).exitCode).toBe(
      HarnessExitCode.Completed
    );
  });

  it("blocks resume when pinned policy content changes", async () => {
    const workspace = await fixture();
    const policyPath = join(workspace.root, "policy.json");
    await writeFile(
      policyPath,
      await readFile(resolve("policies/organization-policy.v1.json"), "utf8"),
      "utf8"
    );
    const composition = await createDefaultHarness({
      repositoryRoot: resolve("."),
      runsRoot: workspace.runsRoot,
      policyPath
    });
    const request = await createDefaultSubmitRequest({
      repositoryRoot: resolve("."),
      sourceFixturePath: workspace.root,
      runsRoot: workspace.runsRoot,
      interruptionPoint: "after-decision"
    });
    const interrupted = await composition.service.submit(request);
    const policy = JSON.parse(await readFile(policyPath, "utf8")) as { policyVersion: string };
    await writeFile(policyPath, JSON.stringify({ ...policy, policyVersion: "1.0.1" }), "utf8");
    await expect(composition.service.resume(interrupted.descriptor.runRoot)).rejects.toMatchObject({
      exitCode: HarnessExitCode.Blocked
    });
  });

  it("rejects caller-forged prompt and skill provenance", async () => {
    const workspace = await fixture();
    const composition = await createDefaultHarness({
      repositoryRoot: resolve("."),
      runsRoot: workspace.runsRoot
    });
    const request = await createDefaultSubmitRequest({
      repositoryRoot: resolve("."),
      sourceFixturePath: workspace.root,
      runsRoot: workspace.runsRoot
    });

    await expect(
      composition.service.submit({
        ...request,
        assets: {
          ...request.assets,
          promptHash: "a".repeat(64),
          skillHashes: ["b".repeat(64)]
        }
      })
    ).rejects.toMatchObject({ exitCode: HarnessExitCode.InvalidInvocation });
  });

  it("rejects a junction in the runtime runs-root path", async () => {
    const workspace = await fixture();
    const outside = await realpath(await mkdtemp(join(tmpdir(), "hve-run-outside-")));
    roots.push(outside);
    const apparentRunsRoot = join(workspace.root, "linked-runs");
    try {
      await symlink(outside, apparentRunsRoot, "junction");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EPERM") return;
      throw error;
    }
    await expect(
      createDefaultHarness({ repositoryRoot: resolve("."), runsRoot: apparentRunsRoot })
    ).rejects.toThrow(/link|reparse/iu);
    expect(await import("node:fs/promises").then(({ readdir }) => readdir(outside))).toEqual([]);
  });

  it("rejects a nested junction used as a trusted prompt source", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "hve-assets-link-")));
    roots.push(root);
    const repositoryRoot = join(root, "repository");
    const outsidePrompts = join(root, "outside-prompts");
    await mkdir(join(repositoryRoot, "config/contracts"), { recursive: true });
    await mkdir(join(repositoryRoot, "evaluation/rubrics"), { recursive: true });
    await mkdir(join(repositoryRoot, "hve/skills/exact-text-replacement"), { recursive: true });
    await mkdir(outsidePrompts, { recursive: true });
    await writeFile(
      join(repositoryRoot, "config/contracts/exact-text-replacement.v1.json"),
      "{}",
      "utf8"
    );
    await writeFile(join(repositoryRoot, "evaluation/rubrics/coding-task.v1.json"), "{}", "utf8");
    await writeFile(
      join(repositoryRoot, "hve/skills/exact-text-replacement/SKILL.md"),
      "---\nname: exact-text-replacement\ndescription: test\n---\n",
      "utf8"
    );
    await writeFile(join(outsidePrompts, "coding-agent.v1.md"), "outside prompt", "utf8");
    try {
      await symlink(outsidePrompts, join(repositoryRoot, "prompts"), "junction");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EPERM") return;
      throw error;
    }

    await expect(
      createDefaultSubmitRequest({
        repositoryRoot,
        sourceFixturePath: repositoryRoot,
        runsRoot: join(root, "runs")
      })
    ).rejects.toThrow(/link|reparse/iu);
  });

  it("rejects linked run metadata before parsing it", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "hve-store-link-")));
    roots.push(root);
    const outsideRun = join(root, "outside-run");
    const apparentRun = join(root, "apparent-run");
    await mkdir(join(outsideRun, "state"), { recursive: true });
    await writeFile(join(outsideRun, "state/run.json"), "not-json", "utf8");
    try {
      await symlink(outsideRun, apparentRun, "junction");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EPERM") return;
      throw error;
    }

    await expect(new FileRunStore().load(apparentRun)).rejects.toThrow(/link|reparse/iu);
  });

  it("blocks resume when a persisted canonical asset changes", async () => {
    const workspace = await fixture();
    const composition = await createDefaultHarness({
      repositoryRoot: resolve("."),
      runsRoot: workspace.runsRoot
    });
    const request = await createDefaultSubmitRequest({
      repositoryRoot: resolve("."),
      sourceFixturePath: workspace.root,
      runsRoot: workspace.runsRoot,
      interruptionPoint: "after-decision"
    });
    const interrupted = await composition.service.submit(request);
    await writeFile(join(interrupted.descriptor.stateRoot, "assets/prompt.md"), "tampered", "utf8");

    await expect(composition.service.resume(interrupted.descriptor.runRoot)).rejects.toMatchObject({
      exitCode: HarnessExitCode.Blocked
    });
  });

  it("recovers an event lease abandoned by a terminated process", async () => {
    const workspace = await fixture();
    const composition = await createDefaultHarness({
      repositoryRoot: resolve("."),
      runsRoot: workspace.runsRoot
    });
    const request = await createDefaultSubmitRequest({
      repositoryRoot: resolve("."),
      sourceFixturePath: workspace.root,
      runsRoot: workspace.runsRoot,
      interruptionPoint: "after-decision"
    });
    const interrupted = await composition.service.submit(request);
    const lockPath = join(interrupted.descriptor.stateRoot, "events.lock");
    const script = [
      'const { writeFileSync } = require("node:fs");',
      "const acquired = new Date();",
      "const lease = { schemaVersion: '1.0', ownerPid: process.pid, acquiredAt: acquired.toISOString(), expiresAt: new Date(acquired.getTime() + 600000).toISOString(), token: 'abandoned-child' };",
      "writeFileSync(process.argv[1], JSON.stringify(lease) + '\\n');"
    ].join(" ");
    await execFileAsync(process.execPath, ["-e", script, lockPath]);

    const resumed = await composition.service.resume(interrupted.descriptor.runRoot);

    expect(resumed.exitCode).toBe(HarnessExitCode.Completed);
  });

  it("does not reclaim a lease owned by a live process", async () => {
    const workspace = await fixture();
    const composition = await createDefaultHarness({
      repositoryRoot: resolve("."),
      runsRoot: workspace.runsRoot
    });
    const request = await createDefaultSubmitRequest({
      repositoryRoot: resolve("."),
      sourceFixturePath: workspace.root,
      runsRoot: workspace.runsRoot,
      interruptionPoint: "after-decision"
    });
    const interrupted = await composition.service.submit(request);
    const acquiredAt = new Date();
    await writeFile(
      join(interrupted.descriptor.stateRoot, "events.lock"),
      `${JSON.stringify({
        schemaVersion: "1.0",
        ownerPid: process.pid,
        acquiredAt: acquiredAt.toISOString(),
        expiresAt: new Date(acquiredAt.getTime() + 600_000).toISOString(),
        token: "live-test"
      })}\n`,
      "utf8"
    );

    await expect(composition.service.resume(interrupted.descriptor.runRoot)).rejects.toThrow(
      "event lease"
    );
  });

  it("recovers an expired lease when its PID has been reused", async () => {
    const workspace = await fixture();
    const composition = await createDefaultHarness({
      repositoryRoot: resolve("."),
      runsRoot: workspace.runsRoot
    });
    const request = await createDefaultSubmitRequest({
      repositoryRoot: resolve("."),
      sourceFixturePath: workspace.root,
      runsRoot: workspace.runsRoot,
      interruptionPoint: "after-decision"
    });
    const interrupted = await composition.service.submit(request);
    const acquiredAt = new Date(Date.now() - 11 * 60_000);
    await writeFile(
      join(interrupted.descriptor.stateRoot, "events.lock"),
      `${JSON.stringify({
        schemaVersion: "1.0",
        ownerPid: process.pid,
        acquiredAt: acquiredAt.toISOString(),
        expiresAt: new Date(acquiredAt.getTime() + 600_000).toISOString(),
        token: "reused-pid"
      })}\n`,
      "utf8"
    );

    const resumed = await composition.service.resume(interrupted.descriptor.runRoot);

    expect(resumed.exitCode).toBe(HarnessExitCode.Completed);
  });

  it("rejects a future-dated event lease", async () => {
    const workspace = await fixture();
    const composition = await createDefaultHarness({
      repositoryRoot: resolve("."),
      runsRoot: workspace.runsRoot
    });
    const request = await createDefaultSubmitRequest({
      repositoryRoot: resolve("."),
      sourceFixturePath: workspace.root,
      runsRoot: workspace.runsRoot,
      interruptionPoint: "after-decision"
    });
    const interrupted = await composition.service.submit(request);
    const acquiredAt = new Date(Date.now() + 365 * 24 * 60 * 60_000);
    await writeFile(
      join(interrupted.descriptor.stateRoot, "events.lock"),
      `${JSON.stringify({
        schemaVersion: "1.0",
        ownerPid: process.pid,
        acquiredAt: acquiredAt.toISOString(),
        expiresAt: new Date(acquiredAt.getTime() + 600_000).toISOString(),
        token: "future-lease"
      })}\n`,
      "utf8"
    );

    await expect(composition.service.resume(interrupted.descriptor.runRoot)).rejects.toThrow(
      /lease values|future/iu
    );
  });

  it("preserves the frozen .NET full-run outcome with current canonical assets", async () => {
    const temporary = await realpath(await mkdtemp(join(tmpdir(), "hve-dotnet-oracle-")));
    roots.push(temporary);
    const expected = JSON.parse(
      await readFile(resolve("tests/fixtures/dotnet-oracle-v1/run.json"), "utf8")
    ) as {
      semanticTraceHash: string;
      legacySkillHash: string;
      sandboxProfile: string;
      eventCount: number;
      targetText: string;
    };
    const composition = await createDefaultHarness({
      repositoryRoot: resolve("."),
      runsRoot: join(temporary, "runs")
    });
    const base = await createDefaultSubmitRequest({
      repositoryRoot: resolve("."),
      sourceFixturePath: resolve("samples/fixture-repo"),
      runsRoot: join(temporary, "runs")
    });
    const result = await composition.service.submit(base);
    const replay = await composition.service.replay(result.descriptor.runRoot);
    expect(replay.eventCount).toBe(expected.eventCount);
    expect(result.descriptor.assets.skillHashes).toEqual(base.assets.skillHashes);
    expect(result.descriptor.assets.skillHashes).not.toContain(expected.legacySkillHash);
    expect(await readFile(join(result.descriptor.workspaceRoot, "src/Greeting.txt"), "utf8")).toBe(
      expected.targetText
    );
  });
});
