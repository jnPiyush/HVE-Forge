<!-- Purpose: Living execution plan for the ADR-004 cross-surface harness expansion. -->

# EXEC-PLAN-004: Cross-Surface Harness Expansion

**Issue:** #2
**ADR:** `docs/artifacts/adr/ADR-004-cross-surface-execution.md`
**Spec:** `docs/artifacts/specs/SPEC-004-cross-surface-execution.md`
**Status:** Active

## Purpose

Turn HVE-Forge from a deterministic control plane into a working coding harness across VS Code, Cursor, Claude Code, and Cowork, using GitHub Copilot as the default VS Code provider, adopting proven concepts from AgentX and gstack without adding runtime dependencies to the kernel.

## Alternatives Considered

Recorded before planning, per the pre-plan gate.

1. **Standalone runtime with direct API clients.** Rejected as default: credential custody, spend authorization, and a consent UX the harness would have to build and defend.
2. **MCP server only.** Rejected as the architecture: MCP carries tools but not the instruction, agent, rule, or lifecycle plane, and supplies no model.
3. **Shell out to vendor CLIs.** Rejected as primary: unstable text contract, no typed tool-call protocol, no controllable consent.
4. **Fork or vendor AgentX or gstack.** Rejected: both are process-and-prompt harnesses without a deterministic kernel; adopting concepts preserves the kernel's guarantees.
5. **VS Code extension supplying Copilot, layered over optional API adapters behind one port.** Selected.

## Progress

| Step | Description | Status |
|---|---|---|
| 0 | Research AgentX, gstack, VS Code LM and Tool APIs, Cowork packaging | Complete |
| 0a | ADR-004 and Model Council recorded | Complete |
| 0b | SPEC-004 contracts recorded | Complete |
| 0c | End-user, security, and release review | Complete - NO-GO findings recorded |
| 0d | Security-order amendment and test baseline | In progress - baseline 221 |
| 1 | Installed distribution identity and packed onboarding | Not started |
| 2 | Safe declarative host profiles and honest doctor | Not started |
| 3 | Trust envelopes and bounded context assembly | Not started |
| 4 | Read/list/search tools and immutable dispatcher | Registry complete; adapters not started |
| 5 | Atomic-turn provider contract and recorded compatibility | Not started |
| 6 | Bounded durable agent loop and v2 protocol | Not started |
| 7 | Working-tree fingerprint and evidence freshness | Not started |
| 8 | Native VS Code/Copilot vertical slice | Not started |
| 9 | Cowork package target | Not started |
| 10 | Release hardening and provenance | Not started |
| 11 | Isolation backend and execute-class tools | Deferred pending separate approval |

## Context and Orientation

Current verified state at the start of step 1: 203 tests across 13 files passed; typecheck and lint clean; coverage 90.22 percent statements with all five layers at or above 80 percent; zero runtime dependencies; supply-chain gate passing across 122 packages with SHA-512 and four approved origins.

After the registry landed: 221 tests across 14 files pass at 90.57 percent statements and 85.00 percent branches, with the registry module covering fail-closed admission, snapshot-based validation, deep immutability, and locale-independent ordering.

Fresh end-user release review added five security blockers: packaged initialization reverses distribution and target trust, native host tools bypass the kernel, local evidence is not commit-authenticated or durably fresh, injection controls were scheduled after live retrieval, and almost all candidate files are untracked. Functional review also confirmed that the current runtime cannot perform arbitrary coding work. The local quality baseline remains strong: 221 tests pass, aggregate coverage is 90.57 percent statements and 85.00 percent branches, every production layer exceeds 80 percent, a clean-copy install passes, and repeated npm packs are byte-identical.

## Plan of Work

Sequenced by trust boundary and then blast radius. Each slice is independently testable and rollback-safe. Live model access remains disabled through slice 7.

### Slice 0: Contract correction

Amend the ADR, council, specification, threat model, controls matrix, plan, and progress log so distribution trust and host safety come first, trust envelopes precede live retrieval, provider sends require receipts, v1 replay remains immutable, and v2 owns multi-turn behavior.

Exit gate: documents make no unsupported current-state claim; `check:ascii` and the complete quality chain pass.

### Slice 1: Installed distribution identity

Resolve canonical assets from the installed module location, never from the target workspace. Retain any compatibility argument only as a deprecated workspace/fixture alias, not an authority-root selector. Add a packed-consumer test with an ordinary target and a poisoned lookalike target.

Exit gate: installed `hve init` and `doctor` work from an unrelated consumer without internal paths; poison bytes never reach generated output; runtime dependencies remain zero.

### Slice 2: Safe host profiles

Remove native edit, process, browser, and web tools from default generated agents. Add machine-readable structural and security readiness to doctor. Current profiles are declarative until a mediated runtime is proven.

