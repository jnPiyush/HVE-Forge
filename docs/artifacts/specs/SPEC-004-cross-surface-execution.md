<!-- Purpose: Define the implementation contracts required by ADR-004. -->

# SPEC-004: Cross-Surface Execution and Provider Contracts

**Status:** Draft for phased implementation
**ADR:** `docs/artifacts/adr/ADR-004-cross-surface-execution.md`
**Council:** `docs/artifacts/adr/COUNCIL-004-cross-surface-execution.md`

This specification defines contracts only. It contains no code examples, per the architecture authoring rule.

## 1. Scope

Covers installed-distribution identity, trust envelopes, the tool registry and dispatcher, the generalized model provider port, the bounded agent loop, working-tree fingerprinting and evidence freshness, the VS Code extension surface with GitHub Copilot as default, and the Cowork package render target.

Out of scope: isolation backend internals, MCP tool plane, and direct-API provider adapters. Each requires its own specification and approval.

## 2. Tool Registry

### 2.1 Capability Classes

Every tool declares exactly one capability class. The class, not the tool identity, selects the policy action class that the deny-by-default policy then evaluates. Capability class and policy action class are distinct vocabularies and must not be conflated.

| Capability class | Effect | Policy action class | Additional precondition |
|---|---|---|---|
| `read` | Reads workspace content without mutation | `read` | none |
| `search` | Enumerates or matches workspace content | `read` | none |
| `write` | Mutates workspace content under path confinement | `workspace_write` | none |
| `network` | Sends data off-machine | `external_write` | egress receipts enabled |
| `execute` | Spawns a process or drives a browser | `privileged` | isolation backend registered |

Admission is decided solely by policy plus the listed precondition. No class is admitted implicitly: under a deny-by-default policy with no matching allow rule, even a `read` tool is refused.

### 2.2 Registration Contract

- A tool declares a stable identifier, a semantic version, a capability class, and output bounds.
- Identifiers are dot-separated lower snake case and remain stable across versions; renaming is a breaking change.
- Each descriptor is snapshotted before validation so a value cannot change between the validation read and the admission read.
- Registration fails closed. A malformed, duplicated, precondition-missing, or policy-denied descriptor aborts the entire build rather than being skipped.
- Unknown descriptor fields are dropped, not preserved.
- Ordering is code-unit based so the admitted set is identical on every host.
- The registry is constructed only in a composition root and is deeply immutable after construction.

Each adapter parses its input from `unknown`, rejects unknown fields, and returns a closed typed result. The dispatcher independently enforces registration, policy, cancellation, and descriptor output bounds immediately around the effect. Malformed adapter output fails closed. Input and output validation therefore belongs to both the adapter boundary and the dispatcher authority boundary.

### 2.3 Initial Tool Set

Read and search classes are added in this step. The existing write-class tool is carried forward unchanged.

| Identifier | Capability class | Contract summary |
|---|---|---|
| `workspace.read_file` | `read` | Returns confined file text with a content hash and a truncation flag |
| `workspace.list_directory` | `read` | Returns confined directory entries with kind and size |
| `workspace.search_text` | `search` | Returns bounded matches with path and line number |
| `workspace.replace_exact_text` | `write` | Existing behavior, unchanged |

All path inputs pass through the existing host path-safety confinement before use. Link, junction, device, and traversal inputs are rejected.

### 2.4 Bounds

Every tool declares maximum output size and maximum result count. Results exceeding a bound are truncated deterministically and the truncation is reported in the output contract, never silently dropped.

## 3. Model Provider Port

### 3.1 Generalization

The provider port changes from returning a single fixed decision to completing one bounded atomic turn at a time. The application, never the provider or host, owns the multi-turn loop and tool dispatch.

- Input: ordered trusted and untrusted context parts, available tool descriptors, remaining budgets, and a cancellation signal.
- Output: bounded assistant text, zero or more ordered tool calls, normalized usage, model identity, hashes, and one typed finish reason.
- The port is transport-agnostic and contains no vendor identifiers.
- Provider output is data only. A provider cannot invoke a tool handler.
- Initial dispatch is sequential. Parallel tool calls remain deferred until ordering and partial-failure semantics have a separate decision.

### 3.2 Determinism

- `RecordedProvider` remains the offline double and must satisfy the generalized port without modification to fixture semantics.
- Replay equivalence must hold: an identical fixture and identical inputs produce an identical event history.
- No provider implementation may be invoked in unit tests over a network.

