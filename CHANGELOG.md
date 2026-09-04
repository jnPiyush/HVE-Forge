# Changelog

All notable changes to HVE-Forge are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project has not yet
published a versioned release to a registry, so entries are grouped by the
in-repository milestones tracked in `docs/execution/plans/EXEC-PLAN-004-cross-surface-execution.md`.

## [0.2.0] - Unreleased

### Added

- Deterministic TypeScript kernel: hash-chained schema-v1 events, pure replay, policy
  engine, tool registry, trust envelopes, and canonical JSON hashing.
- Cross-editor host rendering for VS Code, Cursor, Claude Code, and generic Agent
  Skills clients, with drift detection and duplicate-discovery checks.
- Installed-distribution identity resolution and safe declarative host profiles.
- A read/list/search/replace tool registry and an immutable dispatcher enforcing
  deny-by-default policy at admission and immediately before every effect.
- An atomic-turn model provider contract with a recorded fixture double
  (`RecordedProvider`) preserving legacy single-decision replay unchanged.
- **Bounded multi-turn agent loop** (schema v2): a parallel event/projection family
  (`session-events.ts`, `sessions.ts`) that never reinterprets the frozen schema-v1
  registry; an `AgentLoop` wiring context assembly, the atomic provider, and the tool
  dispatcher into repeated turns bounded by turn/dispatch/token budgets, oscillation
  detection (repeated action signature and repeated workspace fingerprint), and a
  three-strikes failed-fix rule, terminating on exactly one of six typed reasons.
- **Evidence freshness**: a `FRESH`/`STALE`/`MISSING` grade and an exclusion-aware
  working-tree fingerprint that fails closed on bounded-inventory overflow or links,
  wired into the schema-v2 completion gate and surfaced in CLI output.
- **Cowork package target**: builds an installable zip (manifest, 192x192 color icon,
  32x32 outline icon, and `skills/<name>/SKILL.md` folders) directly from the
  canonical skill catalog; a skill ships only when explicitly marked
  `cowork-eligible: true`.
- **VS Code extension surface**: a composition root sharing the same compiled kernel
  as the CLI, a narrow testable seam over the VS Code Language Model API restricted to
  the Copilot vendor, and a canonical-tool-ID-to-VS-Code-alias contribution mapping
  that contributes zero tools globally in this release.
- New CLI commands: `hve agent-run` (runs a bounded multi-turn demo session) and
  `hve cowork-package` (builds the Cowork plugin archive).
- Release-readiness scripts: `check:tracked-input` (working tree fully committed) and
  `release:digests` (SHA-256 manifest over the packed tarball, Cowork package, and SBOM).
- `SECURITY.md` and this changelog.

### Fixed

- `scripts/check-package.mjs` incorrectly expected every `src/**/*.ts` file to emit
  its own compiled output; ambient `.d.ts` declaration files never do.
- Schema-v2 reducer (`src/core/sessions.ts`) hardening found by an independent code
  review: `wall_clock_exhausted` previously had no validation and accepted a forged
  claim with zero elapsed time; `decision_budget_exhausted` recognized only the turn
  budget, crashing `AgentLoop` on ordinary tool-dispatch-budget exhaustion;
  `verification.recorded` required a workspace mutation, crashing on a turn that
  correctly finishes with zero tool calls; and `evaluation.recorded`/
  `session.completed` hash-chain bindings were enforced only by `replaySession`'s own
  duplicate logic, not by `applySessionEvent`, the path the live loop actually uses.
  `AgentLoop`'s event-append path also now validates each event through the reducer
  before writing it to the durable log, so a rejected event can never be persisted.

### Known limitations

- The VS Code extension has not been smoke-tested inside a live Extension Development
  Host in this environment; native workspace-folder selection, mutation confirmation,
  a chat-participant surface, and MCP server discovery remain follow-up work.
- Bounded schema-v2 sessions run to a terminal state within one process lifetime;
  mid-session crash recovery (checkpoint/resume) is not yet implemented for schema v2.
- No live (non-recorded) model provider, process/execute-class tool, or network tool
  is registered. See the README "Explicitly unsupported" section.
