<!-- Purpose: Durable independent review and remediation register for ADR/SPEC-003. -->

# Review: Cross-Editor Node Harness

**Issue:** https://github.com/jnPiyush/HVE-Forge/issues/2
**Reviewer ID:** `github-copilot-reviewer/local/issue-2/2026-09-01-strict-final`
**Initial decision:** CHANGES REQUESTED
**Initial counts:** Critical 0, High 3, Medium 8, Low 0

## Findings and dispositions

| ID | Finding | Disposition |
|---|---|---|
| H1 | Host rendering followed target junctions outside the selected root. | Resolved with guarded source, profile, catalog, target, manifest, scan, write, and delete paths plus real junction regressions. |
| H2 | Caller-supplied prompt and skill hashes could fabricate provenance. | Resolved by deriving trusted assets at composition, persisting exact prompt/skill bytes, and verifying bytes and hashes before execution, inspect, or replay. |
| H3 | Replay accepted schema-invalid event payloads. | Resolved with exact event-type payload validation before hashing, parsing, validation, and reduction; all 15 event types have malformed-field matrix coverage. |
| M1 | Skill inspection rejected valid nested Agent Skills metadata. | Resolved with a bounded top-level YAML subset supporting nested metadata, block scalars, quoted scalars, comments, and scalar tool lists. |
| M2 | Doctor missed unmanaged duplicate rules. | Resolved by unambiguous rule-description inference plus unmanaged-rule duplicate regression coverage. |
| M3 | A terminated process could leave a permanent event lock. | Resolved with atomically published PID/token leases, liveness checks, guarded stale takeover, token-checked release, and dead/live-owner tests. |
| M4 | Coverage was aggregate-only and lower layers missed the documented gate. | Resolved with a mechanical core/application/adapters/hosts/CLI four-dimension 80 percent gate. All layers now pass. |
| M5 | CI host checks ignored checked-in generated drift. | Resolved: host quality now checks deterministic temp renders and the checked-in workspace with `render --check` plus `doctor`. |
| M6 | Package validation was a broad denylist. | Resolved with an exact generated inventory derived from source outputs, catalog assets, and reviewed static contracts. |
| M7 | Lockfile and SBOM used SHA-1 and undeclared mirror URLs. | Resolved with project-pinned approved Microsoft npm mirror, 122 independently downloaded and verified SHA-512 lock entries, origin allowlist, license checks, and SHA-512 SBOM enforcement. |
| M8 | Final loop and review authority remained open. | Pending final clean independent verdict and loop completion. |

## Fresh local evidence

- Clean locked install: 71 installed packages, 72 audited, zero vulnerabilities.
- Complete tests: 203 passed in 13 files.
- Aggregate coverage: statements 90.44%, branches 84.72%, functions 98.03%, lines 92.34%.
- Every production layer is at least 80 percent in statement, branch, function, and line coverage.
- Host output: checked-in and temporary renders deterministic; `doctor` reports zero duplicates and expected kernel-mediated warnings.
- Supply chain: 122 exact SHA-512 lock entries from four allowlisted Microsoft mirror hosts; no lifecycle scripts; exact 223-file package inventory; 71-component SBOM with SHA-512 and license evidence.

## Remaining external caveats

- Remote Windows/macOS/Linux CI, CodeQL, package attestation, and provenance have not run for this local candidate.
- Cursor and Claude CLIs are not installed locally; host validation uses official path/frontmatter contracts and parser/renderer conformance.
- Native host tools can bypass the local kernel; all supported hosts are accurately reported as kernel-mediated rather than sandboxed.
- Real same-user concurrent path swaps remain outside workspace confinement until handle-relative no-follow I/O or OS isolation is selected.

## Second independent review

**Reviewer ID:** `github-copilot-reviewer/local/issue-2/2026-09-01-strict-rereview`
**Decision:** CHANGES REQUESTED
**Counts:** Critical 0, High 2, Medium 2, Low 0

| ID | Finding | Disposition |
|---|---|---|
| H1 | A pre-existing junction in the runtime runs-root path redirected run state outside confinement. | Resolved by checking the complete existing ancestor chain for repository, policy, fixture, runs, run, state, workspace, and receipt paths before reads or creation; covered by a real junction regression. |
| H2 | A forged target manifest could claim and delete an unrelated regular file. | Resolved by strict manifest parsing, exact catalog/profile path authorization, current target hash verification, and matching generated provenance before any orphan deletion. |
| M1 | Folded YAML descriptions bypassed unmanaged duplicate-rule inference. | Resolved by parsing inline, folded, and literal top-level frontmatter scalars; the unmanaged duplicate regression now uses folded YAML. |
| M2 | PID reuse could strand an abandoned event lease. | Resolved with a validated ten-minute lease expiry in addition to PID and random token. An expired lease is recoverable even when the PID is live; active unexpired leases remain exclusive. |

The second review requires another clean read-only verdict after fresh complete verification.

## Third independent review

**Reviewer ID:** `github-copilot-reviewer/local/issue-2/2026-09-01-clean-slate-final`
**Decision:** CHANGES REQUESTED
**Counts:** Critical 0, High 2, Medium 2, Low 1

| ID | Finding | Disposition |
|---|---|---|
| H1 | A forged manifest and forged bytes at a catalog-authorized path could still be deleted. | Resolved by independently rendering every supported and generic output from trusted source. Manifest identity and hashes plus current bytes and provenance must exactly match that independent output before deletion. |
| H2 | A nested repository junction could supply trusted runtime assets. | Resolved with bounded confined reads for prompts, skills, rubrics, contracts, provider fixtures, schemas, policies, profiles, catalog, and MCP data. |
| M1 | Direct `FileRunStore.load` parsed linked metadata before confinement validation. | Resolved by validating the full requested root and reading bounded regular metadata through the confined file helper before parsing. |
| M2 | A future-dated lease could block beyond the claimed limit. | Resolved by rejecting acquisition beyond one minute of clock skew and using the earlier of recorded expiry or observed file modification plus ten minutes. |
| L1 | Lease documentation contradicted expiry-based PID-reuse recovery. | Resolved across the specification, plan, learning, and runbook. |

The third review requires a final clean read-only verdict after fresh complete verification.

## Approval rule

A fresh independent read-only review must report zero Critical, High, and Medium findings after all remediations. Any later behavioral change invalidates that approval.