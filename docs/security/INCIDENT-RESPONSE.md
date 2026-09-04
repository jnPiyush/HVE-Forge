# HVE-Forge Incident Response

## Triggers

Activate this runbook for policy bypass, secret disclosure, event-chain tampering, unauthorized workspace effects, dependency compromise, provider/MCP compromise, false completion, uncontrolled cost, or cross-run data leakage.

## Immediate containment

1. Cancel active runs.
2. Disable live provider, MCP, network, process, secret, and remote-write adapters. Version 0.1 has these disabled by construction.
3. Preserve affected run state, event bytes, policy and asset hashes, evidence, telemetry metadata, package lock files, and executable hashes.
4. Remove credential injection from the worker. Do not print or copy secret values.
5. Rotate any potentially exposed credential at its issuer. Log deletion is not remediation.

## Investigation

1. Validate the event chain from sequence 1 and identify the first invalid or unauthorized transition.
2. Compare the run's pinned policy, prompt, skill, rubric, protocol, telemetry, tool-schema, fixture, and work-contract hashes.
3. Reproduce with sanitized deterministic replay. Replay must not invoke providers or effects.
4. Inspect approval identity, exact action hash, expiry, and policy decision. Agent messages are never approvals.
5. Check dependency locks, SBOM, provenance attestation, and package source history.
6. Review indirect prompt-injection sources and any persisted memory provenance/trust classification.

## Recovery

1. Patch the root cause and add a regression or adversarial test.
2. Re-run locked restore, warning-free build, complete suite, 80 percent line/branch gates, secret scan, dependency audit, and independent review.
3. Quarantine compromised prompts, skills, policies, fixtures, MCP servers, packages, or provider versions by hash.
4. Issue a new package and provenance attestation. Do not overwrite an existing artifact.
5. Restore capabilities one at a time behind explicit policy and operator approval.

## Communication

Publish a concise timeline containing scope, affected versions/runs, impact, containment, root cause, corrective actions, and evidence links. Exclude secrets, PII, hidden reasoning, and untrusted raw content.