### 3.3 Message Constraints

The port must not assume system-role support, because the VS Code Language Model API accepts only user and assistant roles. Instruction content is carried as leading user content. Adapters that support system roles may map it, but the port contract does not require it.

### 3.4 Context Budget

The port exposes a maximum input token budget supplied by the adapter. Context assembly is budget-aware and reports elision rather than truncating silently.

### 3.5 Cost Accounting

Copilot uses a `host_managed` cost mode because VS Code owns quota and does not expose trustworthy monetary cost. The harness records input and output tokens and enforces provider-request and turn budgets without inventing currency values. A future directly billed provider must expose metered cost before a monetary budget can be enforced.

### 3.6 Pre-Send Receipt

Before every live provider request, the application appends and flushes a hash-chained egress receipt containing bounded metadata and hashes only. Receipt persistence failure causes zero provider calls. No prompt, workspace content, credential, or personal data appears in the public receipt.

## 4. Bounded Agent Loop

### 4.1 Termination

The loop terminates on the first satisfied condition:

1. The provider signals completion.
2. The decision budget is exhausted.
3. The wall-clock budget is exhausted.
4. Oscillation is detected.
5. Three consecutive verification failures occur.
6. Cancellation is requested.

No path permits unbounded iteration. Termination reason is recorded as a typed value in the event history.

### 4.2 Oscillation Detection

State is fingerprinted after each decision. A repeated fingerprint within the configured window terminates the loop with an oscillation reason. The window and budget are configuration, not constants.

### 4.3 Failed-Fix Rule

After three consecutive failed verification attempts, the loop stops and emits an investigation-required outcome rather than attempting a fourth fix. This mirrors the gstack stop rule and prevents budget exhaustion through repetition.

### 4.4 Evidence

Each decision appends to the hash-chained history. Existing event payload validation applies to every new event type; adding an event type without a payload contract is a build failure.

### 4.5 Protocol Compatibility

Existing schema-v1 runs remain replayable with their original event meanings and never invoke a provider during replay. Multi-turn sessions use a schema-v2 descriptor, event, projection, checkpoint, evidence, handoff, tool-call, and work-contract family. The implementation must not widen or reinterpret a v1 payload to represent v2 behavior.

## 5. Working-Tree Fingerprint and Evidence Freshness

### 5.1 Fingerprint

A content fingerprint is computed over all relevant regular workspace files, including tracked and untracked source files. Fixed code-owned exclusions cover repository metadata, harness-private state, dependencies, build output, coverage output, and other generated artifacts. Workspace instructions cannot add exclusions. The initial implementation fully rehashes a bounded inventory; incremental caching is deferred until cache correctness can be proven.

### 5.2 Freshness Grades

| Grade | Meaning |
|---|---|
| `FRESH` | Evidence fingerprint equals the current fingerprint |
| `STALE` | Evidence exists but the fingerprint differs |
| `MISSING` | No evidence recorded for the declared check |

Completion gates accept `FRESH` only. `STALE` and `MISSING` block completion with distinct, actionable messages.

## 6. VS Code Extension Surface

### 6.1 Provider Default

The extension supplies a provider backed by the VS Code Language Model API restricted to the Copilot vendor.

- Model selection occurs only within a user-initiated command, because consent is presented as an authentication dialog.
- An empty model result is handled as a first-class state with actionable guidance, never as an error.
- Language model errors are distinguished from transport errors and surfaced with their cause.
- The extension declares no hard dependency on the Copilot extension.
- No API key is read, stored, or transmitted on the default path.

### 6.2 Composition

The extension is a composition root over the same application ports as the CLI. It must not contain policy, path-safety, or loop logic. A policy question must resolve identically in the extension and the CLI.

### 6.3 Testability

The Language Model API is accessed through a narrow interface with a test double. Kernel and application tests run without an extension host. No test performs a live model call.

### 6.4 Tool Contribution

Canonical tool IDs remain dot-separated and are the only identities evaluated by policy. Host contribution names use a VS Code-compatible verb-noun alias mapped back to one canonical ID. Only a metadata-only status tool is globally contributed. Workspace-content and mutation tools remain private to the HVE-owned loop so the host cannot bypass HVE budgets, receipts, policy, or confirmation. Exact replacement requires an explicit native user confirmation immediately before dispatch.

### 6.5 Native Capability Mapping

The extension consumes only the VS Code extension API surface. Every capability below is satisfied by a built-in API, and no npm package may be added to obtain it. A capability that cannot be met natively is deferred rather than solved with a dependency.

