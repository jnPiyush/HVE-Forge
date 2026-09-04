<!-- Purpose: Three-perspective model council for ADR-001. -->

# Model Council: Harness Runtime Foundation

**Date:** 2026-08-31  
**Topic:** Select the production harness foundation  
**Related ADR:** `docs/artifacts/adr/ADR-001-harness-runtime.md`

## Perspective 1: Architecture and trust boundaries

**Recommendation:** Focused .NET 10 modular monolith.

The decisive properties are fail-closed policy, deterministic replay, append-only durability, provider neutrality, and independent review. Codex App Server is the strongest ready-made coding harness and offers excellent thread/turn/item and streaming semantics, but its provider-specific session runtime would own the system of record. Agent Framework or LangGraph supplies orchestration but does not remove the need to own the sandbox and completion gate. A small owned core keeps adapters at the leaves and makes dependency direction mechanically testable.

**Primary warning:** Windows workspace confinement is not a production sandbox. The runtime must name that limitation and refuse arbitrary process or network execution until a stronger backend exists.

## Perspective 2: Evaluation and economics

**Recommendation:** Own the model-call and event boundary; use frameworks only as adapters.

Replay, evaluator independence, prompt/skill versioning, usage normalization, and cost attribution all depend on controlling the provider seam. The offline contract must record normalized requests, opaque provider extensions, finish reasons, distinct input/output/cached/reasoning usage, and a stable fixture key. Replay mode must fail on a fixture miss and must have no credentials.

Public benchmarks should be a portfolio. SWE-bench Verified is not a release gate because of contamination and task-test mismatch. Temporal SWE-rebench, SWE-bench Pro, Terminal-Bench 4.0, ProgramBench, CodeClash, and private repository tasks measure different failure modes. Cost per solved task and variance matter more than a single pass score.

**Primary warning:** Provider neutrality is only a hypothesis until two live adapters pass the same conformance suite. No live-model thresholds can be set without a user-approved model and budget envelope.

## Perspective 3: Skeptical implementation review

**Initial verdict:** Changes requested.

The original option C scope risked recreating a general agent framework before any provider behavior was testable. The first slice should not include live providers, arbitrary shell, remote writes, deployment, generalized workflows, long-term memory, or full MCP. It should prove one deterministic fixture provider, one confined harmless mutation, versioned hash-chained events, replay with fail-if-called doubles, precise interruption points, limits, redaction, and read-only evaluation.

**Approval condition:** Reframe option C as a policy-and-replay kernel with exact acceptance tests and explicit Windows threat-model limits.

## Synthesis

The council accepts option C after applying the skeptical review's scope cuts. The selected foundation is not justified by framework novelty; it is justified by ownership of trust, evidence, and replay boundaries. Mature projects remain valuable references and future adapters:

- Borrow Codex App Server's thread/turn/item and reconnectable streaming event model.
- Borrow LangGraph's checkpoint and resume semantics.
- Borrow Anthropic's contract negotiation, clean handoffs, and generator/evaluator separation.
- Borrow Aider's repository-map and edit-precision ideas.
- Borrow continuous benchmark versioning and resource calibration from SWE-rebench and Terminal-Bench.

The first slice is accepted only if it remains credential-free, local-only, deterministic, and narrow. The architecture must reject rather than fake unsupported sandbox, provider, MCP, telemetry, or deployment capabilities.

## Consensus constraints

1. Core domain has no provider, storage, UI, or operating-system dependencies.
2. All non-determinism enters through explicit ports.
3. No live provider or cost-bearing call occurs in the MVP.
4. No provider-neutral production claim is made before two live adapters pass contract tests.
5. Completion is a deterministic evidence policy, not a model phrase.
6. Independent evaluation is read-only and invalidated by later mutation.
7. Runtime security claims distinguish workspace confinement from OS sandboxing.
8. External protocol and telemetry versions remain adapter concerns.
