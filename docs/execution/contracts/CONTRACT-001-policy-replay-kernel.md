<!-- Purpose: Bounded implementation contract for the first production harness slice. -->

# Work Contract: Policy and Replay Kernel

**Checkpoint:** Work  
**Status:** Active  
**Author:** GitHub Copilot  
**Date:** 2026-08-31  
**Plan:** `docs/execution/plans/EXEC-PLAN-002-production-harness.md`

This document governs release implementation and review. The executable evaluator consumes the narrower, schema-validated `config/contracts/exact-text-replacement.v1.json` contract. Repository quality, security, replay, and CI criteria in this document are enforced by the quality gate and independent reviewer, not inferred from one file-replacement verification.

## Purpose

Establish a credential-free local kernel that proves HVE-Forge can drive a bounded coding task through typed state, confined mutation, fresh evidence, independent review, interruption recovery, and deterministic replay before any live provider or broad agent framework is integrated.

## Scope

- A pinned .NET 10 solution with Domain, Application, Infrastructure, CLI, and test projects.
- One deterministic scripted provider and one idempotent text replacement tool.
- An ephemeral run root containing a copied fixture workspace and separate state directory.
- Versioned append-only UTF-8 JSONL events with contiguous sequence and SHA-256 hash chain.
- Pure task-state projection, budgets, limits, policy decisions, redaction, evidence, and completion gate.
- Scoped `AGENTS.md` discovery and content hashing.
- CLI commands for fixture execution, inspection, resume, replay, cancellation, and archive.
- Unit, integration, end-to-end, adversarial, recovery, and architecture tests.

## Not in scope

- Live OpenAI, Anthropic, Foundry, or other model calls.
- Remote writes, deployment, releases, merge, force push, or secret access.
- Arbitrary process, shell, browser, or network execution.
- Claims of container, microVM, or operating-system sandbox isolation.
- Full MCP execution, MCP Apps, Skills over MCP, or A2A.
- Web or IDE user interfaces, generalized multi-agent workflows, or long-term user memory.

## Acceptance criteria

### AC-1: Deterministic event contract

For fixed fixture bytes, instructions, policy version, seed, and limits, two fresh runs produce the same ordered event types and canonical semantic-trace SHA-256. The semantic trace is the ordered HVE Canonical JSON v1 encoding of `sequence`, `eventType`, and normalized payload. Envelope `runId`, `occurredAt`, `previousHash`, and `eventHash` are excluded. Derived physical bindings are also excluded from semantic payloads: checkpoint `checkpointHash`, `projectionHash`, and `chainHeadBefore`; verification `artifactHash`; evaluation `artifactHash` and `projectionHash`; and completion `projectionHash`. Those fields remain mandatory in physical events and are validated during replay/resume. Other payload fields contain relative paths and stable fixture values, never physical temp roots or timestamps. Every event has `schemaVersion`, `runId`, contiguous `sequence`, a closed slice-1 `eventType`, `occurredAt`, `payload`, `previousHash`, and `eventHash`.

Replay validates schema, sequence, and hash-chain integrity, uses provider and tool doubles that fail if called, and produces canonical projection JSON and SHA-256 identical to the original terminal projection. Unknown schema versions, sequence gaps, duplicate sequences, malformed records, and hash mismatches fail closed.

Crash injection occurs only after flushed event boundaries. Torn final JSONL records are detected and rejected; automatic truncation is outside this slice.

### AC-2: Mutation boundary

Tool-induced mutations are confined to `<run-root>/workspace`. Runtime state, events, and evidence may mutate only under `<run-root>/state`. The immutable source fixture and each caller-declared protected manifest root retain identical pre-run and post-run SHA-256 manifests. Tests declare a source fixture root and an outside-run sentinel root. Build, test, and coverage outputs are never declared protected roots and are outside this runtime-boundary assertion.

### AC-3: Windows path safety

The replacement tool accepts only an existing regular-file target expressed as a relative path beneath the copied workspace. It rejects rooted, drive-relative, UNC, device, alternate-data-stream, traversal, invalid-character, symlink, junction, and other reparse-point paths. Every ancestor and final target are checked for reparse points, canonical containment uses Windows path semantics, and checks repeat immediately before replacement.

