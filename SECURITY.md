# Security Policy

## Reporting a Vulnerability

HVE-Forge has not yet published a production release or a public support channel for
live deployments. If you discover a security issue in this repository:

1. Do not open a public GitHub issue for a suspected vulnerability.
2. Report it privately through the repository's GitHub Security Advisories
   ("Security" tab -> "Report a vulnerability") at
   <https://github.com/jnPiyush/HVE-Forge/security/advisories/new>.
3. Include the affected version or commit, a reproduction, and the expected versus
   observed behavior.

You should expect an initial acknowledgement within 5 business days. There is no paid
bug-bounty program.

## Supported Versions

| Version | Supported |
|---|---|
| 0.2.x (local, credential-free preview) | Yes, best effort |
| < 0.2.0 | No |

This project has not reached a stable production release. There is no live provider,
no arbitrary shell/process/network/browser tool, and no production secret handling in
the current preview; see the [README](README.md) "Explicitly unsupported" section and
[docs/security/ai-coding-harness-threat-model.md](docs/security/ai-coding-harness-threat-model.md)
for the current boundary.

## Scope

In scope:

- The deterministic kernel, CLI, host renderers, and VS Code extension in this repository.
- The bounded agent loop, policy engine, tool registry/dispatcher, and evidence/completion gates.
- The Cowork package build (`hve cowork-package`) and its manifest/icon/skill contract.

Out of scope:

- Vulnerabilities in third-party dependencies of the *host* editors (VS Code, Cursor,
  Claude Code) themselves; report those upstream.
- Findings that require a compromised or malicious local co-tenant with equivalent
  operating-system privileges; the current preview is explicitly not an OS sandbox
  (see [docs/security/CONTROLS-MATRIX.md](docs/security/CONTROLS-MATRIX.md)).
- Denial of service against your own local machine.

## Disclosure and Response

Confirmed vulnerabilities are tracked privately, fixed on a private branch, and
disclosed through a GitHub Security Advisory once a fix is available. See
[docs/security/INCIDENT-RESPONSE.md](docs/security/INCIDENT-RESPONSE.md) for the
incident-handling process this project follows internally.
