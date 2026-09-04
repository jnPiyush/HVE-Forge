---
name: hve-review
description: Perform an independent read-only review of requirement fit, correctness, tests, security, reliability, maintainability, scope, and release evidence.
license: MIT
compatibility: hve-forge >=0.2.0
---

# HVE Review

> WHEN: Reviewing a completed implementation, migration, configuration change, or release candidate before approval.

## Decision Tree

1. If scope, spec, or acceptance criteria are absent, return BLOCKED.
2. Run requirement and contract conformance before code-quality scoring.
3. If conformance fails, request changes without overlooking it because tests pass.
4. If conformance passes, inspect code and run fresh checks independently.

## Core Rules

- Remain read-only and do not treat author rationale as proof.
- Require a schema-valid active work contract and bind evidence to its contract ID,
  criterion IDs, final workspace hash, and event-chain head.
- Cite each finding to evidence and explain concrete impact.
- Use Critical, HIGH, MEDIUM, and LOW severity consistently.
- Test malformed input, boundaries, tampering, and recovery for changed high-risk surfaces.
- Approve only with zero Critical, HIGH, and MEDIUM findings.

## Error Handling

If checks cannot run, report the exact missing prerequisite and mark the affected claim unverified. Never substitute stale output or a previous commit's CI result.

## Checklist

- [ ] Requirement, ADR, spec, and acceptance fit passed.
- [ ] Contract identity, final workspace, event head, and evidence hashes agree.
- [ ] Complete diff and dependency changes were inspected.
- [ ] Fresh build, tests, coverage, lint, and scans passed.
- [ ] Security and rollback evidence match the final state.
- [ ] Decision and residual risks are explicit.