import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { repositoryRoot } from "./repository-files.mjs";

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is unavailable; run this command through npm.");
const result = spawnSync(process.execPath, [npmCli, "sbom", "--sbom-format", "cyclonedx"], {
  cwd: repositoryRoot,
  encoding: "utf8",
  shell: false,
  windowsHide: true,
  maxBuffer: 8 * 1_048_576,
  env: { ...process.env, npm_config_ignore_scripts: "true" }
});
if (result.status !== 0) throw new Error(`npm sbom failed: ${result.stderr}`);
const sbom = JSON.parse(result.stdout);
if (sbom.bomFormat !== "CycloneDX" || !Array.isArray(sbom.components)) {
  throw new Error("npm produced an invalid CycloneDX SBOM.");
}
const incomplete = sbom.components.filter(
  (component) =>
    !Array.isArray(component.hashes) ||
    !component.hashes.some((hash) => hash.alg === "SHA-512") ||
    !Array.isArray(component.licenses) ||
    component.licenses.length === 0
);
if (incomplete.length > 0) {
  throw new Error(
    `SBOM components lack SHA-512 or license evidence: ${incomplete.map((item) => item.name).join(", ")}.`
  );
}
const artifacts = join(repositoryRoot, "artifacts");
await mkdir(artifacts, { recursive: true });
await writeFile(join(artifacts, "sbom.cdx.json"), `${JSON.stringify(sbom, null, 2)}\n`, "utf8");
console.log(`[PASS] SBOM: ${sbom.components.length} CycloneDX components.`);
