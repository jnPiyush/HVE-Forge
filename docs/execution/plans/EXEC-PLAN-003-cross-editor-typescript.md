<!-- Inputs: issue 2, cross-editor TypeScript migration, 2026-09-01, GitHub Copilot -->

# Execution Plan: Cross-Editor TypeScript Migration

**Issue:** https://github.com/jnPiyush/HVE-Forge/issues/2
**Date:** 2026-09-01
**Status:** Complete locally; remote validation pending
**Decision:** `docs/artifacts/adr/ADR-003-cross-editor-typescript-harness.md`

## Purpose / Big Picture

Make HVE-Forge useful from VS Code/Copilot, Cursor, Claude Code, and Agent Skills clients without requiring .NET. Preserve the proven deterministic safety model while moving canonical authoring, host rendering, diagnostics, and eventually the kernel to TypeScript/Node.

## Progress

- [x] Current repository and migration surface inventoried.
- [x] gstack, AgentX, official host documentation, and Agent Skills specification researched.
- [x] Alternatives and three council perspectives recorded.
- [x] ADR-003 selected canonical assets plus typed host renderers and a TypeScript kernel.
- [x] TypeScript package and strict build scaffolded.
- [x] Host profile schema, renderer, manifest, drift check, and doctor implemented.
- [x] Canonical agents, rules, routers, and skills established.
- [x] VS Code, Cursor, and Claude outputs generated and validated by parser/renderer conformance.
- [x] TypeScript deterministic core and parity corpus implemented.
- [x] Node-only quality gate and cross-platform CI implemented.
- [x] .NET active path removed after parity approval.
- [ ] Remote three-OS CI and installed Cursor/Claude CLI smoke tests completed.
- [ ] Final independent review and compound capture completed.

Iteration 1 established the strict Node package and deterministic core. Canonical JSON,
event integrity, run projection, policy, approvals, completion, and continuity now pass
31 focused and property tests. Host rendering and file adapters remain active work.

Iteration 2 added seven focused agents, three scoped rules, six portable skills, four
versioned host profiles, provenance-stamped rendering, safe ownership checks, duplicate
discovery diagnostics, and explicit advisory enforcement reporting. The slice passes
strict typecheck, lint, and 35 tests.

Iteration 3 added a local JSON Schema 2020-12 subset validator, negotiated MCP request and
response validation, HMAC-bound cursor state, cross-platform path rejection, link-safe
workspace hashing, and crash-reconcilable exact replacement. Strict typecheck, lint, and
59 tests pass.

Iteration 4 completed the Node-only cutover and single-copy host discovery design. Canonical
skills now live under `hve/skills`; VS Code, Cursor, and Claude share one `.claude/agents`
and `.claude/skills` copy while retaining native scoped rules. Actual discovery-root scans
detect unmanaged duplicate copies.

Iteration 5 addressed the strict independent review: renderer source/target paths reject links
and junctions; prompt and skill provenance is derived from trusted bytes; all 15 event payloads
are exhaustively validated; standards-compatible nested skill metadata and unmanaged rule
duplicates are covered; stale event leases recover after owner death or validated bounded expiry; checked-in host drift,
per-layer coverage, exact package inventory, approved package origins, SHA-512 integrity, and SBOM
license/hash evidence are mechanically gated. After the second review remediations, the local
quality gate passes 203 tests with 90.44 percent statements, 84.72 percent branches, 98.03
percent functions, and 92.34 percent
lines. Every production layer exceeds 80 percent in all four dimensions.

## Alternatives Considered

1. Independent host trees: fastest initially, rejected for unavoidable drift.
2. `.github` canonical source only: excellent for VS Code, insufficient for native Cursor/Claude capabilities.
3. Declarative-only harness: portable but cannot provide trustworthy policy, replay, or evidence.
4. Canonical assets plus typed renderers and TypeScript kernel: selected.
5. MCP-only: useful optional tool plane, incomplete instruction and lifecycle plane.

## Context and Orientation

- Existing deterministic contracts: `schemas/v1`, `policies`, `config`, `evaluation`, `prompts`.
- Existing editor assets: `.github/agents`, `.github/instructions`, `.github/skills`, `.github/prompts`.
- Existing portable skill: `skills/exact-text-replacement`.
- Runtime replacement surface: `src`, `tests`, build props, solution, scripts, and CI.
- Local runtime state under `.agentx` and `.hve` is not migration source and must not be copied into generated host artifacts.

## Plan of Work

### Phase 1: Toolchain and Renderer

Create a Node 24 ESM TypeScript package with strict checking and no runtime dependency in the renderer core. Add host profiles for VS Code, Cursor, Claude Code, and generic Agent Skills. Implement deterministic `render`, `render --check`, and `doctor` commands plus a manifest.

### Phase 2: Canonical Customizations

Move authored skills to `hve/skills`, outside every host scan path. Define a compact canonical agent set focused on orchestration, planning, implementation, review, security, QA, release, and documentation. Define rules and routers once. Render one Claude-compatible agent/skill copy shared by VS Code, Cursor, and Claude, plus host-specific scoped rules, with explicit capability-loss reports and duplicate-discovery checks.

### Phase 3: TypeScript Kernel

Port canonical JSON, event integrity, reducer/replay, deny-by-default policy, budgets, completion gate, redaction, and filesystem store behind dependency-inward modules. Validate every external payload. Preserve schema and event compatibility.

### Phase 4: Quality and Operations

Port required checks to Node. Add strict typecheck, lint/format, tests, coverage, secret scan, dependency audit, SBOM, render drift, link/frontmatter validation, and multi-OS CI. Keep repository hooks disabled until the user opts in.

### Phase 5: Cutover and Cleanup

Run the frozen corpus against both implementations, resolve every divergence, switch CLI/docs/CI to Node, then remove .NET source and build files. Preserve frozen semantic vectors and historical documents rather than shipping two active runtimes.

## Validation and Acceptance

- `npm ci --ignore-scripts`, strict typecheck, lint, tests, and build pass.
- Each host profile validates and renders byte-identical output.
- Generated drift and unknown user-owned file conflicts fail closed.
- Each host resolves one logical skill/agent/rule instance.
- `doctor` reports Full, Kernel-mediated, or Declarative plus per-control status.
- Canonical JSON golden vectors and replay corpus match frozen expectations.
- Core, application, adapters, hosts, and CLI each exceed 80 percent statement, branch, function, and line coverage.
- Secret, dependency, provenance, SBOM, and multi-OS gates pass.
- Final reviewer reports zero Critical, HIGH, and MEDIUM findings.

## Idempotence and Recovery

Compute the complete output plan before mutation, then replace each manifest-owned file through a same-directory temporary file and rename. Never overwrite an unknown file or a generated file whose current hash does not match the previous manifest. Multi-file updates are rerunnable rather than transactionally atomic: after interruption, rerun `update`, inspect conflicts, then require a clean `render --check` and `doctor`. Git history and the prior package are the rollback source after .NET removal.

## Risks

- Host formats and precedence may change.
- Repository hooks may execute untrusted code or fail open.
- Node filesystem and numeric semantics may diverge from the frozen runtime.
- Compatibility copies may create duplicate discovery and context cost.
- A broad agent catalog may become expensive and ambiguous; start with focused roles and add only evidence-backed roles.

## Outcomes and Retrospective

Local implementation, Node-only migration, package validation, and parser-level host conformance are complete. Remote Windows/macOS/Linux CI, CodeQL, build attestation, package provenance, and real installed Cursor/Claude discovery remain unverified release evidence.
