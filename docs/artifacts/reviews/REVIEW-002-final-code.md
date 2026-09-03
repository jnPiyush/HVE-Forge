<!-- Purpose: Durable final implementation review and remediation register for issue #2. -->

# Review: Production Harness Implementation

**Issue:** https://github.com/jnPiyush/HVE-Forge/issues/2
**Reviewer:** AgentX Reviewer (independent subagent)
**Date:** 2026-08-31
**Initial verdict:** CHANGES REQUESTED
**Initial counts:** Critical 0, High 8, Medium 6, Low 4

## High findings

| ID | Finding | Required remediation | Status |
|---|---|---|---|
| H1 | Mutable run metadata can redefine confinement roots. | Derive/validate physical roots from caller run root and reject mismatch/reparse. | Resolved with root derivation checks and hostile metadata tests. |
| H2 | Mutable verification/evaluation internals can be forged on resume. | Content-address and cross-check artifacts against event payloads before use. | Resolved with event-bound artifact hashes and forged-artifact E2E tests. |
| H3 | Evaluator does not consume objective, contract, or rubric. | Evaluate pinned contract criteria and rubric against immutable evidence; remove fabricated scores. | Resolved for bounded fixture contract: exact contract/rubric hashes and criterion-derived scores. |
| H4 | Raw expected/replacement content is public. | Persist only hashes/redacted values and add argument/archive canary tests. | Resolved; public tool record contains only path and content hashes. |
| H5 | Time/token/cost and repeated-action claims are not operational. | Enforce real available limits and narrow unsupported loop claims. | Resolved for one-decision fixture: elapsed and usage enforced, checkpoint usage persisted; generalized loop claim removed. |
| H6 | Replay accepts semantically impossible histories. | Enforce event state, ordering, linkage, cardinality, and completion prerequisites. | Resolved with pure reducer prerequisite and completion-invariant tests. |
| H7 | Source/run root overlap can recurse. | Reject both ancestor and descendant overlap before creating run directories. | Resolved before directory creation with both-direction tests. |
| H8 | PR quality job executes repository code with write-capable credentials. | Split untrusted validation from trusted attestation and disable persisted credentials. | Resolved; PR quality is read-only, credentials are not persisted, attestation is trusted-main only. |

## Medium findings

| ID | Finding | Required remediation | Status |
|---|---|---|---|
| M1 | Public projection omits hash-participating fields. | Include fields or define separate public hash contract. | Resolved; all hidden sequence fields are materialized and schema-required. |
| M2 | Provider/MCP conformance is overstated. | Mark contract-only/shape-tested capabilities accurately. | Resolved; unsupported capabilities false/explicit and MCP matrix labels narrowed. |
| M3 | Context/memory are not wired into production lifecycle. | Integrate or narrow evidence/claims. | Resolved by narrowing evidence to tested policy/store contracts; handoff is the active continuity mechanism. |
| M4 | Organization policy accepts default allow. | Require default deny and validate invariants. | Resolved with default-deny, unique-rule, and wildcard-allow rejection tests. |
| M5 | Reparse coverage is narrower than claimed. | Add real ancestor/final integration checks where platform permits; narrow claims. | Claim narrowed to deterministic metadata coverage; privileged/same-user race remains outside local preview certification. |
| M6 | Release evidence is not commit/CI bound and gates remain open. | Bind final evidence to clean current state; do not claim CI execution before it exists. | Evidence now explicitly says remote CI has not run; final gate/review remain pending. |

## Low findings

- README crash-boundary count is stale.
- Secret scan skips large/unreadable files without reporting.
- SBOM scan can consume generated/ignored lock files.
- Timestamp-based idempotency assertion may miss a same-content rewrite.

## Second independent review

**Reviewer ID:** `github-copilot-reviewer/local/issue-2/2026-08-31`
**Decision:** CHANGES REQUESTED
**Counts:** Critical 0, High 4, Medium 5, Low 1

