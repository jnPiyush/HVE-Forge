---
name: hve-implement
description: Implement an approved bounded plan using test-first, surgical changes, runtime validation, secure defaults, fresh evidence, and independent review.
license: MIT
compatibility: hve-forge >=0.2.0
---

# HVE Implement

> WHEN: Implementing a planned code or configuration change with explicit acceptance criteria.

## Decision Tree

1. If no approved scope or testable criteria exist, return to planning.
2. If the work contract is not active or does not conform to
   `urn:hve-forge:schema:v1:work-contract`, do not edit.
3. If fixing a bug, reproduce it with a failing test first.
4. If changing behavior, write the smallest failing contract test first.
5. If a requested action expands authority, stop for a policy and human approval decision.

## Core Rules

- Reuse existing code where contracts match; abstract only for a second concrete use.
- Validate external input from `unknown` and fail closed on unsupported values.
- Keep changes local to the approved files and interfaces.
- Run focused checks after each slice and the full required suite on the final state.
- Persist fresh evidence without secrets or unredacted user content.

## Error Handling

Fix root causes rather than suppressing errors, weakening types, skipping tests, or widening permissions. After two failed fixes, stop and investigate the shared cause before another edit.

## Checklist

- [ ] A failing test demonstrated the missing behavior.
- [ ] Every blocking contract criterion maps to named fresh evidence.
- [ ] Every changed line traces to scope or necessary test support.
- [ ] Boundary validation and negative paths are covered.
- [ ] Build, tests, coverage, lint, and security checks are fresh.
- [ ] An independent reviewer receives the final diff and evidence.