Exit gate: no generated default agent grants a native privileged capability; doctor cannot report security-ready when mediation is absent or bypass exists; renderer ownership and duplicate checks still pass.

### Slice 3: Trust envelopes

Add immutable origin and trust contracts, bounded context assembly, deterministic elision, and provider-egress intent. Repository text can define task data but cannot become policy, approval, distribution instruction, or tool registration.

Exit gate: every model-bound byte has origin, trust, hash, byte length, and truncation metadata; raw workspace strings are rejected at the model boundary; injection fixtures cannot alter authority.

### Slice 4: Tools and dispatcher

Implement bounded strict-UTF-8 read, directory-list, and literal-search tools. Bind every descriptor one-to-one with a handler in an immutable dispatcher. The dispatcher validates calls from `unknown`, reevaluates policy immediately before effects, enforces cancellation and output bounds, and wraps results as untrusted data. Route exact replacement through the same path.

Initial limits: one MiB source or target files, 64 KiB returned output, 500 directory entries, 200 search matches, 2,000 scanned files, and 16 MiB scanned bytes. Secret-like files, `.git`, and harness-private state are denied.

Exit gate: all four tools execute only through registry admission; unknown, denied, malformed, oversized, traversal, device, ADS, link, and junction inputs cause no handler effect.

### Slice 5: Atomic-turn provider

Generalize the provider to one validated atomic turn containing bounded assistant text, ordered tool calls, normalized usage, finish reason, model identity, and hashes. Preserve `RecordedProvider` behavior and v1 fixture replay. Copilot cost mode is host-managed and never invents monetary cost.

Exit gate: provider output cannot execute tools; malformed or oversized turns fail closed; cancellation propagates; v1 replay performs zero provider calls.

### Slice 6: Durable bounded loop

Create schema-v2 run contracts and one application-owned loop. Before a provider call, validate budgets, assemble context, and flush a receipt. Before a tool effect, validate budgets, resolve admission, reevaluate policy, and dispatch. Stop on completion, cancellation, time, turn, dispatch, token, cost, repeated signature, A-B-A state oscillation, or three failed fixes.

Safe defaults: eight turns, sixteen dispatches, five minutes, provider-capped input, 16,000 output tokens, repeated-signature threshold two, oscillation window six, and no fourth failed fix.

Exit gate: property tests prove invocation counts never exceed limits; every run has one typed terminal reason; interruption/resume duplicates neither provider turns nor effects; v1 replay remains unchanged.

### Slice 7: Evidence freshness

Fingerprint all relevant tracked and untracked regular files with fixed code-owned exclusions. Grade evidence exactly `FRESH`, `STALE`, or `MISSING`. Revalidate inspect, handoff, resume, completion, and archive.

Exit gate: unseen untracked files invalidate evidence; completion and release archive accept `FRESH` only; bounded inventory failures block rather than hash a partial tree.

### Slice 8: Native VS Code/Copilot vertical slice

Add a thin VS Code composition root and provider adapter using host APIs only. Model selection occurs only from a user command or chat request. Content and mutation tools remain private to the HVE loop; only metadata status may be globally contributed. Local file workspaces are the only write-capable scheme, multi-root requires explicit choice, and exact replacement requires native confirmation.

Exit gate: fake-host tests cover empty model selection, cancellation, wrong vendor, stream errors, token limits, receipt failure, no secret access, remote-workspace denial, and canonical tool-ID mapping. A staged extension contains one compiled kernel and no runtime dependencies or bundled `node_modules`.

### Slice 9: Cowork package

Package only instruction-only eligible skills with a strict root manifest and required icon dimensions. No connector or MCP transport ships in the first Cowork artifact.

Exit gate: strict package inventory, folder/frontmatter identity, link rejection, terminal-dependent skill exclusion, and deterministic archive checks pass.

### Slice 10: Release hardening

Add package source/license/support metadata, changelog, security policy, consumer installation and removal guidance, tracked-input gate, installed smoke tests, exact artifact digest manifest, and commit-bound CI provenance. MCP transport, direct providers, network tools, and execute tools remain deferred.

Exit gate: clean immutable commit; packed consumer tests on Windows, Linux, and macOS; quality, CodeQL, package, SBOM, extension, Cowork, independent security, independent functional review, provenance, upgrade, and rollback gates all pass for the same bytes.

## Validation and Acceptance

Every step must leave the repository green on the existing quality chain: toolchain, typecheck, format, lint, coverage, layer coverage, build, boundaries, hosts, ASCII, secrets, supply chain, audit, package inventory, and SBOM.

The acceptance criteria in SPEC-004 section 9 are the authoritative gate list. Criteria are referenced by identifier rather than by range so that adding one cannot silently narrow the gate.

## Idempotence and Recovery