| ID | Finding | Remediation | Status |
|---|---|---|---|
| H1 | Security-critical run metadata was not bound to the event chain. | Added canonical full-descriptor hashing to `run.created`; load and append reject missing/mismatched bindings; unbound crash remnants fail closed. | Resolved; field-tamper regressions cover objective, source/policy/contract hashes, limits, assets, and creation time. |
| H2 | Replay allowed missing creation, post-terminal records, and incomplete evaluation/completion linkage. | Required creation first, rejected post-terminal events, closed post-evaluation operations, and bound evaluation projection/workspace/head/evidence plus completion event/artifact/result hashes. | Resolved with reducer regressions and four interruption-boundary E2E tests. |
| H3 | Evaluator could not evaluate the pinned contract and could falsely approve aggregate checks. | Added a schema-validated four-criterion JSON runtime contract, named verification checks, exact complete criterion/rubric sets, and hash-bound contract consumption. | Resolved; missing/subset/unsupported criteria and rubrics block approval. |
| H4 | Pull-request CodeQL ran repository code with a write-authorized job token. | Restricted write-authorized CodeQL to trusted main pushes; the PR deterministic quality job remains `contents: read` with checkout credentials disabled. | Resolved in workflow definition; remote execution remains pending. |
| M1 | Default archive leaked local paths/task metadata and was not independently verifiable. | Archive now allowlists evidence only, excludes source/workspace/run metadata/assets, includes internal hash-bound artifacts and a per-entry manifest, and returns package byte length/SHA-256. Public evidence uses a run-relative working directory. | Resolved with content/path/hash E2E assertions. |
| M2 | Verification elapsed limits and handoff remaining budgets were incomplete. | Added post-verification and post-evaluation elapsed gates; handoff subtracts consumed input/output tokens, cost, decisions, dispatches, and wall time. | Resolved with budget/provider ceiling tests. |
| M3 | Runtime provider capability objects could drift from JSON fixtures. | Runtime now loads the versioned fixture directly, carries requested/served models and token ceilings, and enforces capability ceilings. | Resolved with fixture parity and ceiling tests. |
| M4 | The root `artifacts/` ignore rule also excluded `docs/artifacts/`. | Anchored the generated artifact rule as `/artifacts/`; architecture, council, spec, and review docs are visible to Git and repository scans. | Resolved; `git check-ignore` returns no match for required docs. |
| M5 | Evidence counts, demo archive, loop state, and stream documentation were stale. | Refreshed the local gate/demo evidence and documented `stream` as finite polling. | Resolved locally; final clean independent re-review and remote CI remain pending. |
| L1 | Real reparse test returned as a passing test when link creation was unavailable. | Renamed and relabeled the fallback as a platform limitation; injected metadata rejection remains deterministic. | Accepted limitation: real NTFS reparse and mutation execution are not claimed. |

### Council synthesis

- Security adversary: descriptor, archive, and trusted-CI boundaries now have explicit fail-closed controls and regressions.
- Reliability/replay specialist: successful histories are closed and completion is bound through verification, evaluation artifact, evaluation event, and current projection.
- Maintainability/operator reviewer: runtime contracts and provider fixtures are single sources of truth; handoff/archive outputs expose verifiable remaining-budget and integrity metadata.

The synthesis supports requesting a final clean re-review after the fresh complete quality gate. It is not itself an approval.

## Third independent review

**Reviewer ID:** `github-copilot-reviewer/local/issue-2/2026-09-01-clean-slate`
**Decision:** CHANGES REQUESTED
**Counts:** Critical 0, High 3, Medium 2, Low 2

