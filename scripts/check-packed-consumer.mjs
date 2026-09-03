import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repositoryRoot } from "./repository-files.mjs";

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is unavailable; run this check through npm.");

const root = await mkdtemp(join(tmpdir(), "hve-packed-consumer-"));
try {
  const packDirectory = join(root, "pack");
  const consumer = join(root, "consumer");
  const target = join(consumer, "target");
  await Promise.all([
    mkdir(packDirectory, { recursive: true }),
    mkdir(join(target, "hve"), { recursive: true })
  ]);
  await writeFile(
    join(consumer, "package.json"),
    '{"name":"hve-packed-consumer","private":true,"version":"1.0.0"}\n',
    "utf8"
  );
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

  const pack = runNpm(
    ["pack", "--ignore-scripts", "--pack-destination", packDirectory, "--json"],
    repositoryRoot
  );
  const report = JSON.parse(pack.stdout)[0];
  if (!report || typeof report.filename !== "string")
    throw new Error("npm pack report is invalid.");
  const tarball = join(packDirectory, report.filename);
  runNpm(
    ["install", tarball, "--ignore-scripts", "--offline", "--no-audit", "--no-fund"],
    consumer
  );

  const installedRoot = join(consumer, "node_modules", "@hve-forge", "cli");
  const main = join(installedRoot, "dist", "cli", "main.js");
  const version = runNode(main, ["--version"], consumer);
  if (version.stdout.trim() !== "hve 0.2.0")
    throw new Error("Installed version output is invalid.");

  const initialized = runNode(
    main,
    ["init", "--target-root", target, "--hosts", "vscode"],
    consumer
  );
  const initResult = JSON.parse(initialized.stdout);
  if (initResult.clean !== true || initResult.type !== "init") {
    throw new Error("Installed init did not report a clean result.");
  }
  const generated = await Promise.all([
    readFile(join(target, "AGENTS.md"), "utf8"),
    readFile(join(target, ".claude", "agents", "hve-engineer.md"), "utf8"),
    readFile(join(target, ".hve", "host-manifest.json"), "utf8")
  ]);
  if (generated.some((value) => value.includes("TARGET_POISON_SENTINEL"))) {
    throw new Error("Target-controlled distribution content reached generated output.");
  }

  const doctorResult = runNode(
    main,
    ["doctor", "--target-root", target, "--hosts", "vscode"],
    consumer,
    [11]
  );
  const doctor = JSON.parse(doctorResult.stdout);
  if (doctor.structuralOk !== true || doctor.securityReadiness !== "advisory") {
    throw new Error("Installed doctor did not report clean advisory rendering.");
  }

  const run = JSON.parse(
    runNode(main, ["run", "--runs-root", join(consumer, "runs")], consumer).stdout
  );
  if (run.status !== "completed" || run.exitCode !== 0) {
    throw new Error("Installed default fixture did not complete.");
  }

  console.log(
    `[PASS] Packed consumer: installed ${report.filename}; version, poisoned-target init, doctor, and default fixture passed.`
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

function runNpm(argumentsValue, cwd) {
  return run(process.execPath, [npmCli, ...argumentsValue], cwd);
}

function runNode(main, argumentsValue, cwd, additionalStatuses = []) {
  return run(process.execPath, [main, ...argumentsValue], cwd, additionalStatuses);
}

function run(command, argumentsValue, cwd, additionalStatuses = []) {
  const result = spawnSync(command, argumentsValue, {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    maxBuffer: 8 * 1_048_576,
    env: { ...process.env, npm_config_ignore_scripts: "true" }
  });
  if (result.status !== 0 && !additionalStatuses.includes(result.status)) {
    throw new Error(
      `${command} ${argumentsValue.join(" ")} failed (${String(result.status)}): ${result.stderr || result.stdout}`
    );
  }
  return result;
}
