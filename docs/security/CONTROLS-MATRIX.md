# HVE-Forge Security Controls Matrix

`Current` means enforced by the active fixture runtime. `Planned` means required before the named capability can be enabled and must not be cited as release evidence yet.

| Threat or requirement | Preventive control | Detective control | Evidence |
|---|---|---|---|
| Goal hijacking | Planned: origin-tagged context cannot alter policy, approval, or registration; current runtime has no live retrieval | Provider contract-expansion and injection tests | Pending live-path attack fixtures |
| Tool misuse | Current: exact replacement validates one confined operation. Planned: every tool crosses registry, schema, and deny-by-default dispatcher | Policy and denied-side-effect tests | Fixture policy tests; dispatcher evidence pending |
| Identity abuse | No ambient credentials; agent identity cannot approve | Approval identity tests | Approval gate suite |
| Supply-chain compromise | Pinned dependencies/actions, lock files, hashes | Dependency audit, CodeQL, SBOM | Lock files, CI, SBOM |
| Unexpected code execution | No process/shell capability in v0.2; package lifecycle scripts disabled | Architecture and package checks | Boundary test, package allowlist, `.npmrc` |
| Memory poisoning | Provenance, trust, scope, confidence, expiry, deletion | Memory validation/dedup tests | Memory schema and suite |
| Insecure inter-agent messages | Agent message is never human approval | Approval negative tests | Approval gate suite |
| Cascading failure | Hard decisions, dispatches, provider ceilings, stage time, token, and cost limits | Limit and handoff-budget tests | Projection, events, and handoff budget |
| Human trust exploitation | Current: fixture hash binding and read-only evaluation. Planned: full working-tree freshness and independent release identity | False-completion and stale-tree tests | Fixture evidence; freshness evidence pending |
| Rogue loops | Single-decision workflow and hard budgets | Decision/dispatch limit tests | Guard suite; multi-decision loop deferred |
| Path escape | Relative path, containment, device/ADS/trailing-name rejection, link checks immediately before mutation | Hostile path and link tests | Adapter suite |
| Secret disclosure | Classified references and redaction before sinks | Canary scan across stdout/stderr/state | E2E redaction test |
| Audit forgery | Current SHA-256 chain detects corruption and partial tampering; planned CI signature supplies authenticity | Metadata/event/artifact/archive tamper tests | Replay suite; trusted attestation pending |
| Stale completion | Current fixture workspace/projection/event/evaluator hash binding; planned tracked-and-untracked fingerprint | Stale and post-mutation tests | Completion suite; explicit freshness grades pending |
| Denial of wallet | No live provider; cost limit defaults to zero | Usage/cost metrics when enabled | Run descriptor and telemetry |
| Protocol confusion | MCP version/capability metadata and explicit extensions | Dated conformance fixtures | MCP matrix and tests |
| Host configuration drift | One canonical catalog, generated provenance, manifest ownership, duplicate scan checks | `render --check` and `doctor` | Structural renderer evidence only; current host effects are declarative |
| Hook trust | Executable host hooks disabled by default and never treated as the policy root | Enforcement-tier diagnostics | Host profiles and `doctor` report |
| Node dependency compromise | Zero production dependencies, exact development pins, disabled scripts, locked install | npm audit, package allowlist, CodeQL, SBOM | `npm run quality` and SHA-pinned CI |
| Distribution-root confusion | Planned: module-relative package authority is separate from target workspace input | Packed poison-target consumer test | Pending slice 1 evidence |
| Native host-tool bypass | Planned: default generated agents have no native privileged tools; mediated tools use canonical policy IDs | Host security-readiness scan | Pending slice 2 evidence |
| Provider data egress | Planned: bounded context plus durable metadata-only receipt before each send | Fake provider proves zero calls on receipt failure | Pending slice 3 and 8 evidence |
