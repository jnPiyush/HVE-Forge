import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { repositoryRoot } from "./repository-files.mjs";

const artifactsDir = join(repositoryRoot, "artifacts");
const packagesDir = join(artifactsDir, "packages");
await mkdir(packagesDir, { recursive: true });

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is unavailable; run this script through npm.");

const pack = spawnSync(
  process.execPath,
  [npmCli, "pack", "--ignore-scripts", "--pack-destination", packagesDir, "--json"],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    maxBuffer: 8 * 1_048_576
  }
);
if (pack.status !== 0) throw new Error(`npm pack failed: ${pack.stderr}`);
const packed = JSON.parse(pack.stdout);
const tarballName = packed[0]?.filename;
if (typeof tarballName !== "string") throw new Error("npm pack did not report a tarball filename.");

const coworkZip = join(artifactsDir, "hve-forge-cowork.zip");
const coworkResult = spawnSync(
  process.execPath,
  [
    join(repositoryRoot, "dist/cli/main.js"),
    "cowork-package",
    "--repository-root",
    repositoryRoot,
    "--destination",
    coworkZip
  ],
  { cwd: repositoryRoot, encoding: "utf8", shell: false, windowsHide: true }
);
if (coworkResult.status !== 0) {
  throw new Error(`Cowork package build failed: ${coworkResult.stderr}`);
}

const entries = [
  { name: "npm-package", path: join(packagesDir, tarballName) },
  { name: "cowork-package", path: coworkZip },
  { name: "sbom", path: join(artifactsDir, "sbom.cdx.json") }
];

const manifest = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  artifacts: await Promise.all(
    entries.map(async (entry) => {
      const bytes = await readFile(entry.path);
      return {
        name: entry.name,
        fileName: entry.path.slice(repositoryRoot.length + 1).replaceAll("\\", "/"),
        byteLength: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex")
      };
    })
  )
};

const manifestPath = join(artifactsDir, "digests.json");
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(
  `[PASS] Digest manifest: ${manifest.artifacts.length} artifacts recorded at artifacts/digests.json.`
);
