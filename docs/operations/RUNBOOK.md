# HVE-Forge Operations Runbook

## Supported operating mode

Version 0.2 is a local, fail-closed TypeScript/Node harness for Windows, macOS, and Linux. It renders native VS Code, Cursor, and Claude Code customizations and executes deterministic recorded-provider fixture runs. It does not register process, shell, network, browser, secret, remote-write, deployment, or live-provider capabilities.

## Clean setup

1. Install the Node patch in `.node-version` and npm version in `package.json`.
2. Install exactly with lifecycle scripts disabled: `npm ci --ignore-scripts`.
3. Run the quality gate: `npm run quality`.
4. Build: `npm run build`.
5. Inspect package contents with `npm run check:package` and generate the SBOM with `npm run sbom`.

Do not replace `npm ci` with an unlocked install in CI. Do not enable package lifecycle scripts.

## Install editor customizations

- First render: `hve init --target-root <repository> --hosts vscode,cursor,claude`
- Rerender: `hve render --target-root <repository> --hosts vscode,cursor,claude`
- Remove clean stale outputs: `hve update --target-root <repository> --hosts vscode,cursor,claude`
- Verify drift: `hve render --check --target-root <repository> --hosts vscode,cursor,claude`
- Diagnose capabilities: `hve doctor --target-root <repository> --hosts vscode,cursor,claude`

Rendering never overwrites unknown or locally modified generated files. Resolve conflicts explicitly; do not delete the manifest to bypass ownership checks.

Multi-host installs intentionally use one `.claude/agents` and `.claude/skills` copy because VS Code and Cursor both support the Claude compatibility locations. Do not add equivalent copies under `.github/agents`, `.cursor/agents`, `.agents/skills`, or `.cursor/skills` in the same workspace.

An update computes its complete plan before writing and replaces each output atomically, but the set of files is not one filesystem transaction. After interruption, rerun `update`; it reconciles clean completed outputs, refuses locally modified files, and removes clean obsolete manifest-owned outputs. Do not delete the manifest to bypass a conflict.

The target manifest is not deletion authority by itself. Orphan pruning independently renders trusted outputs for every supported profile and generic mode, then requires exact path, logical/source identity, source hash, output hash, current bytes, and generated provenance. Unknown or forged ownership fails closed and requires manual inspection.

## Run a fixture task

`hve run --repository-root <HVE-Forge checkout> --quiet`

The final JSON record contains the run root, status, final event head, projection hash, semantic trace hash, and redacted messages. Raw run state lives under `.hve/runs/<run-id>/` and remains ignored.

## Inspect and stream

- Inspect final projection: `hve inspect <run-root>`
- Read events after a cursor: `hve stream <run-root> --after 10`
- Inspect effective instructions: `hve instructions --workspace <workspace> --target <relative-path>`
- Inspect skills: `hve skills`
- Activate one skill: `hve skills --activate exact-text-replacement`
- Inspect MCP status: `hve mcp`

## Pause, resume, retry, and fork

- Pause at a durable boundary: `hve pause <run-root>`
- Resume the same run: `hve resume <run-root>`
- Retry: `hve retry <run-root>`; terminal runs fork a fresh run from the immutable source fixture.
- Fork explicitly: `hve fork <run-root>`
- Cancel: `hve cancel <run-root>`

## Reset with a handoff packet

1. Export: `hve handoff <run-root> --destination <handoff.json>`.
2. Start a clean process or context.
3. Resume: `hve reset <handoff.json>`.

Reset verifies run ID, task ID, event-chain head, source fixture hash, and workspace hash before continuing. A stale or modified packet fails with replay-integrity exit code 6.

## Replay

`hve replay <run-root>` reconstructs the projection from hash-chained events. It never invokes provider or tool ports. Unknown schemas, malformed records, gaps, duplicates, and tampering fail closed.

## Archive

`hve archive <run-root> --destination <archive.zip>` creates an evidence-only review package. The destination must not be inside the run root and must not already exist. The package excludes `workspace/`, `source/`, `state/run.json`, runtime contract assets, and encrypted replacement intent. It includes hash-bound internal verification/evaluation records, public evidence, events, projection, checkpoint, tool metadata, and `archive-manifest.json`. The CLI returns package byte length and SHA-256; retain that output separately to verify delivery. This archive is not a source backup.

`hve stream` performs a finite read of events after the requested sequence and exits. Persistent subscriptions and reconnect semantics are not implemented in version 0.1.

## Stable exit codes

| Code | Meaning |
|---:|---|
| 0 | Completed |
| 2 | Invalid invocation |
| 3 | Policy denied |
| 4 | Limit exceeded |
| 5 | Repeated signature |
| 6 | Replay integrity failure |
| 7 | Evaluation rejected |
| 8 | Interrupted or paused fixture |
| 9 | Cancelled |
| 10 | Internal failure |
| 11 | Blocked |

Exit code 1 is reserved.

## Troubleshooting

- Restore failure: confirm the pinned SDK and enabled package sources; do not delete lock files to bypass a mismatch.
- Policy mismatch on resume: restore the exact policy bytes or fork a fresh run after reviewed policy change.
- Replay failure: preserve the run directory, verify event bytes, and do not truncate or repair silently.
- Path rejection: use a relative path beneath the copied workspace; junctions, symlinks, reparse points, device paths, UNC paths, traversal, and alternate data streams are denied.
- Schema failure: compare the public state artifact with `schemas/v1/`; unsupported major versions must be migrated, not guessed.
- Coverage failure: inspect `coverage/coverage-summary.json` and `coverage/lcov.info`.
- Event lease contention: allow the active writer to finish. A dead PID is reclaimed immediately; a reused PID cannot block beyond the validated ten-minute lease expiry. Never delete a live lease by hand.
- Render conflict: inspect `.hve/host-manifest.json`; preserve operator-owned bytes.
- Host warning: `kernel-mediated` and `declarative` mean native tools can bypass CLI controls.

## Rollback

No production deployment exists. Restore the prior signed package and host manifest, rerender, and verify with `render --check` plus `doctor`. Preserve `.hve` incident evidence. Revert through a normal Git commit; never rewrite shared history.
