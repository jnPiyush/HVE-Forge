# AI coding harness landscape

Retrieved 2026-08-31. Features not represented by the local MVP remain
`unknown` pending live capability validation.

| Source | Publisher/version | Finding | Confidence | Design impact |
|---|---|---|---|---|
| https://modelcontextprotocol.io/specification/2026-07-28 | MCP, 2026-07-28 baseline | MCP has negotiated client/server capabilities and JSON-RPC boundaries. Status: `unknown` (not live-verified). | medium | Keep MCP outside a future adapter port. |
| https://agentskills.io/specification | Agent Skills, retrieved 2026-08-31 | Skills are directory-based metadata/instructions/resources. Status: `unknown`. | medium | Do not load downloaded skills in MVP. |
| https://agents.md/ | AGENTS.md, retrieved 2026-08-31 | Repository instructions have scoped discovery semantics. Status: `unknown`. | medium | Fixture requires root `AGENTS.md`; nested discovery is deferred. |
| https://platform.openai.com/docs/codex | OpenAI Codex platform, retrieved 2026-08-31 | Provider/runtime APIs require current capability validation. Status: `unknown`. | low | Provider is a swappable port, not a dependency. |
| https://owasp.org/www-project-top-10-for-large-language-model-applications/ | OWASP, retrieved 2026-08-31 | Prompt injection and excessive agency require defense in depth. | high | Strict tool and OS-level boundaries are MVP priorities. |
| https://opentelemetry.io/docs/specs/semconv/gen-ai/ | OpenTelemetry, retrieved 2026-08-31 | GenAI semantic conventions evolve. Status: `unknown`. | medium | Telemetry remains an adapter work item. |

The requested future-dated Anthropic/OpenAI articles and 2026 benchmark claims
are not treated as verified facts here; live retrieval is required before a
release decision.
