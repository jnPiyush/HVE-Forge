<!-- Purpose: Record three diverse model perspectives and the synthesis behind ADR-004. -->

# Model Council: ADR-004 Cross-Surface Execution and Provider Architecture

**Date:** 2026-09-02
**Decision under review:** How HVE-Forge should acquire real execution capability across VS Code, Cursor, Claude Code, and Cowork.
**Artifact:** `docs/artifacts/adr/ADR-004-cross-surface-execution.md`

## Perspective 1: Security and Supply-Chain Lens

**Position:** The default path must never hold a credential, and execution must not precede isolation.

The most dangerous version of this change is the obvious one: add an API-key provider, register a shell tool, and let a real model drive a multi-step loop. That combination converts a currently inert control plane into an arbitrary code execution service on the developer's machine, with a secret in the process image.

Routing the default through `vscode.lm` is the strongest available control, not merely a convenience. Authentication, consent, quota, and revocation move to VS Code. The harness cannot leak a key it never receives, and the user gets a native consent dialog they already understand.

Three conditions are non-negotiable. First, tools must be capability-classed and deny-by-default, so a read tool and a shell tool cannot be admitted by the same code path. Second, execute-class capability must fail closed until an isolation backend is registered, and enabling it must require a threat-model update and recorded human approval. Third, any off-machine send needs a hash-chained receipt written before the send, because after-the-fact logging is not tamper-evident.

The gstack untrusted-text envelope also matters more than it first appears. Once a loop reads issue text, file contents, and search results, every one of those is an injection surface. Labeling untrusted spans as data before they reach a prompt is cheap and must land with the tool registry, not after it.

**Primary risk called out:** a multi-decision loop shipped before oscillation controls and isolation.

## Perspective 2: Developer Experience and Adoption Lens

**Position:** Adoption dies at the credential prompt; Copilot-as-default is the decision that makes the harness usable.

Every harness that requires an API key before first value loses most of its potential users at step one. The user must find the console, create a key, understand billing, and accept spend risk for a tool they have not yet evaluated. AgentX's layered adapter strategy is right: default to what the user already has.

A large share of the target audience already has Copilot through their employer. Selecting Copilot-vendor chat models through the editor turns that into zero-configuration first value. The consent dialog is a one-click, familiar, revocable interaction rather than a setup task.

Two experience details deserve attention. The API forbids system messages and supports only user and assistant roles, so the existing prompt contract must be restructured rather than mapped one-to-one. And the maximum input token budget varies per model, so context assembly has to be budget-aware from the first version instead of being retrofitted after truncation bugs appear.

Cowork is a genuinely different shape and should not be forced into the scan-path model. It is a managed container with no terminal, no installation, and no outbound calls except through declared connectors, consuming an uploaded zip. Treating it as a package render target rather than a discovery root keeps the renderer honest.

**Primary risk called out:** over-building the extension surface before a single tool loop actually works end to end.

## Perspective 3: Systems Architecture and Maintenance Lens

**Position:** Add surfaces, not runtimes; the existing ports are already the right seams.

The strongest property of the current design is that the kernel is deterministic, dependency-free, and layered with enforced boundaries. The failure mode to avoid is a parallel agent runtime inside the extension that gradually diverges from the CLI. Two runtimes means two policy implementations and, eventually, two different answers to the same safety question.

The existing ports are sufficient. The model provider port needs to become message-and-tool-call shaped, but it stays one port. The workspace tool port already exists and needs a registry rather than a redesign. The loop's single-decision limit is a constant, not an architecture. Each surface then becomes a thin composition root over the same ports, which is exactly what the CLI already is.

gstack's host-adapter-as-config pattern validates the typed host profile approach from ADR-003; Cowork should extend the same table rather than introduce a special case. gstack's working-tree fingerprint is the more interesting borrow, because the current evidence model records that verification happened but not whether it still applies. Grading evidence FRESH or STALE against a content fingerprint converts evidence from a claim into a check.

The maintenance cost worth accepting is the extension build. The cost worth refusing is embedding provider logic in the kernel. The Language Model API must sit behind a narrow interface with a fake, so the kernel remains testable without an extension host.

**Primary risk called out:** provider or policy logic drifting into the extension and creating a second source of truth.

## Points of Agreement

- GitHub Copilot via `vscode.lm` is the correct default for VS Code; API keys stay optional.
- Tools must be capability-classed and deny-by-default rather than individually registered.
- Execute-class capability must remain unregistered until an isolation backend exists.
- Cowork is a package target, not a discovery root.
- The kernel stays dependency-free; surfaces are composition roots, not runtimes.
- gstack's evidence-freshness grading closes a real and currently open gap.

## Points of Disagreement

| Question | Security lens | DX lens | Architecture lens | Resolution |
|---|---|---|---|---|
| Build order | Trust boundary first | Working loop first | Ports first | Distribution trust, safe hosts, and trust envelopes precede tools and any live provider |
| Egress receipts | Required at step one | Deferrable | Required before any network tool | Provider receipt before every live model send; network-tool receipt before any network tool |
| Extension timing | After tools are safe | As early as possible | After the provider port is generalized | After the provider port and the loop, before execute-class tools |
| Direct API adapters | Discourage | Keep for non-Copilot users | Keep behind the same port | Keep, gated behind explicit approval |

## Synthesis

The council converges on a layered adoption of both reference harnesses rather than a rewrite of either.

The default execution path is GitHub Copilot through the VS Code Language Model API, because it delivers the adoption benefit the DX lens requires and simultaneously satisfies the security lens by removing credential custody from the harness. This is the rare decision where the safest option is also the easiest one, and it should be treated as the headline of the design.

Capability expansion is sequenced by trust boundary and then blast radius. Installed distribution assets are separated from the untrusted target first, and default host artifacts lose native privileged tools. Trust envelopes and bounded context assembly then land before read and search output can reach any live model. Read and search tools enter through a capability-classed, deny-by-default dispatcher. The provider port then generalizes to atomic turns with the recorded provider retained as the offline double. Only after that does the loop gain multiple decisions, together with oscillation detection and a stop-after-three-failed-fixes rule. Isolation precedes any execute-class tool without exception.

From gstack, the harness adopts trust envelopes before live retrieval, provider-egress receipts before live model sends, and working-tree evidence freshness before completion can be trusted. Network-tool receipts remain paired with the first approved network tool. From AgentX, the harness adopts lifecycle checkpoints, risk-based loop minimums with attributable reviewer verdicts, compound capture, and zero-copy initialization, all of which are process primitives that carry no runtime dependency.

Cowork is accepted as a fifth surface with a deliberately narrower contract. Its managed container forbids terminals and installation, so it receives instruction-only skills as an uploadable package rather than participating in kernel-mediated enforcement. Recording that asymmetry in the surface matrix is more valuable than pretending the tiers are equivalent.

The single guardrail the council weights most heavily is the architecture lens's warning about a second runtime. Every surface must remain a thin composition root over the same ports. If the extension ever answers a policy question differently from the CLI, the design has failed regardless of how well any individual feature works.

## Decision Alignment

ADR-004 reflects this synthesis. The selected option is Option E, which layers the Copilot extension default over optional direct API adapters behind a single port, with MCP retained as a future tool plane. No override rationale is required.
