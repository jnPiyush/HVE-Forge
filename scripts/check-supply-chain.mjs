import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { repositoryRoot } from "./repository-files.mjs";

const APPROVED_REGISTRY = "https://packagefeedproxy.microsoft.io/npm/";
const APPROVED_TARBALL_HOSTS = new Set([
  "ms-feed-2.pkgs.visualstudio.com",
  "ms-feed-12.pkgs.visualstudio.com",
  "ms-feed-17.pkgs.visualstudio.com",
  "ms-feed-25.pkgs.visualstudio.com"
]);
const APPROVED_TARBALL_PATH = "/1es-public/_packaging/npm-public/npm/registry/";
const npmrc = await readFile(join(repositoryRoot, ".npmrc"), "utf8");
const registry = npmrc
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .find((line) => line.startsWith("registry="))
  ?.slice("registry=".length);
if (registry !== APPROVED_REGISTRY) {
  throw new Error(`Project registry must be pinned to ${APPROVED_REGISTRY}.`);
}
if (!/^ignore-scripts=true$/mu.test(npmrc)) {
  throw new Error("Project dependency lifecycle scripts must be disabled.");
}

const packageJson = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
const lock = JSON.parse(await readFile(join(repositoryRoot, "package-lock.json"), "utf8"));
if (
  lock.lockfileVersion !== 3 ||
  lock.name !== packageJson.name ||
  lock.version !== packageJson.version
) {
  throw new Error("The npm lockfile identity or version is invalid.");
}
const root = lock.packages?.[""];
for (const [name, version] of Object.entries(packageJson.devDependencies ?? {})) {
  if (root?.devDependencies?.[name] !== version) {
    throw new Error(`Direct dependency is not exactly pinned in the lockfile: ${name}.`);
  }
}

const violations = [];
const origins = new Set();
let packageCount = 0;
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  if (path === "") continue;
  packageCount += 1;
  if (typeof entry.resolved !== "string" || typeof entry.integrity !== "string") {
    violations.push(`${path}: missing resolved URL or integrity`);
    continue;
  }
  const url = new URL(entry.resolved);
  origins.add(url.hostname);
  if (
    url.protocol !== "https:" ||
    !APPROVED_TARBALL_HOSTS.has(url.hostname) ||
    !url.pathname.startsWith(APPROVED_TARBALL_PATH)
  ) {
    violations.push(`${path}: unapproved package origin ${url.origin}`);
  }
  if (!entry.integrity.startsWith("sha512-")) {
    violations.push(`${path}: integrity must use SHA-512`);
  }
  if (typeof entry.license !== "string" || entry.license.trim() === "") {
    violations.push(`${path}: license metadata is missing`);
  }
}
if (packageCount === 0 || violations.length > 0) {
  throw new Error(`Dependency supply-chain violations:\n${violations.join("\n")}`);
}
console.log(
  `[PASS] Supply chain: ${packageCount} exact packages, SHA-512 integrity, lifecycle scripts disabled, approved origins ${[...origins].sort().join(", ")}.`
);
