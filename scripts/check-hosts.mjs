import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectHostWorkspace, renderWorkspace } from "../dist/hosts/index.js";
import { repositoryRoot } from "./repository-files.mjs";

const hosts = ["vscode", "cursor", "claude"];
const first = await mkdtemp(join(tmpdir(), "hve-host-check-a-"));
const second = await mkdtemp(join(tmpdir(), "hve-host-check-b-"));
try {
  await renderWorkspace({ sourceRoot: repositoryRoot, targetRoot: first, hosts, mode: "write" });
  await renderWorkspace({ sourceRoot: repositoryRoot, targetRoot: second, hosts, mode: "write" });
  const check = await renderWorkspace({
    sourceRoot: repositoryRoot,
    targetRoot: first,
    hosts,
    mode: "check"
  });
  const doctor = await inspectHostWorkspace(repositoryRoot, first, hosts);
  const workspaceCheck = await renderWorkspace({
    sourceRoot: repositoryRoot,
    targetRoot: repositoryRoot,
    hosts,
    mode: "check"
  });
  const workspaceDoctor = await inspectHostWorkspace(repositoryRoot, repositoryRoot, hosts);
  const firstManifest = await readFile(join(first, ".hve/host-manifest.json"), "utf8");
  const secondManifest = await readFile(join(second, ".hve/host-manifest.json"), "utf8");
  if (
    !check.clean ||
    !doctor.structuralOk ||
    doctor.securityReadiness !== "advisory" ||
    doctor.duplicates.length > 0 ||
    !workspaceCheck.clean ||
    !workspaceDoctor.structuralOk ||
    workspaceDoctor.securityReadiness !== "advisory" ||
    workspaceDoctor.duplicates.length > 0 ||
    firstManifest !== secondManifest
  ) {
    throw new Error("Host render is dirty, duplicated, non-deterministic, or unsupported.");
  }
  console.log(
    `[PASS] Hosts: deterministic generated and checked-in output; ${doctor.hosts.length} declarative profiles; security readiness remains advisory.`
  );
} finally {
  await Promise.all([
    rm(first, { recursive: true, force: true }),
    rm(second, { recursive: true, force: true })
  ]);
}
