# HVE-Forge Documentation Index

## Start here

- `README.md` - product overview, host support, setup, and safety boundary.
- `docs/operations/RUNBOOK.md` - rendering, lifecycle, recovery, archive, and troubleshooting.
- `docs/artifacts/adr/ADR-004-cross-surface-execution.md` - current cross-surface decision.
- `docs/artifacts/specs/SPEC-004-cross-surface-execution.md` - bounded loop, freshness, VS Code, and Cowork contracts.
- `docs/execution/plans/EXEC-PLAN-004-cross-surface-execution.md` - living cross-surface execution plan.
- `CHANGELOG.md` - notable changes by milestone.
- `SECURITY.md` - vulnerability reporting and supported scope.

## Canonical cross-editor assets

- `hve/catalog.json` - stable logical IDs and canonical source map.
- `hve/hosts/` - versioned VS Code, Cursor, Claude, and generic capability profiles.
- `hve/agents/`, `hve/rules/`, `hve/routers/` - host-neutral authored content.
- `hve/skills/` - host-neutral canonical Agent Skills source; mark `cowork-eligible: true` to ship a skill in the Cowork package.
- `extensions/vscode/package.json` - VS Code extension manifest (points at the shared `dist/extension/` build).

## Architecture and research

- `docs/research/ai-coding-harness-landscape.md`
- `docs/artifacts/adr/ADR-003-cross-editor-typescript-harness.md`, `docs/artifacts/adr/COUNCIL-003-cross-editor-typescript-harness.md`
- `docs/artifacts/adr/ADR-004-cross-surface-execution.md`, `docs/artifacts/adr/COUNCIL-004-cross-surface-execution.md`
- `docs/artifacts/adr/ADR-001-harness-runtime.md`, `docs/artifacts/adr/COUNCIL-001-harness-runtime.md`
- `docs/security/ai-coding-harness-threat-model.md`

## Contracts and schemas

- `docs/execution/contracts/CONTRACT-001-policy-replay-kernel.md`
- `config/contracts/exact-text-replacement.v1.json` - exact schema-validated runtime evaluator contract (shared by schema v1 and v2).
- `schemas/README.md`
- `schemas/v2/session-event.schema.json` - schema-v2 bounded-loop event envelope and payloads.
- `protocols/mcp/2026-07-28/conformance-matrix.json`

## Security and operations

- `docs/security/INCIDENT-RESPONSE.md`
- `docs/security/CONTROLS-MATRIX.md`
- `SECURITY.md`
- `docs/operations/UPGRADE.md`
- `docs/operations/OBSERVABILITY.md`
- `docs/evaluation/EVALUATION-STRATEGY.md`

## Versioned runtime assets

- `prompts/`
- `hve/skills/`
- `hve/`
- `policies/`
- `evaluation/rubrics/`
- `config/providers/`
- `config/contracts/`
- `config/cowork/` - default Cowork package icons.

## Verification

- `npm run quality` - complete local Node quality gate.
- `npm run test:coverage` - tests and 80 percent coverage thresholds.
- `npm run check:hosts` - deterministic host rendering and discovery validation.
- `npm run check:boundaries` - architecture dependency direction.
- `npm run release:check` - tracked-input gate, full quality gate, and artifact digest manifest, for a release candidate only.
- `.github/workflows/hve-quality.yml`