Each slice is independently revertible. Distribution and host-profile rollback uses only manifest-owned generated files. Trust, tools, provider, loop, and freshness features remain disabled unless their slice passes. Schema-v1 history is never rewritten. The extension and Cowork artifacts can be removed without changing the CLI replay path.

If a step fails its exit gate twice, stop and investigate rather than attempting a third fix, per the rule adopted in step 3.

## Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-09-02 | GitHub Copilot via `vscode.lm` is the default VS Code provider | Removes credential custody and spend authorization from the default path while improving adoption |
| 2026-09-02 | Tools are capability-classed, not individually registered | A read tool and a shell tool must not share an admission path |
| 2026-09-02 | Execute class stays unregistered until isolation exists | A real model plus process spawn without a sandbox is the highest-risk configuration in the design |
| 2026-09-02 | Cowork is a package target, not a discovery root | Its managed container has no scan path, no terminal, and consumes an uploaded archive |
| 2026-09-02 | Surfaces are composition roots, never runtimes | Two runtimes would eventually answer the same policy question differently |
| 2026-09-02 | Oscillation and failed-fix controls ship with the loop | Retrofitting them after multi-decision execution widens exposure |
| 2026-09-02 | Capability gates require the literal boolean `true` | A parsed-configuration string such as "false" is truthy and would otherwise open the execute path |
| 2026-09-02 | Descriptors are snapshotted before validation | An accessor-backed descriptor could otherwise report `read` during validation and `execute` during admission |
| 2026-09-02 | Ordering uses code-unit comparison, not `localeCompare` | ICU collation varies by host and would break replay equivalence |
| 2026-09-02 | The extension uses built-in VS Code APIs only, with no runtime dependency and no bundler | Keeps the whole product at zero runtime dependencies so the existing supply-chain gate covers the extension without surface-specific policy |
| 2026-09-02 | The extension loads the same compiled kernel as the CLI rather than resolving an installed package | Closes the kernel-resolution question originally recorded in SPEC-004 section 10; one build means the two surfaces cannot answer a policy question differently |
| 2026-09-02 | Git state is an optional capability that degrades rather than fails | The built-in Git extension is not guaranteed present, and adding a Git library would break the zero-dependency rule |
| 2026-09-02 | Application-owned atomic turns, not provider-owned loops | One deterministic state machine retains policy, budget, receipt, replay, and recovery authority |
| 2026-09-02 | Distribution assets resolve module-relatively | A target repository is untrusted input and must never select harness authority |
| 2026-09-02 | Trust envelopes precede read/search output reaching a live model | Local repository prompt injection can corrupt code and evidence without any network tool |
| 2026-09-02 | Multi-turn execution uses schema v2 while v1 remains replay-only | Existing event meanings and frozen parity evidence cannot be silently reinterpreted |
| 2026-09-02 | Fingerprints include relevant untracked files | Release and coding work routinely includes new files; omitting them creates false freshness |
| 2026-09-02 | Default host artifacts are declarative and grant no native privileged tools | Prompt guidance cannot enforce policy over ambient host tools |

## Surprises and Discoveries

- The VS Code Language Model API does not support system messages, so the existing prompt contract needs restructuring rather than a direct mapping.
- Copilot model consent requires a user-initiated action, which constrains where model selection can occur in the extension lifecycle.
- Cowork forbids terminal access and package installation inside its container, which makes some existing skills unrenderable for that target rather than merely degraded.
- gstack's evidence model grades freshness against a working-tree fingerprint; the current evidence model proves a check ran but not that it still applies.
- Independent review of the first slice found two fail-open defects that unit tests alone would not have surfaced: truthiness-based capability gates and an accessor-based validation bypass. Both are now closed and regression-tested.
- The VS Code extension API covers more of the harness surface than expected, including MCP server discovery, secret storage, token counting, diagnostics, and Git state. It does not cover everything: workspace-wide text search, diff computation, telemetry transport, and contributed tool input validation have no usable native API, and Git state depends on an optional built-in extension. All of these are recorded as limits in SPEC-004 section 6.5 rather than solved with a package.
- A packed install succeeds, but ordinary initialization fails because the CLI discovers its own distribution assets from the target directory. An undocumented internal package-root override works, proving packaging bytes are present but trust resolution is reversed.
- Default generated agents currently receive native shell, edit, and web tools. Structural render success is not security readiness, and current host profiles must be treated as declarative.
- Local quality and byte-reproducible packages are not release provenance while candidate source remains untracked and remote CI has not evaluated it.

## Artifacts and Notes

- ADR: `docs/artifacts/adr/ADR-004-cross-surface-execution.md`
- Council: `docs/artifacts/adr/COUNCIL-004-cross-surface-execution.md`
- Spec: `docs/artifacts/specs/SPEC-004-cross-surface-execution.md`

## Outcomes and Retrospective

Pending. To be completed after slice 10 and independent release certification.
