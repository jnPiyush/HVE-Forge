import { describe, expect, it } from "vitest";
import {
  globallyContributedTools,
  resolveAlias,
  resolveCanonicalId,
  TOOL_CONTRIBUTIONS,
  ToolContributionError,
  validateManifestToolContributions
} from "../../src/extension/tool-contribution.js";

describe("tool contribution mapping", () => {
  it("maps every canonical workspace tool to a unique hve_ prefixed alias", () => {
    for (const contribution of TOOL_CONTRIBUTIONS) {
      expect(contribution.alias).toMatch(/^hve_[a-zA-Z]+$/);
      expect(resolveAlias(contribution.canonicalId)).toBe(contribution.alias);
      expect(resolveCanonicalId(contribution.alias)).toBe(contribution.canonicalId);
    }
  });

  it("rejects unknown aliases and canonical ids", () => {
    expect(() => resolveCanonicalId("unknown_alias")).toThrow(ToolContributionError);
    expect(() => resolveAlias("workspace.unknown_tool")).toThrow(ToolContributionError);
  });

  it("contributes no globally invokable tool in this release", () => {
    expect(globallyContributedTools()).toEqual([]);
  });

  it("accepts an empty manifest tool list", () => {
    expect(() => validateManifestToolContributions([])).not.toThrow();
  });

  it("fails closed if a manifest tries to globally expose a private workspace-mutation tool", () => {
    expect(() => validateManifestToolContributions([{ name: "hve_replaceExactText" }])).toThrow(
      "must not be globally contributed"
    );
  });

  it("fails closed on a manifest entry with an unknown alias", () => {
    expect(() => validateManifestToolContributions([{ name: "hve_doSomethingElse" }])).toThrow(
      "unknown tool alias"
    );
  });
});
