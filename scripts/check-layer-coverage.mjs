import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { repositoryRoot } from "./repository-files.mjs";

const summary = JSON.parse(
  await readFile(join(repositoryRoot, "coverage", "coverage-summary.json"), "utf8")
);
const metrics = ["statements", "branches", "functions", "lines"];
const groups = ["core", "application", "adapters", "hosts", "cli"];
const failures = [];

for (const group of groups) {
  const entries = Object.entries(summary).filter(([path]) =>
    path.replaceAll("\\", "/").includes(`/src/${group}/`)
  );
  if (entries.length === 0) throw new Error(`Coverage group has no files: ${group}.`);
  const results = [];
  for (const metric of metrics) {
    const total = entries.reduce((sum, [, value]) => sum + value[metric].total, 0);
    const covered = entries.reduce((sum, [, value]) => sum + value[metric].covered, 0);
    const percentage = total === 0 ? 100 : (covered * 100) / total;
    results.push(`${metric}=${percentage.toFixed(2)}%`);
    if (percentage < 80) failures.push(`${group}.${metric}=${percentage.toFixed(2)}%`);
  }
  console.log(`[INFO] Coverage ${group}: ${results.join(", ")}.`);
}

if (failures.length > 0) {
  throw new Error(`Layer coverage below 80%: ${failures.join(", ")}.`);
}
console.log("[PASS] Layer coverage: every production layer is at least 80% in all dimensions.");