The acceptance environment is Windows on NTFS. Any concurrent local actor able to mutate the workspace between validation and replacement, plus OS-level process/network isolation, is outside this slice's threat model; stronger same-user race resistance requires a container/microVM or handle-relative no-follow backend.

### AC-4: Deny-by-default capability policy

No process, shell, network, browser, secret, external-write, destructive, or privileged capability is registered. An unknown CLI verb or provider-requested tool is rejected before dispatch. A rejected action produces only a policy-denial event and causes no tool side effect.

### AC-5: Scoped instruction discovery

Starting from the target file's directory, discovery walks parents only to the copied workspace root and selects the first regular, non-reparse `AGENTS.md`. It never reads above the boundary or from the immutable source fixture. Absence means an empty instruction set. Invalid UTF-8, content over 64 KiB, or a reparse-point instruction file fails closed. Evidence includes the selected relative path and SHA-256. Tests cover nearest-wins, root fallback, absence, outside-root exclusion, oversize, invalid UTF-8, and reparse rejection where the platform permits creating one.

### AC-6: Idempotency and interruption recovery

Tests inject interruption at:

1. after the provider decision event is flushed and before dispatch;
2. after file replacement commits and before its result event is flushed;
3. after verification is recorded and before evaluation.
4. after evaluation is recorded and before terminal completion.

After an interrupted run reaches completion, repeated resume of that same completed run preserves its workspace hash, event-chain head, and projection hash. Its final workspace content and hash match an uninterrupted baseline, while its physical event head and projection hash differ because the interruption is a durable event. Fresh uninterrupted runs compare ordered event types and semantic trace hashes. Replay of one run compares the reconstructed physical projection hash with that same run's stored terminal projection. Each idempotency key causes at most one committed replacement, one verification result, and one terminal event.

### AC-7: Evidence and read-only evaluator

Evidence uses SHA-256 over canonical UTF-8 data and binds the run input, policy version, instruction digest, provider decision, normalized arguments, idempotency key, before/after file hashes, verifier identity/result, source fixture hash, and event-chain head.

The evaluator receives the exact parsed runtime contract, immutable projection, named criterion evidence, and pinned hashes. It requires the complete fixed set of four bounded replacement criteria and the complete rubric; custom subsets cannot weaken approval. It has no dispatcher, mutable filesystem, process, network, or provider dependency. Only the orchestrator appends its verdict event. Replay permits only terminal disposition or one explicit non-mutating after-evaluation interruption after that verdict.

### AC-8: Redaction

A canary secret is injected into classified-sensitive provider diagnostics and exception text, but not into intended file content. Its exact bytes are absent from JSONL events, checkpoints, evidence, CLI stdout/stderr, and rendered errors. The marker `[REDACTED]` appears where applicable. One-way SHA-256 references are permitted.

### AC-9: Budgets and future loop signatures

The local slice is intentionally single-decision and single-dispatch: defaults are `MaxDecisions = 1` and `MaxToolDispatches = 1`. Decision, dispatch, elapsed-time, input-token, output-token, and integer-minor-unit cost limits are checked before or immediately after each bounded operation and prevent successful completion when exceeded. Rejected attempts cause no additional workspace mutation.

Action-signature calculation and consecutive-signature counting are deterministic domain primitives covered by unit tests, but the current workflow has no multi-decision loop in which a repeated-signature exit can occur. Exit code 5 is reserved for the future bounded-loop workflow. The preview does not claim operational repeated-loop detection.

### AC-10: Stable exit codes

| Outcome | Exit code |
|---|---:|
| Completed | 0 |
| Invalid invocation | 2 |
| Policy denied | 3 |
| Limit exceeded | 4 |
| Repeated signature (reserved for future multi-decision workflow) | 5 |
| Replay integrity failure | 6 |
| Evaluation rejected | 7 |
| Interrupted fixture | 8 |
| Cancelled | 9 |
| Internal failure | 10 |
| Blocked | 11 |

Exit code 1 is reserved and is never returned intentionally. The top-level CLI maps every unhandled exception to `Internal failure` exit code 10 after redaction.

