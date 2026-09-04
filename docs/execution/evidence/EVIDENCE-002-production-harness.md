<!-- Purpose: Evidence summary for the production AI coding harness release candidate. -->

# Evidence: Production AI Coding Harness

**Issue:** https://github.com/jnPiyush/HVE-Forge/issues/2
**Branch:** `feature/2-production-harness`
**Evidence date:** 2026-08-31
**Release candidate:** 0.1.0 local fail-closed preview

## Implementation evidence

- Modular .NET 10 solution: Domain, Application, Infrastructure, CLI, and five test projects.
- Versioned public schemas, prompts, policy, skill, evaluator rubric, provider capability fixtures, and MCP conformance matrix.
- CLI lifecycle: submit/run, inspect, stream, pause, resume, cancel, retry, fork, handoff/reset, replay, archive, instructions, skills, MCP diagnostics, and synthetic approval request.
- Hash-chained JSONL event store with full descriptor binding, closed semantic replay, optimistic expected-head append, atomic public artifacts, idempotent replacement receipts, and crash-boundary recovery.
- Schema-validated four-criterion runtime contract, named verification evidence, complete fixed evaluator rubric, and completion bindings through the verification result, evaluation artifact, evaluation event, and current projection.
- Deny-by-default capability policy, exact policy and asset hashes, provider-fixture token ceilings, stage limits, remaining-budget handoffs, approval identity/hash/expiry checks, redaction, and metadata-only telemetry.

## Verification evidence

| Gate | Observed result |
|---|---|
| Locked restore | Passed |
| Release build with warnings as errors | Passed, 0 warnings, 0 errors |
| Full test suite | 283 passed, 0 failed, 0 skipped |
| Domain coverage | Line 96.17% (979/1018), branch 86.94% (646/743) |
| Application coverage | Line 91.92% (1411/1535), branch 86.15% (398/462) |
| Infrastructure coverage | Line 95.93% (1673/1744), branch 82.77% (586/708) |
| ASCII scan | Passed, 151 repository paths inspected after compound capture |
| Candidate secret scan | Passed |
| NuGet vulnerability audit | Passed, no known vulnerable packages reported |
| CycloneDX SBOM | Generated with 19 components |
| Architecture tests | Passed; inward project/assembly direction and evaluator isolation |
| Schema conformance | Events, projection, checkpoint, tool call, evidence, evaluation, handoff, approval, runtime work contract, provider fixtures, and memory fixtures validated |

Coverage report: ignored local `coverage-merged/summary.json`.  
SBOM: ignored local `artifacts/sbom.cdx.json`.

## Runtime evidence

Fresh post-hardening evidence-captured demo:

- Start: 2026-09-01T08:04:24.5212223-05:00
- End: 2026-09-01T08:04:25.3365515-05:00
- Elapsed event span: 815.3292 ms
- Run ID: `run-50e9998660e2488c9ff7c3a640f36593`
- Run root: `.hve/final-evidence/final-20260901-080424105-57961329/runs/run-50e9998660e2488c9ff7c3a640f36593`
- Status: completed, exit 0
- Events: 16
- Event-chain head: `47f9f997604f011d98232039394c6fb70202a5fd959a9c9c636ae77162ae1804`
- Final projection hash: `73e357d4ee7c1b7fa124f9ae3dbf333dfa14127a2420f9c66d97f02e7954cbf6`
- Semantic trace hash: `fafa3dfc9a9510d543c15b8a53546de13fa23d3b35ca198f828bcbd9e9f854dd`
- Replay: exit 0 with identical event count, projection hash, and semantic trace hash; no provider or tool execution.
- Copied greeting SHA-256: `aab3decd77164751eb6a9cbcb1e2611c5f52b6af8f150d067ca35e1624bc04ad`
- Source fixture remained `Hello from fixture`; copied workspace became `Hello from HVE-Forge`.
- Source greeting SHA-256: `a097b4f5f1e4848fd19af06af45d6263d4b8c2e8933ca52d44e37de7dd7e3221`.
- Canary `HVE-FINAL-CANARY-DO-NOT-LEAK` was absent from public files, CLI output, handoff, and archive; `[REDACTED]` appeared in CLI output.
- Fixture usage: input tokens 0, output tokens 0, cost 0 minor units.

Local handoff packet:

- `.hve/final-evidence/final-20260901-080424105-57961329/handoff.json`
- Size 1,834 bytes
- SHA-256 `ac6361d9889432bd99d5e9b52c477d14348434ec34d34083af14fb166bdbea84`
- Remaining budget: 0 decisions, 0 dispatches, 0 input tokens, 0 output tokens, 0 cost minor units, and 298 seconds.

Local run archive:

- `.hve/final-evidence/final-20260901-080424105-57961329/run.zip`
- Size 9,092 bytes
- SHA-256 `26e1a369d8a372e895d9d05b056481ff96dcd61a913687e114fe29d67ed3bb29`
- CLI-published hash matched the package bytes.
- ZIP entries: checkpoint, projection, events, public verification/evaluation/tool records, internal hash-bound verification/evaluation artifacts, and `archive-manifest.json`.
- Every manifest byte length and SHA-256 matched its ZIP entry.
- `workspace/`, `source/`, `state/run.json`, `state/assets/`, raw expected text, raw replacement text, local run root, and canary were absent.

