<!-- Purpose: Record three independent perspectives and synthesis for ADR-003. -->

# Model Council: Cross-Editor TypeScript Harness

**Date:** 2026-09-01
**Decision scope:** Cross-editor distribution and migration away from .NET

## Perspective 1: Architecture

Use Agent Skills as the portable workflow unit, host-neutral canonical agents/rules, typed host profiles, deterministic rendering, and a TypeScript kernel. Reject independent host copies, `.github`-only authoring, and declarative-only assurance. MCP is optional execution plumbing, not the instruction plane.

Key concern: capability degradation must be visible. A host that lacks blocking hooks cannot be described as enforcing the same boundary as a host whose native lifecycle can invoke the kernel.

## Perspective 2: Security and Reliability Skeptic

Approve the renderer direction but reject a big-bang kernel deletion. Native host tools can bypass the kernel, hook failures can be fail-open, repository hooks are executable untrusted content, Node expands supply-chain risk, and filesystem durability differs by operating system.

Required gates include canonical byte parity, persisted event/replay parity, path attack matrices, transactional generation, no automatic hook activation, capability-loss reports, and a rollback window. The final product can remove .NET, but only after TypeScript evidence replaces it.

## Perspective 3: Operations and Delivery

Separate installer/renderer delivery from kernel migration. Ship host-native discoverability first, then implement and shadow the TypeScript kernel, then cut over capability by capability. Pin Node and all packages, disable lifecycle scripts, use SHA-pinned CI, generate an SBOM, and test Windows, macOS, and Linux.

Prevent duplicate discovery with stable logical IDs, a host scan-path matrix, minimal output paths, no symlinks, a generated manifest, and orphan detection.

## Synthesis

The perspectives agree on the destination and differ only on migration speed. HVE-Forge will use canonical host-neutral assets, typed host renderers, and a deterministic TypeScript/Node kernel. It will not maintain independent copies or rely on prompts/hooks as the security boundary. It will not keep .NET as the final developer runtime, but it will retain the current implementation temporarily as an offline parity oracle until TypeScript meets the frozen safety corpus.

The first implementation slice is the renderer and host diagnostics because it delivers the user's cross-editor objective while preserving the existing kernel as a rollback reference. Kernel replacement follows as a bounded, evidence-driven migration. Removal of .NET is a required final phase, not an immediate destructive step.

## Consensus Acceptance Gates

1. One canonical source per logical asset.
2. Exactly one discovered instance per host and logical ID.
3. Deterministic render with provenance, drift detection, and safe rollback.
4. Explicit enforced/advisory/unsupported control status per host.
5. No security invariant depends solely on a host hook.
6. TypeScript reproduces canonical bytes and frozen deterministic behavior.
7. Node installation and release are locked, script-disabled, audited, and SBOM-backed.
8. Windows, macOS, and Linux pass the same host and path-safety matrix.
9. Executable hooks and privileged adapters require explicit opt-in.
10. .NET removal occurs only after TypeScript parity evidence is complete.
