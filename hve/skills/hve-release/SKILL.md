---
name: hve-release
description: Certify a release candidate through reproducible builds, full tests, coverage, security scans, artifact drift checks, SBOM, provenance, and rollback validation.
license: MIT
compatibility: hve-forge >=0.2.0
---

# HVE Release

> WHEN: Preparing to publish, tag, merge, deploy, or declare a production-ready HVE-Forge release candidate.

## Decision Tree

1. If implementation review is not approved, return NO-GO.
2. Install exactly from the lockfile with lifecycle scripts disabled.
3. Run all deterministic, cross-platform, security, and packaging gates.
4. Validate migration and rollback from a clean checkout.
5. Bind evidence to the immutable commit, clean working-tree hash, package hash, and
   event-chain head.
6. Issue GO only when every recorded identity still matches the final candidate.

## Core Rules

- Never publish from a dirty workspace or stale test result.
- Pin toolchains and dependencies and inspect packaged files.
- Produce an SBOM and provenance attestation without embedding secrets.
- Verify generated host artifacts are current and conflict-free.
- Keep rollback executable through the documented support window.

## Error Handling

Any missing, stale, skipped, or contradictory blocking gate produces NO-GO. Record the exact remediation and rerun the full affected gate after changes.

## Checklist

- [ ] Clean install, build, tests, coverage, and lint pass.
- [ ] Audit, secret scan, license inventory, and SBOM pass.
- [ ] Host render drift and package-content checks pass.
- [ ] Migration, compatibility, and rollback are exercised.
- [ ] Candidate identity and final evidence hashes are recorded.
- [ ] Commit, clean-tree, package, and event-chain identities match at GO time.