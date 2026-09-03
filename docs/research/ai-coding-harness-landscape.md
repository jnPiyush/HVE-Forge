<!-- Purpose: Source-backed landscape for the HVE-Forge AI coding harness. -->

# AI Coding Harness Landscape

**Research baseline:** 2026-08-31  
**Retrieval date:** 2026-08-31  
**Scope:** Coding-agent runtimes, durability patterns, protocols, security guidance, evaluation methodology, and provider interfaces.

## Executive findings

1. The durable unit is not a chat transcript. Leading systems converge on typed threads, turns, items, events, checkpoints, repository-local plans, and resumable state.
2. Model output remains probabilistic. Determinism belongs in the outer state machine, policy, fixtures, tool effects, event ordering, and replay.
3. Repository legibility is a force multiplier. A short instruction index, scoped `AGENTS.md` files, progressive skill loading, executable plans, and mechanically enforced architecture outperform one giant prompt.
4. Tool use is a security boundary. Validation, policy, approval, operating-system enforcement, idempotency, output bounds, and audit evidence must be independent of model intent.
5. Self-review is insufficient at the edge of model capability. A read-only evaluator bound to final hashes and runtime evidence is useful, but only after deterministic checks and only where measured lift justifies its cost.
6. Public coding benchmarks are complementary signals, not a release oracle. Fresh private tasks and repository-specific holdouts are required to measure the harness rather than memorized benchmark solutions.
7. Current protocol and telemetry surfaces are moving. MCP `2026-07-28` is current; OpenTelemetry GenAI conventions moved to a dedicated repository and remain a compatibility risk. Both stay behind versioned adapters.

## Source register

