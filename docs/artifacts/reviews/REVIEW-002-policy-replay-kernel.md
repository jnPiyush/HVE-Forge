<!-- Purpose: Durable pre-implementation finding register for issue #2. -->

# Review: Policy and Replay Kernel Readiness

**Issue:** https://github.com/jnPiyush/HVE-Forge/issues/2
**Mode:** Pre-implementation architecture readiness
**Reviewer:** AgentX Architect (independent subagent)
**Review date:** 2026-08-31
**Artifacts reviewed:** Research landscape, ADR-001, council, threat model, execution plan, active contract, technical specification, and v1 schemas
**Initial decision:** CHANGES REQUESTED
**Current disposition:** APPROVED for implementation on 2026-08-31 (0 HIGH, 0 MEDIUM, 8 LOW)

## Initial HIGH findings

| ID | Finding | Required correction | Disposition |
|---|---|---|---|
| H1 | Repeated signature included the full projection hash and collided with a two-dispatch limit, making the guard unreachable or ambiguous. | Hash tool name, normalized argument hash, and workspace hash; exclude event-only fields; define guard order; make fixture budgets allow a third attempt. | Resolved in contract AC-9 and spec section 4. |
| H2 | Canonicalization was load-bearing but did not define key ordering, numbers, string escaping, time precision, or event-hash omission. | Define a named restricted canonical algorithm, integer money, exact omission rules, and golden vectors. | Resolved in contract AC-12 and spec section 4. |
| H3 | Evidence schema could not express mandatory bindings and required a Git commit for non-Git fixtures; handoff had the same Git assumption. | Add policy, instruction, provider, arguments, idempotency, file hash, verifier, and fixture bindings; make Git metadata optional. | Resolved in evidence and handoff v1 schemas. |
| H4 | Runtime records were not mechanically bound to public schemas. | Add blocking emitted-record validation with a named test-only validator and keep production free of validator dependencies. | Resolved in contract AC-13 with JsonSchema.Net 5.4.2 test-only validation. |

## Initial MEDIUM findings

| ID | Finding | Required correction | Disposition |
|---|---|---|---|
| M1 | Decision/tool budget counters used three incompatible vocabularies. | Use decisions and tool dispatches consistently. | Resolved across task, checkpoint, projection, handoff, contract, and spec. |
| M2 | Spec allowed read/search tools and `stream`, while the slice contract allowed one replacement tool and no stream contract. | Restrict slice 1 to exact replacement and defer read/search/stream. | Resolved in spec sections 5 and 6. |
| M3 | Evaluator data-flow diagrams implied direct store/workspace access and disagreed about its owning layer. | Place a pure evaluator in Application and pass immutable Domain values through the orchestrator only. | Resolved in spec, ADR alignment, and threat-boundary diagram. |
| M4 | Evaluator capability JSON was described as proof of read-only behavior. | Treat it as a declaration and prove isolation with architecture tests and absent dependencies. | Resolved in spec section 9. |
| M5 | The mutation boundary attempted to manifest every filesystem path outside the run root. | Restrict verification to the immutable source fixture and caller-declared protected roots. | Resolved in contract AC-2. |
| M6 | Published weighted option totals did not reproduce. | Correct totals from 84/107/137 to 91/110/137 and state ranking is unchanged. | Resolved in landscape and ADR. |
| M7 | Optional real reparse tests conflicted with mandatory Infrastructure branch coverage. | Inject path metadata for deterministic branch coverage and keep a conditional real NTFS integration test. | Resolved in contract AC-11. |
| M8 | Locked restore was blocking while the public feed probe failed. | Confirm required packages and schema validator are cached, name the enabled source, retain locked restore, and require CI freshness revalidation. | Locally mitigated in plan and specification; locked restore remains the implementation gate. |

## Follow-up finding

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| F1 | MEDIUM | The H1-H4/M1-M8 finding register existed only in transient subagent output. | Resolved by this repository artifact and contract citation. |

## Tracked LOW findings

| ID | Finding | Planned handling |
|---|---|---|
| L1 | Event payload validation was envelope-only. | Add event-type keyed payload subschemas before runtime emission. |
| L2 | Consecutive signatures do not detect oscillating A/B mutations. | State the limitation; hard budgets remain the slice guard. |
| L3 | Exit code 1 was undefined. | Reserve 1 and map every unhandled exception to 10. |
| L4 | C# language version floated with the SDK. | Pin C# 14.0 in spec and build properties. |
| L5 | Evidence source commit was optional in schema but presented as unconditional in spec. | Document null for copied non-Git fixtures. |

## Entry gate

Implementation may begin only after a fresh independent recheck reports zero HIGH and zero MEDIUM findings against the final design files and confirms that event payload schemas are precise enough for the first emitted records.

## Final independent recheck

The AgentX Architect re-read the final design and all v1 schemas after F1 and L1-L5 corrections. Verdict: `APPROVED`, HIGH 0, MEDIUM 0, LOW 8. The reviewer confirmed the H1-H4 and M1-M8 dispositions, reproduced the strategy totals, verified all 15 event types have keyed payload schemas, and selected canonical JSON golden vectors as the cheapest first implementation test.

Remaining LOW items are bounded: oscillation relies on budgets; slice verification distinguishes built-in checks from executable test discovery; no-instruction selection uses the empty-byte digest; default deny has a named policy rule; canonical tool values exclude floating point; cross-run comparison uses semantic trace rather than physical projection; projection time derives from the last event; and evaluator flow is through Application.
