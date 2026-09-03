# HVE-Forge Upgrade and Compatibility

## Versioned surfaces

The runtime, events, schemas, policy, prompt, skill, tool schema, evaluator rubric, provider adapter, MCP baseline, telemetry mapping, and package version independently. Every run records exact versions and content hashes.

## Safe upgrade procedure

1. Create a feature branch and capture the pre-change passing-test baseline.
2. Review upstream release notes, license, security advisories, and API/schema changes.
3. Update one versioned surface at a time.
4. Regenerate `package-lock.json` only through a reviewed exact-version update with lifecycle scripts disabled.
5. Re-run provider/MCP contract fixtures and schema parity tests.
6. Replay old sanitized fixtures; unsupported major versions must fail explicitly.
7. Compare the versioned eval suite on identical fixtures, budgets, and environment.
8. Run `npm ci --ignore-scripts`, `npm run quality`, and independent review.
9. Publish a new immutable package; do not replace an existing version.

## Host profile changes

Changes to host scan paths, frontmatter, hooks, or permissions require a profile version bump, renderer snapshots, duplicate-discovery checks, and `doctor` output review. Generated files are updated through `hve update`, never by editing them directly. An unknown required host capability must fail rendering or be explicitly degraded to advisory behavior.

## Node and npm changes

Only supported Node LTS releases are eligible. Update `.node-version`, `engines`, CI, and the documented baseline together. Keep direct package versions exact, production dependencies at zero unless separately approved, `ignore-scripts=true`, a clean high-severity audit, package allowlist checks, and a CycloneDX SBOM.

## Model/provider changes

Live provider adapters are not enabled in version 0.1. Before enabling or switching a model, record requested alias, served immutable snapshot when available, date, capability matrix, prompt hash, effort, limits, usage, latency, and price source. A primary and fallback from different providers must pass the same contract and eval suite. Unsupported features must be explicit.

## Protocol changes

MCP is pinned to the 2026-07-28 baseline. A newer revision requires a separate conformance matrix and compatibility tests. Optional Tasks, Skills, and Apps stay disabled unless negotiated and security-reviewed. Do not revive deprecated Roots, Sampling, Logging, legacy SSE, or dynamic-client-registration assumptions.

## Schema migration

Additive compatible changes remain within v1 only when old readers remain correct. Any change to hashing, required semantics, event meaning, trust policy, or validation requires a new major schema directory plus an explicit replay/migration tool. Never silently reinterpret stored events.