## Security and recovery evidence

- Direct and indirect scope expansion fixtures fail closed before tool effects.
- Hostile traversal, rooted, drive-relative, UNC, device, ADS, invalid-character, reparse, and non-UTF-8 paths are covered.
- Default-deny policy produces no `tool.dispatched` event and no mutation.
- Event tamper, sequence, previous-hash, unknown schema/type, and torn-record cases reject replay.
- Metadata changes to objective, source/policy/contract hashes, limits, assets, or creation time reject against the first event's descriptor hash.
- Provider adapter/model/discovery/limits/canonical-fixture hash are descriptor-bound; fixture drift on resume blocks before mutation.
- Persisted usage is revalidated before resumed dispatch, including an injected observer-failure boundary.
- Checkpoints bind the exact pre-checkpoint projection, workspace, and event head.
- Archive inputs use an exact allowlist plus size, reparse, JSON/event, and manifest checks; arbitrary evidence-directory files are excluded.
- Histories without creation, with post-terminal events, or with mismatched evaluation evidence reject replay.
- Interruption/resume tests cover after decision, after tool commit, after verification, and after evaluation. Double resume produces at most one tool completion, verification, and terminal completion event.
- Handoff reset validates task/run identity, source fixture, workspace, and event-chain head.
- Approval tests reject absent, expired, agent-issued, denied, or wrong-action approvals.
- Structured memory tests cover provenance, trust, confidence, scope, deduplication, expiry, and deletion.
- MCP offline tests cover per-request metadata, discovery/result method shapes, input-response shape, signed request state, progress/cancellation method shapes, cursors, remote reference denial, strict `tasks/get` capability negotiation, and deprecated method rejection. No MCP network execution is claimed.

## Effective versions

| Surface | Version |
|---|---|
| .NET SDK | 10.0.111 |
| C# | 14.0 |
| Harness package | 0.1.0 |
| Event/schema family | 1.0 |
| Policy | 1.0.0 plus content hash |
| Prompt | coding-agent.v1 plus content hash |
| Evaluator rubric | 1.0.0 plus content hash |
| Tool schema | 1.0.0 |
| Telemetry vocabulary | 1.0.0 |
| MCP baseline | 2026-07-28 |
| Provider adapters | recorded fixture-openai and fixture-anthropic 1.0.0, loaded directly from versioned JSON capability fixtures |

## Limitations and release posture

This evidence certifies the local credential-free preview, not a live autonomous production deployment. Docker/microVM isolation, process/network tools, live model calls, provider spend, production secrets, remote writes, multi-tenant authorization, data residency, and managed deployment remain disabled and require explicit operator decisions and additional certification. Real NTFS reparse creation returned `IOException`, so only injected reparse metadata rejection is proven locally. Mutation testing was not executed because no runner is installed. Remote CI and CodeQL have not run for this uncommitted candidate.

## Requirement-to-evidence matrix

| MVP gate | Evidence status |
|---:|---|
| 1 | Locked restore/build/quality gate passed locally; the SHA-pinned CI workflow is configured but has not yet produced a remote clean-runner result |
| 2 | One CLI command emitted 16 ordered structured events |
| 3 | Workspace confinement and denied capability/path tests pass; OS sandbox remains an explicit blocker |
| 4 | Scoped instruction and skill diagnostics expose sources, precedence, versions, trust, and hashes |
| 5 | Fixture provider made the intended narrow edit and verification recorded 4/4 checks |
| 6 | Synthetic risky action emits exact approval request and exits 3 without execution |
| 7 | Four interruption boundaries resume idempotently |
| 8 | Context continuity policy and validated handoff/reset tests pass |
| 9 | Stale/hash/test-count/write-capable-reviewer/blocking-finding tests pass |
| 10 | Read-only evaluator consumed the exact typed runtime contract, complete rubric, named criterion evidence, and final hashes |
| 11 | Injection/scope/path/final-target reparse metadata/secret/tool-output/provider-ceiling/stage-budget tests fail closed; real NTFS execution remains a documented local limitation |
| 12 | Metadata reconstructs provider/tool/evaluation events without content or secrets |
| 13 | Replay matched the physical projection and semantic trace without effects |
| 14 | Two constrained provider shapes load schema-equivalent validated JSON capabilities, pin canonical fixture hashes into runs, enforce advertised token ceilings, and pass the same tool contract; unsupported live/stream/cache/session/batch features are explicit |
| 15 | 283 tests green; per-core line/branch above 80%; dependency, secret, build, formatting, ASCII, schema, and SBOM gates pass |
| 16 | Independent final code review approved the local candidate with zero Critical, HIGH, MEDIUM, and LOW findings; remote release gates remain explicitly unexecuted |