| ID | Finding | Remediation | Status |
|---|---|---|---|
| H1 | A crash after durable provider-decision append could bypass usage budgets on resume. | Every execute/resume now sums persisted input/output/cost values and revalidates run and provider ceilings before dispatch. | Resolved with an injected observer-failure integration test; resume blocks without mutation. |
| H2 | Replay accepted checkpoint payloads with false projection, workspace, or chain-head bindings. | Replay now requires the exact pre-checkpoint projection hash/head, successful tool workspace hash, and a valid checkpoint artifact hash. | Resolved with a hash-valid false-checkpoint regression. |
| H3 | The mandatory review gate remained incomplete and the candidate was not commit-bound. | Local loop baseline and evidence were refreshed after remediation. | Partially resolved: final clean re-review/loop completion are pending; remote CI and commit binding remain release-boundary caveats, not local runtime blockers. |
| M1 | Archive prefix rules exported arbitrary unvalidated files. | Replaced prefix matching with an exact evidence-file allowlist, per-file size/reparse checks, JSON/event parsing, and entry manifest hashing. | Resolved with unexpected-file exclusion coverage. |
| M2 | Provider fixtures were only partially schema-validated and were not pinned into runs. | Loader now validates required identity/version/date/size/uniqueness/capability invariants, computes a canonical fixture hash, and pins adapter/model/date/limits/hash in the descriptor. Resume rejects drift before mutation. | Resolved with malformed-fixture and provider-drift tests. |
| L1 | Null physical-root metadata returned invalid-invocation exit 2. | Null/blank persisted roots now raise typed invalid-data integrity failure and CLI exit 6. | Resolved with E2E coverage. |
| L2 | Evaluator isolation did not mechanically forbid future direct BCL side effects. | Current evaluator remains side-effect free and architecture checks verify constructor/field isolation. | Accepted LOW: a future IL-level forbidden-call analyzer is recommended before broadening evaluator behavior. |

### Third-review council synthesis

- Security adversary: exact archive allowlisting and provider fixture pinning close the identified data/provenance paths.
- Reliability/replay specialist: persisted usage and checkpoint semantics are now replay-time invariants with crash/falsification regressions.
- Maintainability/operator reviewer: null metadata has stable incident routing; final loop/review evidence must still be completed honestly.

The synthesis supports one final independent clean-slate review. It is not itself an approval.

## Fourth independent review

**Reviewer ID:** `github-copilot-reviewer/local/issue-2/2026-09-01-final-clean-slate`
**Decision:** CHANGES REQUESTED
**Counts:** Critical 0, High 0, Medium 1, Low 0

The implementation and security controls passed, but the governing recovery contract incorrectly required physical event-head and projection-hash equality between interrupted and uninterrupted runs. That requirement was impossible because interruption is a durable event. AC-6 and runtime evidence expectations now distinguish:

- stable physical head/projection on repeated resume of the same completed run;
- physical projection equality between a run and replay of that same run;
- final workspace equivalence between interrupted and uninterrupted runs; and
- semantic trace equality only across fresh uninterrupted runs.

**Status:** Resolved; a documentation-only final re-review is required.

## Final independent approval

**Reviewer ID:** `github-copilot-reviewer/local/issue-2/2026-09-01-final-read-only`
**Decision:** APPROVED
**Counts:** Critical 0, High 0, Medium 0, Low 0

The reviewer reran the warning-free Release build and complete 283-test suite, verified the active loop at iteration 4/5, inspected the final coverage artifact, and confirmed the corrected recovery semantics match implementation, tests, spec, plan, and evidence. The three review perspectives agreed:

- Contract/spec: physical versus semantic comparison boundaries are precise and consistent.
- Implementation/tests: completed-run resume, interrupted outcome convergence, fresh-run semantic equivalence, and same-run replay are correctly separated.
- Verification/release: all local gates pass; remote CI/CodeQL, real NTFS reparse execution, mutation testing, live providers, and deployment remain explicit caveats or limitations.

The final decision follows the synthesis.

## Approval rule

A new independent review must report zero Critical, High, and Medium findings after remediation and fresh complete verification. Later code changes invalidate approval.
