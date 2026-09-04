<!-- Purpose: Durable progress log for GitHub issue #2. -->

# Progress: Production AI Coding Harness

**Issue:** https://github.com/jnPiyush/HVE-Forge/issues/2
**Branch:** `feature/2-production-harness`
**Started:** 2026-08-31
**Current checkpoint:** Work
**Active plan:** `docs/execution/plans/EXEC-PLAN-004-cross-surface-execution.md`

## Milestone status

| Milestone | State | Evidence |
|---|---|---|
| Research and repository discovery | Complete | `docs/research/ai-coding-harness-landscape.md` |
| Runtime decision and model council | Complete | `docs/artifacts/adr/ADR-001-harness-runtime.md`, `docs/artifacts/adr/COUNCIL-001-harness-runtime.md` |
| Threat model | Complete for local MVP | `docs/security/ai-coding-harness-threat-model.md` |
| Living plan and work contract | Complete for first slice | `docs/execution/plans/EXEC-PLAN-002-production-harness.md`, active contract |
| Technical specification and schemas | Complete and approved | `docs/artifacts/specs/SPEC-002-production-harness.md`, `schemas/v1/` |
| Runtime implementation | Complete for local fixture scope | Domain/Application/Infrastructure/CLI source |
| Security and recovery verification | Complete for the historical fixture scope; blocked for live end-user scope | Historical 283-test .NET evidence; current Node baseline 221 |
| Provider/MCP/telemetry adapters | Complete for recorded/offline scope | Two provider fixtures, MCP matrix/tests, metadata telemetry |
| CI, operator docs, and release evidence | Complete locally; remote CI pending | Quality workflow, runbooks, `EVIDENCE-002-production-harness.md` |
| Final independent review | Historical fixture review complete; end-user product review blocked | 2026-09-02 functional, security, and release NO-GO reviews |
| Compound capture | Complete | `docs/artifacts/learnings/LEARNING-2.md` |
| Quality loop | Historical loop complete; secure end-user implementation loop active | Baseline 221; high-risk minimum five iterations |

## Cross-editor TypeScript migration

| Milestone | State | Evidence |
|---|---|---|
| Host and industry research | Complete | ADR-003 references and council perspectives |
| Migration architecture and council | Complete | `docs/artifacts/adr/ADR-003-cross-editor-typescript-harness.md`, `docs/artifacts/adr/COUNCIL-003-cross-editor-typescript-harness.md` |
| Technical specification and living plan | Complete | `docs/artifacts/specs/SPEC-003-cross-editor-typescript-harness.md`, `docs/execution/plans/EXEC-PLAN-003-cross-editor-typescript.md` |
| TypeScript renderer and diagnostics | Complete locally | Shared compatibility outputs, clean render check, doctor with zero duplicates |
| TypeScript deterministic kernel | Complete locally | Frozen event and full-run semantic oracle tests pass |
| Node-only CI and .NET decommission | Complete locally; remote CI pending | Node quality workflow exists; active .NET source/build files removed |

## Secure end-user harness expansion

| Milestone | State | Evidence |
|---|---|---|
| End-user release review | Complete - NO-GO | Functional review: 1 Critical, 7 High; security review: 5 High, 4 Medium; release certification: NO-GO |
| Architecture security-order amendment | Complete | ADR-004, council, SPEC-004, and EXEC-PLAN-004 |
| Installed distribution identity | Complete | `src/cli/distribution-root.ts`, `tests/cli/distribution-root.test.ts` (poisoned-target rejection) |
| Safe host profiles | Complete | `tests/hosts/security-readiness.test.ts`; no generated agent grants a native privileged tool |
| Trust envelopes and provider receipts | Complete for trust envelopes | `src/core/trust.ts`, `src/application/context-assembler.ts`; egress receipts remain N/A until a live network provider exists |
| Read/list/search tools and dispatcher | Complete | `src/adapters/workspace-read-tools.ts`, `src/application/tool-dispatcher.ts` |
| Atomic-turn provider and bounded loop | Complete for the demo task shape | `src/application/model-provider.ts`, `src/application/agent-loop.ts`, `src/core/sessions.ts` (schema v2, parallel to frozen schema v1) |
| Evidence freshness | Complete for the schema-v2 completion gate | `src/core/freshness.ts`, `src/adapters/working-tree-fingerprint.ts` (exclusion-aware, fails closed on overflow/links) |
| Native VS Code/Copilot slice | Complete for model-selection and bounded-loop wiring | `src/extension/`, `extensions/vscode/package.json`; native mutation confirmation, chat participant, and a live Extension Development Host smoke test remain open |
| Cowork package | Complete | `src/adapters/cowork-package.ts`, `hve cowork-package` CLI command |
| Release provenance | Complete locally; remote CI pending | Candidate is fully committed on `feature/2-production-harness`; `SECURITY.md`, `CHANGELOG.md`, `check:tracked-input`, `release:digests` added; remote CI has not yet evaluated this exact commit |