| Source | Publisher | Version or date | Status | Relevant finding | Confidence | Design impact |
|---|---|---:|---|---|---|---|
| [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | Anthropic | 2025-11-26 | stable article | Incremental work, structured feature state, git history, progress artifacts, and real end-to-end testing reduce premature completion and broken handoffs. | High | Persist structured progress and require behavioral evidence before completion. |
| [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps) | Anthropic | 2026-03-24 | stable article | Compaction and clean reset/handoff solve different problems; generator/evaluator separation and pre-slice contracts improve quality; excess scaffolding should be removed when it no longer adds measured lift. | High | Implement both continuity modes, contract handshake, read-only evaluation, and later ablation tests. |
| [Harness engineering](https://openai.com/index/harness-engineering/) | OpenAI | 2026-02-11 | stable article | Agent throughput depends on repository legibility, worktree-local runtime evidence, short instruction maps, structural lints, and continuous entropy cleanup. | High | Make repository artifacts authoritative and architecture constraints executable. |
| [Unlocking the Codex harness](https://openai.com/index/unlocking-the-codex-harness/) | OpenAI | 2026-02-04 | stable article | Codex App Server exposes durable thread/turn/item lifecycles, streaming events, approvals, forks, archives, and diffs over bidirectional JSONL/stdio. | High | Borrow conversation primitives and reconnectable event semantics; keep integration optional because it is provider-specific. |
| [Codex ExecPlans](https://developers.openai.com/cookbook/articles/codex_exec_plans.md) | OpenAI | 2025-10-07, retrieved 2026-08-31 | stable guidance | Long tasks need self-contained living plans with progress, discoveries, decisions, exact commands, observable outcomes, and recovery. | High | A living execution plan is the cross-context source of truth. |
| [Why SWE-bench Verified no longer measures frontier coding capabilities](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/) | OpenAI | 2026-02-23 | stable research article | In audited difficult failures, 59.4% had material task/test issues; public tasks also showed contamination. | High | Do not use SWE-bench Verified as the primary release signal. Review task-test alignment and use temporal/private holdouts. |
| [MCP 2026-07-28](https://blog.modelcontextprotocol.io/posts/2026-07-28/) | Model Context Protocol project | 2026-07-28 | stable specification release | Current core is stateless and self-describing; optional `server/discover`, per-request `_meta`, MRTR, cache hints, Tasks extension, subscriptions, hardened authorization, and formal deprecations replace session-bound assumptions. | High | Pin `2026-07-28`; implement a dated conformance matrix behind an adapter. Do not adopt deprecated Roots, Sampling, Logging, legacy SSE, or new DCR dependencies. |
| [MCP draft](https://modelcontextprotocol.io/specification/draft) | Model Context Protocol project | retrieved 2026-08-31 | draft | Extensions are negotiated and optional; Tasks, Skills over MCP, and MCP Apps must not be assumed. Tool metadata and remote content are untrusted. | High | Capability-negotiate extensions and degrade only dependent features. |
| [Agent Skills specification](https://agentskills.io/specification) | Agentic AI Foundation ecosystem | retrieved 2026-08-31 | stable core, experimental `allowed-tools` | Skills use `SKILL.md` metadata and progressive disclosure; resources load only when needed. | High | Validate names, metadata, size, references, hashes, licenses, provenance, and compatibility before activation. |
| [AGENTS.md](https://agents.md/) | Agentic AI Foundation | retrieved 2026-08-31 | stable open format | Nearest nested instruction file wins; standard Markdown has no required schema. | High | Discover scoped files from workspace root to target and report conflicts and hashes. |
| [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) | OWASP GenAI Security Project | 2025-12-09 | stable guidance | Agentic systems add goal hijacking, tool misuse, identity abuse, supply-chain compromise, unexpected code execution, memory poisoning, insecure inter-agent communication, cascading failures, human trust exploitation, and rogue behavior. | High | Threat-model every category and enforce identity, policy, limits, evidence, and human approval outside prompts. |
| [OWASP GenAI LLM Top 10 2026](https://genai.owasp.org/resource/owasp-genai-llm-top-10-2026/) | OWASP GenAI Security Project | 2026-08-03 | stable guidance | The current LLM-specific baseline complements agentic risks; retrieved 2025 page content is obsolete for the 2026 baseline. | Medium | Track the 2026 document as authoritative and keep older category mappings marked superseded. |
| [OpenTelemetry GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai) | OpenTelemetry | repository split in 2026; retrieved 2026-08-31 | development/unknown per signal | GenAI definitions moved to a dedicated repository, have no published release or schema URL, and are actively changing. | High | Keep a stable internal telemetry vocabulary and map to OTel only in an exporter adapter. |
| [SWE-bench Pro](https://scaleapi.github.io/SWE-bench_Pro-os/) | Scale AI and collaborators | paper 2025; retrieved 2026-08-31 | active benchmark | 1,865 long-horizon problems from 41 repositories with public, held-out, and commercial partitions; current public results use a unified scaffold and confidence intervals. | High | Use as a complementary long-horizon signal, pin dataset/scaffold/budget, and retain task-level failures. |
| [SWE-rebench](https://swe-rebench.com/) | SWE-rebench/Nebius collaborators | v2, retrieved 2026-08-31 | active continuous benchmark | Fresh time-windowed GitHub tasks, repeated runs, confidence intervals, token/cost reporting, and contamination inspection reduce static benchmark decay. | High | Prefer temporal splits and repeated runs; never compare different windows without qualification. |
| [Terminal-Bench 4.0](https://www.tbench.ai/news/terminal-bench-4-0) | Stanford/Harbor/Laude collaborators | 4.0.0, 2026 | stable benchmark release | Resource calibration, eight-hour limits, fixed tasks, removed saturated/public-solution tasks, and semantic benchmark versioning reduce infrastructure noise. | High | Weight terminal/recovery behavior heavily and treat major benchmark versions as non-comparable. |
| [ProgramBench](https://programbench.com/) | Meta, Stanford, Harvard collaborators | 2026, updated 2026-08-16 | active benchmark | 200 clean-room program reconstruction tasks, no internet/decompilation, and more than 248,000 behavioral tests probe holistic architecture and implementation. | High | Add whole-program and behavioral-equivalence tasks beyond issue fixing. |
| [CodeClash](https://codeclash.ai/) | Academic collaborators | 2025-11 | experimental research benchmark | Goal-driven agents compete over 15 rounds; observed failures include weak iteration and rapidly decaying codebases. | High | Measure improvement over rounds, goal attainment, churn, and technical-debt growth, not just ticket closure. |
| [OpenAI Responses API](https://developers.openai.com/api/reference/responses/overview) | OpenAI | retrieved 2026-08-31 | stable current API | Responses is the current agent API; Assistants was sunset 2026-08-26. It supports stateful continuation, streaming, tools, and reasoning state. | High | Implement only Responses, preserve opaque provider items, and do not add Assistants compatibility. |
| [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages) | Anthropic | retrieved 2026-08-31 | stable API with versioned/preview tools | Messages supports SSE, strict tools, JSON Schema 2020-12, adaptive/opaque reasoning continuity, token counting, caching, pause/resume, and detailed usage. Sampling parameters are deprecated for post-4.6 models. | High | Capability-negotiate rather than emitting unsupported sampling fields; preserve signed opaque reasoning handles without storing hidden reasoning text. |

## Leading open-source harnesses

Repository metadata was queried through the GitHub API on 2026-08-31. Counts are volatile and are recorded only as a maintenance/activity signal.

| Repository | Primary language | License | Stars (retrieved) | Last push | Assessment |
|---|---|---|---:|---:|---|
| [openai/codex](https://github.com/openai/codex) | Rust | Apache-2.0 | 120,420 | 2026-08-31 | Strongest reusable full coding harness and App Server integration surface; highest OpenAI coupling. |
| [anthropics/claude-code](https://github.com/anthropics/claude-code) | Python metadata | license not identified by API | 143,567 | 2026-08-28 | Strong coding UX and skills ecosystem; redistribution/integration license must be reviewed before embedding. |
| [OpenHands/OpenHands](https://github.com/OpenHands/OpenHands) | TypeScript | MIT | 85,758 | 2026-08-31 | Broad self-hosted platform and sandbox experience; large operational and dependency surface. |
| [cline/cline](https://github.com/cline/cline) | TypeScript | Apache-2.0 | 67,233 | 2026-08-31 | Mature IDE/CLI/SDK surface and provider breadth; UI-centric architecture is not the desired policy kernel. |
| [Aider-AI/aider](https://github.com/Aider-AI/aider) | Python | Apache-2.0 | 48,629 | 2026-05-22 | Proven repository-map and narrow-edit ideas; release activity is slower than leading alternatives. |
| [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) | Python | MIT | 40,794 | 2026-08-30 | Strong checkpoint and graph workflow semantics; adopting it would make Python/framework state authoritative. |
| [continuedev/continue](https://github.com/continuedev/continue) | TypeScript | Apache-2.0 | 35,713 | 2026-08-31 | Useful IDE/provider integration reference; not a minimal durable kernel. |
| [openai/openai-agents-python](https://github.com/openai/openai-agents-python) | Python | MIT | 29,099 | 2026-08-31 | Lightweight handoffs, tracing, and guardrails; still provider/framework-shaped. |
| [SWE-agent/SWE-agent](https://github.com/SWE-agent/SWE-agent) | Python | MIT | 20,177 | 2026-08-24 | Strong evaluation scaffold and trajectory research; optimized for benchmark tasks rather than operator control. |
| [RooCodeInc/Roo-Code](https://github.com/RooCodeInc/Roo-Code) | TypeScript | Apache-2.0 | 24,319 | 2026-05-15 | Feature-rich IDE harness, but archived at retrieval time. Do not select as a new foundation. |
| [microsoft/agent-framework](https://github.com/microsoft/agent-framework) | unavailable in query | unknown in this run | unavailable | unavailable | GitHub API access was blocked by organization SSO; local guidance marks packages preview. Treat as preview until first-party metadata is revalidated. |

## Strategy comparison

Scores use 1 (poor) to 5 (strong). Security, durability, portability, and lock-in are weighted highest because they determine whether completion and recovery can be enforced rather than prompted.

| Criterion | Weight | Codex App Server/SDK | Agent SDK/workflow runtime | Focused runtime plus provider/MCP ports |
|---|---:|---:|---:|---:|
| Functional fit | 3 | 4 | 4 | 5 |
| Portability | 3 | 1 | 4 | 5 |
| Sandbox control | 3 | 3 | 2 | 4 |
| Session durability/replay | 3 | 3 | 4 | 5 |
| Tool and MCP support | 2 | 4 | 4 | 4 |
| Event streaming | 2 | 5 | 3 | 4 |
| Observability/evaluation | 2 | 3 | 4 | 4 |
| Extensibility | 2 | 2 | 4 | 5 |
| Operational burden | 2 | 5 | 4 | 2 |
| License clarity | 1 | 5 | 4 | 5 |
| Security review surface | 3 | 2 | 3 | 4 |
| Runtime cost control | 2 | 3 | 4 | 5 |
| Low lock-in | 3 | 1 | 3 | 5 |
| **Weighted total / 155** | | **91** | **110** | **137** |

### Decision implication

Use a focused .NET 10 modular monolith for the deterministic policy-and-replay kernel. Borrow Codex thread/turn/item and streaming patterns, LangGraph checkpoint concepts, Aider repository-map techniques, and benchmark trajectory practices. Integrate maintained runtimes only through leaf adapters after their behavior passes shared conformance tests.

This decision does not justify rebuilding every framework feature. The first release excludes live model calls, arbitrary shell, remote writes, deployment, web UI, generalized multi-agent graphs, and long-term user memory. A provider-neutral claim is prohibited until at least two live adapters pass the same contract tests.

## Capability maturity matrix

| Capability | Maturity on 2026-08-31 | Initial treatment |
|---|---|---|
| .NET 10 runtime and CLI | stable | Core implementation platform. |
| JSONL append-only events and SHA-256 chains | stable primitives | Owned kernel. |
| OpenAI Codex App Server | stable first-class Codex integration | Optional provider-specific adapter after MVP. |
| OpenAI Responses API | stable current API | Planned live adapter; no credentials in MVP. |
| Anthropic Messages API | stable with versioned preview tool variants | Planned live adapter; capability-gated. |
| Microsoft Agent Framework packages | preview per current local guidance | No core dependency; optional experiment only. |
| LangGraph checkpoint runtime | stable active project | Reference design, not core dependency. |
| MCP `2026-07-28` core | stable current release | Version-pinned adapter and conformance fixtures. |
| MCP Tasks | stable opt-in extension | Adapter feature flag after core MCP. |
| Skills over MCP | experimental/working-group | Disabled by default. |
| MCP Apps | opt-in extension | Out of MVP; requires separate UI security review. |
| Agent Skills core format | stable | Local metadata/instruction loader. |
| Agent Skills `allowed-tools` | experimental | Advisory only; organization policy remains authoritative. |
| OpenTelemetry core API | stable | Internal tracing API may export through OTel. |
| OpenTelemetry GenAI semantic conventions | development/unknown per signal | Versioned exporter mapping, never domain types. |
| A2A 1.0 | not revalidated in this research pass | Out of scope until remote peer agents are requested. |

## Evaluation direction

- Every commit: deterministic state, policy, schema, replay, hostile-result, and recovery tests with no credentials or network.
- Pre-release: private repository tasks and fresh temporal tasks run repeatedly on pinned model, prompt, policy, tool, image, and budget versions.
- Complementary external evidence: SWE-bench Pro for long-horizon issue work, SWE-rebench for freshness, Terminal-Bench 4.0 for terminal/tool behavior, ProgramBench for holistic construction, and CodeClash for iterative goal pursuit.
- Required metrics: verified completion, false completion, recovery, policy violations, edit churn, hidden-test success, evaluator-human agreement, p50/p95 duration, input/output/cached tokens, and cost per solved task.
- Never publish a single score without task version, scaffold, environment, model snapshot, effort, budget, repetitions, confidence interval, and failure samples.

## Revalidation backlog

1. Revalidate the official OWASP GenAI LLM Top 10 2026 category text and downloadable version before final security certification.
2. Revalidate Microsoft Agent Framework repository, license, stable/preview status, and .NET package versions after SSO access is available.
3. Revalidate exact OpenAI Responses SDK shapes and immutable model snapshots when a live adapter is implemented.
4. Revalidate Anthropic model IDs and supported parameters from model metadata rather than static configuration.
5. Revalidate the OpenTelemetry GenAI signal status and pin an exporter mapping version before enabling production export.
6. Revalidate A2A only if opaque remote peer agents become in scope.
