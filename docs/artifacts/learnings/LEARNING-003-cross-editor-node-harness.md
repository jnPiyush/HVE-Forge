---
description: 'Reusable lessons from consolidating a deterministic coding harness across VS Code, Cursor, and Claude Code.'
confidence: 0.8
observations: 5
status: curated
category: 'cross-editor-reliability-security'
---

# LEARNING-003: Share discovery artifacts, enforce authority in the kernel

**Date:** 2026-09-01
**Issue:** #2

## Learning

1. Keep canonical customization source outside every host scan path. Render one compatibility copy when all selected hosts explicitly support it; native and compatibility copies of the same logical item create ambiguous routing and wasted context.
2. Duplicate diagnostics must scan actual discovery roots. A renderer manifest cannot reveal unmanaged files, and frontmatter inference must cover agents, skills, and rules.
3. Lexical path containment is insufficient for generators. Reject links and reparse points for canonical source, target roots, existing ancestors, manifests, scan roots, writes, and deletes immediately before access.
4. A persisted hash proves only the bytes that were hashed, not that those bytes were authoritative. Derive prompt and skill hashes from trusted composition bytes, persist those bytes, and verify them before execution and replay.
5. Validate event payloads before hashing or reduction. A valid hash chain around malformed payloads preserves corruption rather than preventing it.
6. Crash recovery needs owner-aware, time-bounded leases. Publish a complete PID/token lease atomically, reject future-dated records, reclaim after owner death or validated bounded expiry, and verify the token before release.
7. Release gates should measure where defects cluster: per-layer coverage, checked-in render drift, exact package inventory, approved dependency origins, SHA-512 integrity, licenses, and SBOM evidence.

## Evidence

- [Cross-editor review](../reviews/REVIEW-003-cross-editor-node-harness.md)
- [ADR-003](../adr/ADR-003-cross-editor-typescript-harness.md)
- [SPEC-003](../specs/SPEC-003-cross-editor-typescript-harness.md)
- [Execution plan](../../execution/plans/EXEC-PLAN-003-cross-editor-typescript.md)

## Promotion guidance

Promote these patterns when another renderer, plugin installer, resumable event store, or generated customization system is added. Keep product-specific host paths and package-mirror names in their owning profiles rather than general conventions.