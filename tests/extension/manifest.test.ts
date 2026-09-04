import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateManifestToolContributions } from "../../src/extension/tool-contribution.js";

async function manifest(): Promise<Record<string, unknown>> {
  const content = await readFile(resolve("extensions/vscode/package.json"), "utf8");
  return JSON.parse(content) as Record<string, unknown>;
}

describe("VS Code extension manifest", () => {
  it("declares a valid engines.vscode floor and a module entry point", async () => {
    const value = await manifest();
    expect(value["name"]).toBe("hve-forge-vscode");
    const engines = value["engines"] as Record<string, string>;
    expect(engines["vscode"]).toMatch(/^\^1\.\d+\.\d+$/);
    expect(value["main"]).toBe("../../dist/extension/activate.js");
    expect(value["type"]).toBe("module");
  });

  it("declares no runtime dependency", async () => {
    const value = await manifest();
    expect(value["dependencies"]).toBeUndefined();
  });

  it("contributes only the run-session command, with no languageModelTools entries", async () => {
    const value = await manifest();
    const contributes = value["contributes"] as Record<string, unknown>;
    const commands = contributes["commands"] as readonly { readonly command: string }[];
    expect(commands.map((entry) => entry.command)).toEqual(["hve-forge.runAgentSession"]);
    const tools =
      (contributes["languageModelTools"] as readonly { readonly name: string }[] | undefined) ?? [];
    expect(() => validateManifestToolContributions(tools)).not.toThrow();
    expect(tools).toEqual([]);
  });
});
