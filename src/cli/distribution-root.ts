import { resolve } from "node:path";
import { canonicalizeJson, sha256Hex } from "../core/canonical-json.js";
import { assertSafeHostRoot, readHostTextFile } from "../hosts/path-safety.js";

const PACKAGE_NAME = "@hve-forge/cli";
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+$/;

export interface DistributionIdentity {
  readonly root: string;
  readonly packageName: typeof PACKAGE_NAME;
  readonly packageVersion: string;
  readonly catalogHash: string;
}

export function defaultDistributionRoot(): string {
  return resolve(import.meta.dirname, "../..");
}

export async function loadDistributionIdentity(
  candidateRoot = defaultDistributionRoot()
): Promise<DistributionIdentity> {
  const root = resolve(candidateRoot);
  await assertSafeHostRoot(root, true);
  const [packageText, catalogText] = await Promise.all([
    readHostTextFile(root, "package.json"),
    readHostTextFile(root, "hve/catalog.json")
  ]);
  const packageValue = parseObject(packageText, "package metadata");
  const catalogValue = parseObject(catalogText, "host catalog");
  if (packageValue["name"] !== PACKAGE_NAME) {
    throw new Error(`Distribution package name must be ${PACKAGE_NAME}.`);
  }
  const packageVersion = packageValue["version"];
  if (typeof packageVersion !== "string" || !SEMVER.test(packageVersion)) {
    throw new Error("Distribution package version must be semantic versioning.");
  }
  if (catalogValue["rendererVersion"] !== packageVersion) {
    throw new Error("Distribution catalog version does not match the package version.");
  }
  return Object.freeze({
    root,
    packageName: PACKAGE_NAME,
    packageVersion,
    catalogHash: sha256Hex(canonicalizeJson(catalogText as string))
  });
}

export function assertDistributionOverride(
  requestedRoot: string | undefined,
  identity: DistributionIdentity
): void {
  if (requestedRoot !== undefined && resolve(requestedRoot) !== identity.root) {
    throw new TypeError(
      "--repository-root cannot select distribution assets; it must match the installed package."
    );
  }
}

function parseObject(value: string | null, name: string): Record<string, unknown> {
  if (value === null) throw new Error(`${name} is missing.`);
  const parsed = JSON.parse(canonicalizeJson(value)) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${name} must be an object.`);
  }
  return parsed as Record<string, unknown>;
}
