import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { repositoryRoot } from "./repository-files.mjs";

const packageJson = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
const lock = JSON.parse(await readFile(join(repositoryRoot, "package-lock.json"), "utf8"));
const nodeVersion = process.versions.node;

if (!nodeVersion.startsWith("24.")) {
  throw new Error(`Node 24 LTS is required; observed ${nodeVersion}.`);
}
if (packageJson.packageManager !== "npm@11.9.0") {
  throw new Error("packageManager must pin npm@11.9.0.");
}
if (packageJson.dependencies !== undefined && Object.keys(packageJson.dependencies).length > 0) {
  throw new Error("The runtime dependency budget is zero.");
}
for (const [name, version] of Object.entries(packageJson.devDependencies ?? {})) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Development dependency must use an exact version: ${name}@${version}.`);
  }
}
if (lock.lockfileVersion !== 3 || lock.packages?.[""]?.version !== packageJson.version) {
  throw new Error("package-lock.json is missing, stale, or unsupported.");
}
if (process.env.npm_config_ignore_scripts !== "true") {
  const npmrc = await readFile(join(repositoryRoot, ".npmrc"), "utf8");
  if (!/^ignore-scripts=true$/m.test(npmrc)) {
    throw new Error("npm lifecycle scripts must be disabled.");
  }
}

console.log(
  `[PASS] Toolchain: Node ${nodeVersion}, ${packageJson.packageManager}, exact lockfile.`
);
