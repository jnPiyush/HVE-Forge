import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { repositoryFiles, repositoryRoot } from "./repository-files.mjs";

const allowed = {
  core: new Set(["core"]),
  application: new Set(["application", "core"]),
  adapters: new Set(["adapters", "application", "core"]),
  hosts: new Set(["hosts", "core"]),
  cli: new Set(["cli", "hosts", "adapters", "application", "core"])
};
const violations = [];

for (const relativePath of repositoryFiles().filter((path) => /^src\/.+\.ts$/.test(path))) {
  const importerLayer = relativePath.split("/")[1];
  if (!(importerLayer in allowed)) continue;
  const content = await readFile(join(repositoryRoot, relativePath), "utf8");
  const imports = content.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g);
  for (const match of imports) {
    const specifier = match[1];
    if (specifier === undefined || specifier.startsWith("node:")) continue;
    if (!specifier.startsWith(".")) {
      violations.push(
        `${relativePath}: production import is not Node built-in or relative: ${specifier}`
      );
      continue;
    }
    const resolved = resolve(dirname(join(repositoryRoot, relativePath)), specifier);
    const target = relative(join(repositoryRoot, "src"), resolved).split(sep);
    const targetLayer = target[0];
    if (targetLayer === undefined || !allowed[importerLayer].has(targetLayer)) {
      violations.push(
        `${relativePath}: ${importerLayer} cannot import ${targetLayer ?? specifier}`
      );
    }
  }
}

if (violations.length > 0) {
  throw new Error(`Dependency direction violations:\n${violations.join("\n")}`);
}
console.log("[PASS] Dependency direction: core <- application <- adapters <- CLI.");
