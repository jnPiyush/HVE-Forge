import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { repositoryFiles, repositoryRoot } from "./repository-files.mjs";

const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /gh[opusr]_[A-Za-z0-9]{30,}/,
  /(api[_-]?key|client[_-]?secret|password)\s*[:=]\s*["'][^"']{12,}["']/i
];
const findings = [];

for (const relativePath of repositoryFiles()) {
  const path = join(repositoryRoot, relativePath);
  const metadata = await stat(path);
  if (!metadata.isFile()) continue;
  if (metadata.size > 2 * 1_048_576) {
    findings.push(`${relativePath}: exceeds 2 MiB scanner limit`);
    continue;
  }
  const content = await readFile(path, "utf8").catch(() => null);
  if (content === null) {
    findings.push(`${relativePath}: could not be read`);
    continue;
  }
  for (const pattern of patterns) {
    if (pattern.test(content)) findings.push(`${relativePath}: matched ${pattern.source}`);
  }
}

if (findings.length > 0) {
  throw new Error(`Candidate credentials found:\n${findings.join("\n")}`);
}
console.log("[PASS] Secret-pattern scan: no candidate credentials found.");
