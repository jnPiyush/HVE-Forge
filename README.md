# HVE-Forge

HVE-Forge is a deterministic, cross-editor engineering harness for AI coding agents. It gives VS Code/Copilot, Cursor, Claude Code, and Agent Skills-compatible clients one workflow vocabulary while keeping policy, replay, evidence, and completion outside the model.

Version 0.2 is implemented in strict TypeScript on Node 24. The runtime has zero production package dependencies and registers no live model, shell, process, network, browser, secret, remote-write, or deployment tool.

## Why HVE-Forge

- Canonical agents, rules, routers, and portable Agent Skills.
- Typed host profiles and deterministic native artifact rendering.
- Generated-file provenance, drift detection, conflict protection, and duplicate checks.
- Deny-by-default policy and exact high-risk approval contracts.
- SHA-256 hash-chained events, pure replay, bounded execution, and crash recovery.
- Confined idempotent file mutation with path, link, UTF-8, and receipt validation.
- Fresh evidence and independent read-only completion evaluation.
- Locked dependencies, disabled lifecycle scripts, multi-OS CI, SBOM, and provenance.

## Host support

| Host | Native outputs | Portable skills | Current enforcement |
|---|---|---|---|
| VS Code/Copilot | `.claude/agents`, `.github/instructions`, `.github/copilot-instructions.md`, `extensions/vscode/` | `.claude/skills` | Kernel-mediated |
| Cursor | `.claude/agents`, `.cursor/rules` | `.claude/skills` | Kernel-mediated |
| Claude Code | `.claude/agents`, `.claude/rules`, `CLAUDE.md` | `.claude/skills` | Kernel-mediated |
| Other Agent Skills clients | `AGENTS.md` | `.agents/skills` when rendered alone | Declarative |
| Microsoft 365 Copilot Cowork | `hve cowork-package` archive (package render target, not a discovery root) | `skills/<name>/SKILL.md` for `cowork-eligible: true` skills only | Declarative |

Repository hooks are not enabled automatically. Native host tools can bypass a local CLI, so `doctor` reports the actual tier instead of claiming a sandbox that the host cannot provide.

## Requirements

- Node.js 24 LTS; the development patch is pinned in `.node-version`.
- npm 11.9.0, pinned in `package.json`.
- Git for repository quality scans.

Docker, Python, .NET, and live-provider credentials are not required.

## Build and verify

```powershell
npm ci --ignore-scripts
npm run quality
```

The quality gate performs strict type checking, deterministic formatting, semantic linting, aggregate and per-layer 80 percent coverage enforcement, dependency-direction validation, checked-in host drift and duplicate checks, ASCII and candidate-secret scans, SHA-512 lock integrity and approved-origin validation, dependency audit, exact package inventory validation, and CycloneDX SBOM generation.

## Configure an editor workspace

```powershell
npm run build
node dist/cli/main.js init --target-root C:\path\to\repository --hosts vscode,cursor,claude
node dist/cli/main.js doctor --target-root C:\path\to\repository --hosts vscode,cursor,claude
node dist/cli/main.js render --check --target-root C:\path\to\repository --hosts vscode,cursor,claude
```

`update` rerenders manifest-owned files and removes only orphans that exactly match independently rendered trusted output. It never overwrites unknown files or locally edited generated files.

## Run the deterministic fixture

```powershell
node dist/cli/main.js run --repository-root . --quiet
```

The command copies the source fixture into an isolated run root, performs one policy-approved exact replacement, verifies the final workspace and protected source, evaluates completion with a read-only evaluator, and emits a metadata-only JSON result.

```text
hve init|render|update [--target-root PATH] [--hosts vscode,cursor,claude]
hve render --check [--target-root PATH]
hve doctor [--target-root PATH]
hve run|submit [--fixture PATH] [--target PATH] [--expected TEXT] [--replacement TEXT]
hve inspect|stream|pause|resume|cancel|retry|fork|replay RUN_ROOT
hve instructions --workspace PATH --target RELATIVE_PATH
hve skills [--root PATH] [--activate NAME]
hve agent-run [--fixture PATH] [--target PATH] [--expected TEXT] [--replacement TEXT] [--max-turns N] [--max-tool-dispatches N]
hve cowork-package [--skills-root PATH] [--destination PATH] [--color-icon PATH] [--outline-icon PATH]
hve handoff RUN_ROOT --destination PATH
hve reset HANDOFF_PATH
hve archive RUN_ROOT --destination PATH
hve approval --action TEXT --class CLASS --resource RESOURCE
hve mcp
```

