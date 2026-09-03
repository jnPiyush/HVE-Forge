export type HostId = "generic" | "vscode" | "cursor" | "claude";
export type EnforcementTier = "full" | "kernel-mediated" | "declarative";
export type CatalogKind = "agent" | "rule" | "router" | "skill";

export interface AgentCatalogItem {
  readonly logicalId: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly source: string;
  readonly tools: readonly string[];
  readonly userInvocable: boolean;
}

export interface RuleCatalogItem {
  readonly logicalId: string;
  readonly slug: string;
  readonly description: string;
  readonly source: string;
  readonly applyTo: string;
  readonly alwaysApply: boolean;
}

export interface RouterCatalogItem {
  readonly logicalId: string;
  readonly source: string;
  readonly targets: Partial<Readonly<Record<HostId, string>>>;
}

export interface SkillCatalogItem {
  readonly logicalId: string;
  readonly name: string;
  readonly source: string;
}

export interface HostCatalog {
  readonly schemaVersion: "1.0";
  readonly rendererVersion: string;
  readonly agents: readonly AgentCatalogItem[];
  readonly rules: readonly RuleCatalogItem[];
  readonly routers: readonly RouterCatalogItem[];
  readonly skills: readonly SkillCatalogItem[];
}

export interface HostProfile {
  readonly schemaVersion: "1.0";
  readonly hostId: HostId;
  readonly profileVersion: string;
  readonly enforcementTier: EnforcementTier;
  readonly agentDirectory: string | null;
  readonly agentSuffix: string | null;
  readonly ruleDirectory: string | null;
  readonly ruleSuffix: string | null;
  readonly scanRoots: readonly string[];
  readonly supportsHooks: boolean;
  readonly hooksEnabledByDefault: false;
  readonly supportsMcp: boolean;
}

export interface PlannedOutput {
  readonly logicalId: string;
  readonly kind: CatalogKind;
  readonly path: string;
  readonly sourcePath: string;
  readonly sourceHash: string;
  readonly content: string;
  readonly outputHash: string;
  readonly hosts: readonly HostId[];
}

export interface ManifestOutput {
  readonly logicalId: string;
  readonly kind: CatalogKind;
  readonly path: string;
  readonly sourcePath: string;
  readonly sourceHash: string;
  readonly outputHash: string;
  readonly hosts: readonly HostId[];
}

export interface HostManifest {
  readonly schemaVersion: "1.0";
  readonly rendererVersion: string;
  readonly profileVersions: Readonly<Record<string, string>>;
  readonly outputs: readonly ManifestOutput[];
}