## Session observations

### 2026-08-31 - Resume and recovery

- Recovered from an AgentX loop stuck at iteration 0 by cancelling it; no workspace file was reverted.
- Created GitHub issue #2 after confirming no matching issue existed.
- Created local feature branch `feature/2-production-harness` and preserved untracked design files.
- Started a new high-risk quality loop with a five-iteration minimum.
- Confirmed .NET 10.0.111 is installed. Docker and uv are unavailable.
- Confirmed current design selects a local-only deterministic kernel and does not authorize live provider spend, remote writes, arbitrary shell, deployment, or secrets.
- Closed four HIGH and eight MEDIUM pre-implementation findings, persisted their dispositions, and obtained a fresh independent architecture verdict of APPROVED with zero HIGH and zero MEDIUM.
- Implemented a modular .NET 10 harness with no external production-package dependencies.
- Implemented hash-chained events, pure replay, idempotent mutation, four interruption boundaries, handoff/reset, policy/approval gates, context/memory contracts, scoped instructions/skills, two provider fixtures, MCP conformance, telemetry, and CLI lifecycle operations.
- Passed the initial local quality gate: 210 tests; this historical result is superseded by the current 283-test gate below.
- Captured a fresh 16-event demo and verified source preservation, redaction, replay, handoff, archive, hashes, zero tokens, and zero cost.

### 2026-09-01 - Final hardening review

- Reset a stale quality loop into a fresh high-risk five-pass loop while preserving its archived audit history.
- Fixed strict replay fixtures and then added descriptor-to-event binding, mandatory run creation, post-terminal closure, exact evaluation evidence linkage, and completion bindings to the evaluation event/artifact and verification result.
- Replaced the Markdown release contract as evaluator input with a four-criterion JSON runtime contract. The read-only evaluator now requires the complete fixed criterion and rubric sets and named passing verification evidence.
- Made versioned provider JSON fixtures the runtime capability source, added requested/served model and token ceilings, and enforced those ceilings before provider execution.
- Made MCP Tasks fail closed unless both host and request capability flags are present; only `tasks/get` is allowlisted in the offline shape validator.
- Restricted default archives to evidence records, added a content manifest and CLI-published ZIP SHA-256, removed absolute paths from public evidence, and verified edit text/canary exclusion.
- Restricted write-authorized CodeQL publication to trusted main pushes. Pull requests retain the read-only deterministic quality job.
- Corrected the root artifact ignore rule so `docs/artifacts/` is tracked and included in ASCII/secret scans.
- Current local verification: 283/283 tests, zero build warnings/errors, formatter clean, core line/branch coverage above 80 percent, candidate-secret and dependency audits clean, and a 19-component SBOM.
- Real symbolic-link creation returned `IOException` on this Windows account. Injected reparse metadata rejection passed; real NTFS reparse execution and mutation testing remain explicitly unproven locally.

### 2026-09-01 - Cross-editor Node cutover

- Moved canonical skills to `hve/skills`, outside all supported host discovery roots.
- Consolidated supported-host agents and skills into one `.claude/agents` and `.claude/skills` copy recognized by VS Code, Cursor, and Claude Code.
- Retained native `.github/instructions`, `.cursor/rules`, `.claude/rules`, and host routers.
- Added generated-skill provenance and actual discovery-root duplicate detection, including unmanaged compatibility copies.
- Added Cursor `readonly: true` to shared non-editing agent definitions while retaining Claude tool allowlists that VS Code maps natively.
- Removed stale `.github/agents`, `.cursor/agents`, `.agents/skills`, and redundant core-rule outputs through manifest-owned update.
- Verified a clean locked install, 203 tests, aggregate and per-layer coverage above 80 percent in all dimensions, deterministic checked-in host rendering, zero duplicate logical items, zero dependency vulnerabilities, 122 SHA-512 locked packages from approved origins, an exact 223-file package inventory, and a 71-component CycloneDX SBOM with SHA-512 and license evidence.
- Active .NET source, project, solution, props, lock, and SDK pin files are absent. Frozen `.NET` semantic fixtures and historical documents remain intentionally.
- A second strict review reproduced runtime-root junction escape, forged-manifest deletion, folded-rule duplicate bypass, and PID-reuse lease stranding. All four were remediated with adversarial regressions; final clean re-review remains pending.

