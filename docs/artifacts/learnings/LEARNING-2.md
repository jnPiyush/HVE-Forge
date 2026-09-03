---
description: 'Reusable integrity and evidence lessons from the HVE-Forge production harness.'
confidence: 0.8
observations: 4
status: curated
category: 'reliability-security'
---

<!-- Inputs: 2, 2, 2026-09-01, reliability-security -->

# LEARNING-2: Bind authority to durable evidence

**Date**: 2026-09-01
**Issue**: #2
**Category**: reliability-security
**Confidence**: 0.8 (auto-promote at >= 0.8)
**Observations**: 4

## Context

HVE-Forge needed a deterministic local coding harness that could survive interruption, resume without duplicate effects, reject tampering, and prove completion without live providers or privileged tools. Independent reviews found that valid hashes alone did not make mutable metadata, budgets, checkpoints, provider capabilities, evaluator inputs, or archives authoritative.

## Learning

Apply these rules to durable agent runtimes:

1. Bind every authority-bearing input to the append-only history. Include run metadata, policy, contracts, provider capability identity, limits, and asset hashes in a canonical descriptor hash referenced by the first event.
2. Recompute enforcement from persisted events after every resume. A check performed only immediately after an external call can be skipped if the process fails after durable append but before validation.
3. Separate physical integrity from semantic reproducibility. Compare physical projection and event hashes only within the same run; compare normalized semantic traces and final workspace outcomes across fresh or interrupted runs.
4. Evaluate a narrow typed runtime contract with named evidence. Do not infer a broad release contract from aggregate check counts, and do not allow caller-supplied criterion or rubric subsets to weaken approval.
5. Export evidence through an exact allowlist. Validate type, size, reparse status, and content; include content hashes and publish a package hash. A directory name such as `evidence` is not provenance.
6. Load capability fixtures as runtime data and pin their canonical hash and identity into each run. A parallel hardcoded capability object will drift.

## Evidence

- [Final review register](../reviews/REVIEW-002-final-code.md) records four independent remediation cycles and final approval.
- [Execution evidence](../../execution/evidence/EVIDENCE-002-production-harness.md) records 283 passing tests, per-module coverage, security scans, replay, redaction, handoff budgets, and archive verification.
- Regression tests cover crash-consistent persisted usage, false checkpoint bindings, metadata and provider-fixture drift, weakened contracts, exact archive allowlisting, and same-run replay.
- Final independent verdict: Critical 0, High 0, Medium 0, Low 0.

## Why It Matters

These rules prevent a harness from reporting success while using altered metadata, bypassed budgets, stale evaluator assumptions, or untrusted files packaged as evidence. They apply to any resumable agent, workflow engine, or tool-using model runtime where durable state is part of the trust boundary.

## Promotion Path

This learning has four independent review observations and confidence 0.8. Promote the concise integrity rules to repository conventions when the pattern is reused by a second runtime or adapter.

## Related

- ADR: [ADR-001](../adr/ADR-001-harness-runtime.md)
- Review: [REVIEW-002](../reviews/REVIEW-002-final-code.md)
- Evidence: [EVIDENCE-002](../../execution/evidence/EVIDENCE-002-production-harness.md)
