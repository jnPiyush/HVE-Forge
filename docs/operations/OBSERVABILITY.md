# HVE-Forge Observability

## Internal signal contract

Instrumentation name: `HveForge.Harness`  
Instrumentation version: `1.0.0`

The internal signal vocabulary is stable and provider-neutral. OpenTelemetry GenAI semantic conventions are mapped only in a versioned exporter because their signal stability is not assumed.

## Trace hierarchy

`task -> agent run -> turn -> provider decision or tool call -> handoff -> evaluation`

The local Node runtime emits a structured metadata-only JSONL stream under `.hve/telemetry/events.jsonl`. Records include schema version, instrumentation identity, run ID, sequence, event type, timestamp, and event hash. Content is not captured. Prompt text, file bytes, tool arguments, model content, secrets, and PII are excluded by default.

## Required production metrics

- Verified completion and false-completion rate.
- Human interventions and approval latency.
- Turns, tool failures, retries, stalls, and unchanged iterations.
- Context utilization, compactions, resets, and handoff validation failures.
- Input, output, reasoning, and cached tokens.
- Cost per attempted and solved task.
- Queue, model, tool, verification, and total wall time.
- Policy, sandbox, and security blocks.
- Evaluator findings by severity and evaluator-human agreement.

## Useful local queries

Use any JSONL-capable tool to group `.hve/telemetry/events.jsonl` by `eventType`. Inspect `<run-root>/state/events.jsonl` for the ordered event timeline. The CLI `stream` command emits records after a sequence cursor without requiring PowerShell or another runtime.

## Privacy and retention

Metadata-only telemetry is the default. Content capture requires an explicit feature, separate encryption key, tighter authorization, regional and retention policy, deletion support, and an updated threat model. Successful traces should be sampled in production; errors and security events should have higher retention without secret values.
