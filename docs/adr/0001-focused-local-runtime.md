# ADR 0001: Focused local runtime

## Decision

Use a dependency-free, provider-neutral local runtime for the first executable
slice. It has a durable state machine, strict edit boundary, isolated
workspace command runner, and fixture provider.

## Options considered

| Option | Fit | Portability | Operational burden | Decision |
|---|---:|---:|---:|---|
| Embed a coding runtime | high | low | medium | defer: provider coupling |
| Agent SDK/workflow runtime | high | medium | high | defer: adds unvalidated dependency |
| Focused provider/MCP ports | medium | high | low | chosen for MVP |

The port boundary allows later integration after live SDK capability, license,
security, cost, and session durability validation.
