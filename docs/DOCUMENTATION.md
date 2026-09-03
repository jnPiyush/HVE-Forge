# HVE-Forge Documentation Index

## Start here

- `README.md` - product overview, host support, setup, and safety boundary.
- `docs/operations/RUNBOOK.md` - rendering, lifecycle, recovery, archive, and troubleshooting.
- `docs/artifacts/adr/ADR-003-cross-editor-typescript-harness.md` - current decision.
- `docs/artifacts/specs/SPEC-003-cross-editor-typescript-harness.md` - implementation contract.
- `docs/execution/plans/EXEC-PLAN-003-cross-editor-typescript.md` - living migration plan.

## Canonical cross-editor assets

- `hve/catalog.json` - stable logical IDs and canonical source map.
- `hve/hosts/` - versioned VS Code, Cursor, Claude, and generic capability profiles.
- `hve/agents/`, `hve/rules/`, `hve/routers/` - host-neutral authored content.
- `hve/skills/` - host-neutral canonical Agent Skills source.

## Architecture and research

- `docs/research/ai-coding-harness-landscape.md`
- `docs/artifacts/adr/ADR-003-cross-editor-typescript-harness.md`
- `docs/artifacts/adr/COUNCIL-003-cross-editor-typescript-harness.md`
- `docs/artifacts/adr/ADR-001-harness-runtime.md`
- `docs/artifacts/adr/COUNCIL-001-harness-runtime.md`
- `docs/security/ai-coding-harness-threat-model.md`

## Contracts and schemas

- `docs/execution/contracts/CONTRACT-001-policy-replay-kernel.md`
- `config/contracts/exact-text-replacement.v1.json` - exact schema-validated runtime evaluator contract.
- `schemas/README.md`
- `protocols/mcp/2026-07-28/conformance-matrix.json`

## Security and operations

- `docs/security/INCIDENT-RESPONSE.md`
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

## Verification

- `npm run quality` - complete local Node quality gate.
- `npm run test:coverage` - tests and 80 percent coverage thresholds.
- `npm run check:hosts` - deterministic host rendering and discovery validation.
- `npm run check:boundaries` - architecture dependency direction.
- `.github/workflows/hve-quality.yml`
