# Architecture

HVE-Forge is initially a local-only modular monolith. `domain` has pure task state
rules, `store` is the durable append-only SQLite event log, `policy` validates
filesystem and command boundaries, and `runtime` orchestrates a provider port.
The CLI is an adapter and emits reconnectable ordered JSON events.

```
CLI -> runtime -> domain
                 -> store (SQLite events)
                 -> policy -> isolated workspace / subprocess
                 -> provider port
```

The shipped deterministic fixture provider is deliberately not a live-model
integration. Live provider, network/MCP, remote writes, credentials, and
deployment are out of scope and fail closed until adapters and explicit policy
are implemented.