| Capability | VS Code API | Dependency avoided |
|---|---|---|
| Model inference and streaming | Language Model API: model selection and request send | Vendor model SDKs |
| Token accounting and context budget | Model maximum-input-token property and the model token-counting method | Tokenizer libraries |
| Authentication, consent, quota | Host-owned consent dialog and authentication provider API | OAuth and token clients |
| Tool exposure to agent mode | `languageModelTools` contribution plus tool registration | Tool-calling frameworks |
| Conversational surface | `chatParticipants` contribution and chat participant API | Custom webview chat shells |
| MCP server discovery | `mcpServerDefinitionProviders` contribution and provider registration | MCP client SDK |
| File read and write | Workspace file system API | File system convenience wrappers |
| File discovery by pattern | Workspace file search with relative patterns | Glob libraries |
| Change observation | File system watcher API | File watching libraries |
| Applying pre-computed edits as one undo unit | Workspace edit and apply-edit API | Editor integration shims |
| Secrets | Extension secret storage | Keychain and dotenv libraries |
| Settings | `configuration` contribution and configuration API | Config loader libraries |
| Persistent state | Workspace state, global state, and storage URI | Embedded key-value stores |
| Structured logging | Log output channel | Logging frameworks |
| Progress and cancellation | Progress API and cancellation tokens | Queue and abort polyfills |
| User prompts | Quick pick and input box | Interactive prompt libraries |
| Findings surfaced in the editor | Diagnostic collection API | Custom reporters |
| Working-tree and branch state | Built-in Git extension API obtained through the extension registry | Git client libraries |
| Process execution, once isolation exists | Task API with process execution, or a terminal with shell integration | Process spawn wrappers |

The consumed contribution points set a minimum host version derived only from commands, chat participants, language model access, and tool APIs used by the first extension release. Deferred MCP registration and terminal integration do not raise the initial engine floor. The manifest declares the resulting minimum explicitly.

The following limits are recorded rather than worked around. Acceptance criterion A13 accepts each of them as a recorded limit, whether the capability is unmapped or mapped with an availability caveat:

- Workspace-wide text search has no stable extension API. Search is implemented over pattern-based file discovery plus bounded reads through the file system API, using the kernel's own matching. No search library is added.
- There is no extension-facing diff computation API. The workspace edit API applies ranges but does not derive them. The existing exact-range replacement tool supplies its own ranges, and general text diffing is out of scope for this specification.
- Contributed tool input is not guaranteed by the host to match the declared input schema at invocation time. Input is validated by the kernel's own validation rather than by a schema library. The cost is hand-written validators per tool, which is accepted in exchange for the dependency count.
- Telemetry is deferred. The host telemetry logger provides redaction and opt-out handling but no transport, and the conventional sender is a package. Until a decision is recorded, no telemetry leaves the machine and operational signal is carried by the log output channel.
- The built-in Git extension API is not part of the typed extension module and is obtained through the extension registry. It is treated as an optional capability: when the Git extension is unavailable, working-tree fingerprinting falls back to file-system enumeration rather than failing.

### 6.6 Dependency Policy

- The extension has zero runtime dependencies. The extension module is provided by the host and is never bundled.
- No bundler is introduced. The extension compiles with the TypeScript compiler already present in the toolchain, and ships as emitted modules.
- Type definitions for the extension API are compile-time only and never appear in the shipped artifact. The narrow seam required by section 6.3 is declared locally where that declaration can be kept accurate. Because the consumed surface spans chat participants, language model tools, and MCP provider registration, the official type-definitions package is the expected path once a local declaration can no longer track the API reliably; it is types-only, development-only, and does not affect the runtime dependency count or the supply-chain gate.
- Packaging into an installable artifact requires a development-only packaging tool. Until that is recorded as a decision, the extension is loaded from the compiled output during development rather than published, and acceptance criterion A12 is verified by inspecting the extension manifest and the supply-chain gate.
- Extension-host code stays thin enough that its behavior is covered by kernel and application tests. Any extension logic that cannot be covered that way is a design defect rather than a reason to add a test runner. The extension entry point is excluded from the per-layer coverage gate only while it contains no branching logic; introducing branching there requires either moving that logic into a covered layer or revisiting this exclusion.

### 6.7 Resolution of Kernel Access

The extension imports the kernel from the same compiled output as the CLI rather than resolving an installed package. One build produces one kernel, so the extension and the CLI cannot diverge in policy, path safety, or loop behavior.

