/**
 * Canonical-ID-to-VS-Code-alias mapping for `languageModelTools` contributions (SPEC-004
 * section 6.4). Canonical dot-separated tool IDs remain the only identity policy evaluates;
 * a VS-Code-compatible alias is a display-and-registration detail that always maps back to
 * exactly one canonical ID.
 *
 * Every workspace-content and mutation tool is `global: false`: it is registered with the
 * extension's own private tool-calling surface for the HVE-owned bounded loop, and it is never
 * placed in the manifest's `contributes.languageModelTools`, so Copilot's own agent mode cannot
 * invoke it directly and bypass HVE budgets, receipts, policy, or confirmation. This release
 * contributes no globally invokable tool at all -- the metadata-only status tool the
 * specification allows is a reserved, not-yet-implemented slot -- which is a strictly safer
 * choice than shipping one prematurely.
 */
export interface ToolContribution {
  readonly canonicalId: string;
  readonly alias: string;
  readonly global: boolean;
}

const ALIAS_PATTERN = /^hve_[a-zA-Z]+$/;

export const TOOL_CONTRIBUTIONS: readonly ToolContribution[] = Object.freeze([
  Object.freeze({ canonicalId: "workspace.read_file", alias: "hve_readFile", global: false }),
  Object.freeze({
    canonicalId: "workspace.list_directory",
    alias: "hve_listDirectory",
    global: false
  }),
  Object.freeze({ canonicalId: "workspace.search_text", alias: "hve_searchText", global: false }),
  Object.freeze({
    canonicalId: "workspace.replace_exact_text",
    alias: "hve_replaceExactText",
    global: false
  })
]);

for (const contribution of TOOL_CONTRIBUTIONS) {
  if (!ALIAS_PATTERN.test(contribution.alias)) {
    throw new Error(`Tool contribution alias is malformed: ${contribution.alias}.`);
  }
}
if (new Set(TOOL_CONTRIBUTIONS.map((entry) => entry.alias)).size !== TOOL_CONTRIBUTIONS.length) {
  throw new Error("Tool contribution aliases must be unique.");
}
if (
  new Set(TOOL_CONTRIBUTIONS.map((entry) => entry.canonicalId)).size !== TOOL_CONTRIBUTIONS.length
) {
  throw new Error("Tool contribution canonical IDs must be unique.");
}

export class ToolContributionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ToolContributionError";
  }
}

export function resolveCanonicalId(alias: string): string {
  const match = TOOL_CONTRIBUTIONS.find((entry) => entry.alias === alias);
  if (match === undefined) throw new ToolContributionError(`Unknown tool alias: ${alias}.`);
  return match.canonicalId;
}

export function resolveAlias(canonicalId: string): string {
  const match = TOOL_CONTRIBUTIONS.find((entry) => entry.canonicalId === canonicalId);
  if (match === undefined) {
    throw new ToolContributionError(`Unknown canonical tool id: ${canonicalId}.`);
  }
  return match.alias;
}

export function globallyContributedTools(): readonly ToolContribution[] {
  return TOOL_CONTRIBUTIONS.filter((entry) => entry.global);
}

/**
 * Validates a manifest's `contributes.languageModelTools` array against the contribution table.
 * Fails closed on an unknown alias and, critically, on any workspace-content or mutation tool
 * that the manifest attempts to expose globally.
 */
export function validateManifestToolContributions(
  entries: readonly { readonly name: string }[]
): void {
  for (const entry of entries) {
    const match = TOOL_CONTRIBUTIONS.find((candidate) => candidate.alias === entry.name);
    if (match === undefined) {
      throw new ToolContributionError(`Manifest references an unknown tool alias: ${entry.name}.`);
    }
    if (!match.global) {
      throw new ToolContributionError(
        `Tool ${entry.name} (${match.canonicalId}) must not be globally contributed.`
      );
    }
  }
}