### 2026-09-02 - End-user release review and secure build start

- Fresh local quality passed with 221 tests, 90.57 percent statements, 85.00 percent branches, every layer above 80 percent, zero vulnerabilities, exact package inventory, and a 71-component SBOM.
- A clean copied candidate passed locked installation and the complete quality gate. Two independent npm packs were byte-identical.
- Packed installation and version output passed, but ordinary initialization failed because target-workspace discovery was incorrectly used to locate trusted distribution assets.
- Independent reviews blocked release as an end-user AI coding harness: the live provider, general tools, multi-turn loop, evidence freshness, extension, Cowork package, and provenance are not implemented.
- Security review found that generated agents receive native write, shell, and web tools outside kernel authority; current host output is declarative, not mediated.
- Started a new high-risk implementation loop with a 221-test baseline and a five-iteration minimum.
- Selected application-owned atomic turns. Distribution trust and safe host profiles come first, followed by trust envelopes, tools, provider, loop, freshness, and then the live VS Code surface.

### 2026-09-03/04 - Slices 6 through 10 implemented and committed

- Confirmed slices 1-5 (distribution identity, safe host profiles, trust envelopes, tools/dispatcher, atomic-turn provider) were already implemented in the untracked candidate with real exit-gate test coverage, ahead of what this log previously recorded.
- Implemented slice 6 (bounded agent loop): a parallel schema-v2 event/projection family that never reinterprets the frozen schema-v1 registry; `AgentLoop` wiring context assembly, the atomic provider, and the tool dispatcher into repeated turns bounded by budgets, oscillation detection (repeated action signature and repeated workspace fingerprint), and a three-strikes failed-fix rule. Found and fixed three real bugs during test-first development: the schema-v2 verification service used the wall clock instead of an injected clock (causing false staleness), the reducer counted any successful tool dispatch as a workspace mutation instead of only writes, and completion re-verified with a different attempt number than the one actually recorded, breaking the evidence binding.
- Implemented slice 7 (evidence freshness): a named `FRESH`/`STALE`/`MISSING` grade and an exclusion-aware working-tree fingerprint that fails closed on bounded-inventory overflow or links, wired into the schema-v2 completion gate.
- Implemented slice 9 (Cowork package) ahead of slice 8, using the Cowork skill-authoring guide to get the exact manifest schema: an installable zip built directly from the canonical skill catalog, shipping only `cowork-eligible: true` skills.
- Implemented slice 8 (VS Code extension): a narrow, fully unit-tested seam over the VS Code Language Model API with zero test performing a live model call; `@types/vscode` was evaluated and rejected because every version available through the configured registry mirror publishes only a legacy SHA-1 integrity hash, which fails this repository's own SHA-512 supply-chain gate, so a local ambient declaration was used instead, exactly as SPEC-004 anticipates for that situation.
- Implemented slice 10 (release hardening): package license/repository/support metadata, `CHANGELOG.md`, `SECURITY.md`, a `check:tracked-input` gate, and a `release:digests` artifact-manifest script wired into CI's package job.
- Committed the entire candidate to `feature/2-production-harness` in three commits (prior uncommitted work, slices 6-7, Cowork, VS Code extension), resolving the release-provenance blocker that the 2026-09-02 review raised: the candidate is no longer untracked.
- Test count grew from 256 (start of session) to 327; `npm run quality` passes end to end except for one transient failure late in the session: the internal audit registry's security-advisory endpoint returned repeated `TF400898` internal errors unrelated to any dependency change (the identical dependency tree passed audit earlier in the same session with zero vulnerabilities).

## Validation ledger