### AC-11: Build, coverage, and architecture

The repository pins .NET 10 through `global.json` and pins NuGet dependencies through central package management and lock files. Locked restore, Release build with warnings as errors, and Release tests pass.

Domain, Application, and Infrastructure each achieve at least 80% line and branch coverage, excluding generated code. Path metadata inspection is injected behind an internal adapter so reparse and error branches are covered deterministically even if the Windows account cannot create a real reparse point. A real NTFS reparse integration test runs when the platform permits it and reports an explicit platform limitation otherwise. The coverage command fails when any threshold is missed.

### AC-12: Canonicalization and golden vectors

All hash-bound JSON uses the in-repository `HVE Canonical JSON v1` algorithm defined in the technical specification. It supports objects, arrays, strings, signed 64-bit integers, booleans, and null; rejects duplicate object names, floating-point/exponent numbers, invalid Unicode, and values outside the supported depth/size limits; sorts object names with .NET ordinal ordering; preserves array order; and emits UTF-8 with `Utf8JsonWriter` default escaping and no insignificant whitespace. Monetary values are integer minor units.

Event hashes omit `eventHash` rather than serializing a null placeholder. Golden vectors cover key ordering, nested values, escapes, negative and boundary integers, duplicate-key rejection, unsupported numeric forms, event hash, and semantic trace hash. Golden vector bytes and expected SHA-256 values are versioned under `tests/fixtures/canonical-json-v1/` and are the first focused test gate.

### AC-13: Schema conformance

Every emitted event, terminal projection, checkpoint, tool-call record, evidence record, and evaluation verdict payload validates against the matching `schemas/v1` JSON Schema in tests. Reserved future schemas are syntax-checked but cannot be emitted by the slice-1 event registry. Tests use pinned test-only `JsonSchema.Net` 9.4.0 from the configured `azure-default` feed; production projects do not depend on a JSON Schema package. Runtime boundary validation remains explicit in typed constructors and parsers and does not rely on annotation-only JSON Schema `format` behavior.

Dependency direction is mechanically enforced: Domain references no production project; Application may reference Domain; Infrastructure may reference Application and Domain; CLI is the composition root and may reference all three; no reverse edge is permitted.

## Verification method

- Locked `dotnet restore` and Release `dotnet build` with warnings as errors.
- Release test suite with coverage threshold enforcement.
- CLI fixture run, interruption/resume cases, replay, inspect, cancel, and archive smoke tests.
- Hostile path, malformed event, tampered hash, unknown schema/tool, budget, stale evidence, secret canary, and evaluator-write-capability tests.
- Architecture reference tests and a repository secret scan.

## Runtime evidence expectations

- A complete JSONL event stream and canonical projection for an allowed fixture.
- Policy-denial events for prohibited actions with no corresponding side effect.
- Identical semantic trace hashes for two fresh uninterrupted fixture runs; identical physical projection hashes only between a run and replay of that same run; equivalent final workspace hashes across interrupted and uninterrupted baselines.
- Coverage, build, test, adversarial, secret-scan, and independent-review reports linked from the execution evidence summary.

## Risks

- Windows controlled workspace isolation may be mistaken for a production sandbox.
- Broad abstractions may be built before a second adapter proves they are necessary.
- File replacement interrupted between atomic rename and result event needs reconciliation from before/after hashes.
- JSON canonicalization errors could make replay hashes unstable.

## Recovery path

All run artifacts live under a caller-selected `.hve/runs/<run-id>` directory. The source fixture remains immutable. A fresh run uses a fresh directory. Resume reconciles idempotent side effects from file hashes and durable decision events. Replay never executes effects. Invalid or tampered stores are copied for inspection and rejected rather than repaired silently.

## Evaluator handshake

The durable finding register is `docs/artifacts/reviews/REVIEW-002-policy-replay-kernel.md`. The first independent review requested changes for canonicalization, repeated-signature reachability, evidence bindings, schema conformance, terminology, tool scope, evaluator isolation, manifest scope, arithmetic, platform coverage, and restore provenance. Those findings were resolved before implementation; remaining LOW items are tracked in the same register.