### 6.8 Distribution Identity

The npm CLI resolves canonical assets relative to its installed module location. The VS Code extension cross-checks that distribution root against the host-provided extension location. The target workspace supplies untrusted task content only and can never select or replace the catalog, policy, schemas, prompts, profiles, skills, or evaluator rubric. A development override, if retained temporarily, is explicit, deprecated, and cannot silently become the distribution authority in packaged mode.

## 7. Cowork Package Target

### 7.1 Nature

Cowork is a package render target, not a discovery root. It has no scan paths, no agents directory, and no rules directory.

### 7.2 Package Contract

The rendered package places a manifest at the archive root, alongside required color and outline icons, with skills under a skills directory. Each skill folder contains a skill document whose declared name matches the folder leaf exactly, in lowercase kebab-case. Only registered skill folders are shipped. Connector tool descriptions ship inside the package when a connector is declared.

### 7.3 Authoring Constraints

Rendered Cowork skills assume a managed container: no terminal, no package installation, and no outbound calls except through a declared connector. Skills that reference host execution are excluded from the Cowork target rather than rendered in a degraded form.

### 7.4 Enforcement Tier

Cowork is `declarative`. The surface matrix must record this asymmetry rather than implying kernel-mediated enforcement.

## 8. Security Requirements

- Deny-by-default admission by capability class, verified by test.
- Path confinement on every filesystem input, including link and junction rejection.
- Untrusted external text is enveloped and labeled as data before entering a prompt.
- Hash-chained receipts precede any off-machine send.
- No secret is written to prompts, logs, events, evidence, or fixtures.
- Execute-class registration requires an isolation backend and recorded human approval.
- Package-owned distribution assets and target-workspace content are separate trust boundaries.
- Default generated agents expose no native write, process, browser, or network capability while classified as declarative.
- No repository content reaches a live provider without origin, trust, hash, byte-length, and truncation metadata.
- Every live provider send has a preceding durable egress receipt.

## 9. Acceptance Criteria

| ID | Criterion | Verification |
|---|---|---|
| A1 | Read and search tools register; network and execute tools are refused | Unit tests on the registry |
| A2 | Path confinement rejects traversal, links, and junctions for every tool | Existing path-safety regressions extended per tool |
| A3 | Generalized provider port preserves replay equivalence | Fixture replay comparison |
| A4 | Loop terminates under every declared condition | Property tests over budget and oscillation inputs |
| A5 | Three failed verifications yield an investigation outcome | Unit test on the loop |
| A6 | Evidence grades `FRESH`, `STALE`, and `MISSING` correctly | Unit tests over mutated fingerprints |
| A7 | Copilot provider handles empty model list and language model errors | Unit tests against a fake chat model |
| A8 | Extension and CLI resolve identical policy decisions | Shared decision table exercised from both roots |
| A9 | Cowork package satisfies the manifest and folder contract | Package validation test |
| A10 | Kernel runtime dependency count remains zero | Existing supply-chain gate |
| A11 | Per-layer coverage remains at or above 80 percent | Existing layer coverage gate |
| A12 | The extension adds no runtime dependency and no bundler | Supply-chain gate plus manifest inspection |
| A13 | Every extension capability resolves to a built-in API listed in section 6.5, or to a recorded limit | Extension manifest contribution points diffed against the mapping table by the hosts check; an unmapped capability blocks the change |
| A14 | Absence of the built-in Git extension degrades fingerprinting instead of failing | Unit test with the Git capability unavailable |
| A15 | A packed CLI initializes an unrelated or hostile target using only package-owned assets | Installed-tarball poison-target test |
| A16 | Default generated agents have no native privileged tool bypass and doctor reports declarative readiness honestly | Host security-readiness tests |
| A17 | Every model-bound workspace byte carries a non-forgeable origin/trust envelope and bounded context metadata | Context assembly and injection tests |
| A18 | Every live provider call is preceded by a flushed metadata-only receipt | Provider fake proving zero calls on receipt failure |
| A19 | Existing v1 runs replay unchanged while multi-turn sessions use v2 contracts | Frozen v1 replay plus v2 conformance tests |
| A20 | Working-tree fingerprints include relevant untracked files and completion accepts only `FRESH` evidence | Freshness and mutation tests |

## 10. Open Questions

1. Which isolation backend is acceptable before any execute-class tool can be considered.
2. Whether Cowork connector declarations belong in the canonical catalog or in a separate package descriptor.