| Time | Command or action | Expected | Observed | Result |
|---|---|---|---|---|
| 2026-08-31 | AgentX loop status | Recoverable state | Prior loop was STUCK at iteration 0 | Recovered by cancel/start |
| 2026-08-31 | GitHub issue search | No duplicate | No harness issue found | Pass |
| 2026-08-31 | `git switch -c feature/2-production-harness` | Isolated feature branch | Branch created, untracked files preserved | Pass |
| 2026-08-31 | Toolchain probe | .NET build tool available | .NET SDK 10.0.111 installed | Pass |
| 2026-08-31 | Temporary xUnit template probe | Determine compatible package pins | xUnit 2.9.3, runner 3.1.4, test SDK 17.14.1, coverlet 6.0.4 | Pass with CI revalidation note |
| 2026-09-01 | `dotnet format HveForge.slnx --verify-no-changes --no-restore` | No formatting drift | 0 diagnostics | Pass |
| 2026-09-01 | `dotnet build HveForge.slnx -c Release --no-restore -warnaserror` | Warning-free build | 0 warnings, 0 errors | Pass |
| 2026-09-01 | `dotnet test HveForge.slnx -c Release --no-build --no-restore` | Full suite green | 283 passed, 0 failed, 0 skipped | Pass |
| 2026-09-01 | `pwsh scripts/Invoke-QualityGate.ps1` | All local release gates green | Coverage, ASCII (149 paths), secrets, dependencies, and 19-component SBOM passed | Pass |
| 2026-09-01 | Fresh fixture run/replay/handoff/archive | Evidence package is deterministic and redacted | 16 events; replay hashes equal; manifest entries valid; canary/edit text absent from archive | Pass |
| 2026-09-01 | `npm ci --ignore-scripts` | Reproducible dependency install without lifecycle scripts | 71 packages added, 72 audited, 0 vulnerabilities | Pass |
| 2026-09-01 | `npm run quality` | Complete Node release gate | 203 tests; coverage 90.44/84.72/98.03/92.34; every layer >=80%; host, ASCII, secrets, supply-chain, audit, exact package, and SBOM checks pass | Pass |
| 2026-09-01 | Host update/check/doctor | One discoverable logical copy per supported host | Clean render, no conflicts, zero duplicates; all hosts correctly report kernel-mediated warnings | Pass |
| 2026-09-03/04 | `npm run test:coverage` | Full suite green with layered coverage | 327 tests pass; every layer (core, application, adapters, hosts, cli) >=80% in all four dimensions | Pass |
| 2026-09-03/04 | `hve agent-run` against the sample fixture | Bounded multi-turn session completes | 3 turns, 2 tool dispatches, status completed, `evidenceFreshness: FRESH` | Pass |
| 2026-09-03/04 | `hve cowork-package` against the canonical skill catalog | Only `cowork-eligible: true` skills ship | `exact-text-replacement` included; five orchestration skills excluded with a named reason | Pass |
| 2026-09-03/04 | `npm run quality` (full gate, repeated) | All local release gates green | 329 exact allowlisted files, 245 ASCII paths, 122 supply-chain packages, 71 SBOM components; audit passed once with 0 vulnerabilities, then hit a persistent `TF400898` internal registry outage on six later retries over ~10 minutes with an unchanged dependency tree | Pass except audit (external outage, not a code defect) |
| 2026-09-03/04 | `git status --porcelain` after three commits | Clean working tree | No output | Pass |

## Active risks and blockers

- Strong OS isolation is unavailable locally because Docker or a microVM backend is absent. The MVP will not register process or network tools.
- Live provider behavior, cost, and cross-provider compatibility cannot be certified without explicit model, budget, and data-governance input beyond the VS Code Copilot vertical slice.
- Remote CI and CodeQL have not executed for this exact commit. Local locked restore and vulnerability audit pass; remote clean-runner evidence remains required before any release.
- Real NTFS reparse creation and mutation testing were unavailable locally and are not claimed as passed.
- Cursor and Claude CLIs are not installed locally, so real product discovery was not smoke-tested; conformance uses official path/frontmatter contracts plus renderer and doctor tests.
- The VS Code extension has not been smoke-tested inside a live Extension Development Host in this environment; native workspace-folder selection, mutation confirmation, and a chat-participant surface remain open.
- Schema-v2 bounded sessions have no mid-session crash recovery (checkpoint/resume); a session runs to a terminal state within one process lifetime.
- SHA-256 event chains prove internal consistency, not authenticity against a writer who can replace all local state. Commit-bound CI attestation and fresh workspace fingerprints remain required.

## Next action

Push `feature/2-production-harness` and open or update the pull request so remote CI (quality matrix, CodeQL, package/SBOM, provenance attestation) evaluates this exact commit. Then prioritize a live Extension Development Host smoke test and native mutation confirmation for the VS Code surface, followed by general (non-exact-replace) work-contract support for the bounded loop. Publication and deployment remain outside current authority.
