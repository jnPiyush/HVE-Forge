# Threat model and controls

| Threat | MVP control |
|---|---|
| Prompt/context injection | repository text is data; fixture permits a fixed edit only |
| Path traversal/symlink escape | resolved descendant check |
| Shell/command injection | argv only; `shell=False` |
| Credential exfiltration | sanitized subprocess environment; no network adapter |
| Tool misuse | exact edit schema validation |
| Audit tampering/replay | append-only ordered SQLite events and hash-bound evidence |
| Approval bypass | no external/destructive/privileged tools exist in MVP |
| Denial of service | command timeout and bounded output |

The remaining OWASP agentic risks (identity abuse, supply chain, inter-agent
communication, cascading behavior, trust exploitation, rogue behavior) are
not enabled capabilities in this local fixture and therefore fail closed.
