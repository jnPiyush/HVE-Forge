# HVE-Forge Schemas

Machine-readable public contracts are versioned by major schema family. Existing fixture runs remain under `schemas/v1/`; live multi-turn contracts are introduced under `schemas/v2/` without reinterpreting v1 records.

## Rules

- All schemas use JSON Schema 2020-12.
- Envelopes reject unknown properties unless a deliberately open payload is documented.
- Remote `$ref` resolution is disabled by runtime policy. The v1 files are self-contained.
- Unsupported major versions fail closed.
- Runtime records and schemas are parity-tested before release.
- Schema files contain no secrets or environment-specific endpoints.

## Active v1 contracts

| File | Contract |
|---|---|
| `task.schema.json` | Task intake, lifecycle state, requested capabilities, and budgets |
| `projection.schema.json` | Deterministic run projection reconstructed from events |
| `event.schema.json` | Ordered hash-chained event envelope |
| `tool-call.schema.json` | Redacted, policy-bound, idempotent tool call |
| `checkpoint.schema.json` | Resume checkpoint bound to event, projection, and workspace hashes |
| `evidence.schema.json` | Provenance, freshness, results, and content-addressed artifacts |
| `evaluation.schema.json` | Read-only evaluator capabilities, rubric scores, findings, and verdict |
| `approval.schema.json` | Explicit high-risk human approval request and decision |
| `handoff.schema.json` | Validated reset/handoff packet for clean-context resume |
| `provider-capabilities.schema.json` | Negotiated provider/model features and unsupported capabilities |
| `memory.schema.json` | Provenance-scoped, confidence-rated, expiring and deletable structured memory |
| `work-contract.schema.json` | Machine-readable bounded runtime evaluator contract |

Schema evolution follows additive minor changes within v1. A breaking field, semantic, hashing, or validation change requires a new major directory and an explicit migration/replay policy.

## Active v2 contracts

| File | Contract |
|---|---|
| `trust-envelope.schema.json` | Origin-derived trust, full and included content identity, and deterministic truncation metadata |
| `provider-turn.schema.json` | Bounded atomic assistant turn, ordered tool calls, normalized usage, and finish reason |