## Run the bounded multi-turn agent loop

```powershell
node dist/cli/main.js agent-run --repository-root .
```

The command runs the schema-v2 bounded agent loop (`docs/artifacts/specs/SPEC-004-cross-surface-execution.md` section 4) against the sample fixture: it assembles trust-enveloped context, requests bounded turns from a scripted multi-turn provider, dispatches tool calls sequentially through the same policy-gated dispatcher, verifies and evaluates the result, and reports the session's status, stop reason, and `evidenceFreshness` grade as JSON. The VS Code extension runs the identical loop with a live GitHub Copilot model in place of the scripted provider.

## Package Cowork skills

```powershell
node dist/cli/main.js cowork-package --repository-root . --destination hve-forge-cowork.zip
```

Builds an installable Microsoft 365 Copilot Cowork plugin package from the canonical skill catalog: a manifest, 192x192 and 32x32 icons, and one folder per skill explicitly marked `cowork-eligible: true` in its frontmatter, all at the archive root. Skills that assume host execution (build, test, or security-scan commands) are excluded rather than rendered in a degraded form, because Cowork's managed container has no terminal.

## VS Code extension

`extensions/vscode/` is a thin manifest over the same compiled kernel the CLI uses (`dist/extension/`). It contributes one command, "HVE-Forge: Run Bounded Agent Session", backed by a narrow, unit-tested seam over the VS Code Language Model API restricted to the Copilot vendor. It has zero runtime dependencies, no bundler, and contributes no globally invokable tool. Native workspace-folder selection, mutation confirmation, and a chat-participant surface are tracked follow-up work; this extension has not been smoke-tested inside a live Extension Development Host in this environment.

## Install and remove

This package has not yet been published to a registry. Once published, install and remove it like any scoped npm package:

```powershell
npm install --global @hve-forge/cli
hve doctor --target-root .

npm uninstall --global @hve-forge/cli
```

Local run and session data live only under the ignored `.hve/` directory of whichever workspace you run `hve` in; removing the package does not remove that data, and removing `.hve/` never affects the package installation.

## Architecture

```text
Canonical catalog -> typed host renderer -> native editor artifacts

CLI -> adapters -> application -> deterministic core
                 hosts -> deterministic core
```

The application owns ports. Concrete filesystem, policy, schema, provider, tool, telemetry, and persistence adapters are wired only by the CLI composition root. A mechanical import-boundary check prevents dependency drift.

Canonical authoring lives only in `hve/`, outside every host discovery path. For a multi-host workspace, agents and skills render once in Claude-compatible format because VS Code and Cursor explicitly support `.claude/agents` and `.claude/skills`. Stable logical IDs, generated provenance, actual discovery-root scans, and the host manifest detect duplicate discovery, including known unmanaged compatibility copies.

## Security boundary

HVE-Forge confines one known file operation to a copied workspace; it is not a container, microVM, operating-system sandbox, or defense against a privileged concurrent local actor. Repository instructions and hooks are untrusted. Unsupported capabilities fail closed or are labeled advisory.

Before adding live providers or higher-risk tools, require an updated threat model, exact human approval, credential and data-governance decisions, an isolation backend, adapter conformance tests, and independent security review.

## Documentation

- [Documentation index](docs/DOCUMENTATION.md)
- [Cross-editor ADR](docs/artifacts/adr/ADR-003-cross-editor-typescript-harness.md)
- [Cross-surface execution ADR](docs/artifacts/adr/ADR-004-cross-surface-execution.md)
- [Technical specification (cross-editor)](docs/artifacts/specs/SPEC-003-cross-editor-typescript-harness.md)
- [Technical specification (cross-surface execution)](docs/artifacts/specs/SPEC-004-cross-surface-execution.md)
- [Operations runbook](docs/operations/RUNBOOK.md)
- [Security controls](docs/security/CONTROLS-MATRIX.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

## Explicitly unsupported

- Live (non-recorded) model provider calls beyond the VS Code Copilot vertical slice, and provider-neutral production claims.
- Arbitrary command, process, network, or browser tools; execute-class tools remain unregistered until an isolation backend is approved.
- Container or microVM isolation.
- Automatic installation of executable repository hooks.
- Mid-session crash recovery (checkpoint/resume) for schema-v2 bounded sessions.
- Multi-tenant identity, deployment, release publication, and data-residency guarantees.
