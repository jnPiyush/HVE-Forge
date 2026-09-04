# HVE-Forge Evaluation Strategy

## Release principle

Evaluate verified task completion per unit of human attention, time, and cost. Do not optimize for tool calls, lines changed, agent count, or one public benchmark score.

## Deterministic suite

Every commit runs reducer, canonicalization, hash-chain, policy, path, idempotency, replay, schema, approval, memory, context, MCP, redaction, provider-fixture, architecture, recovery, and CLI tests. Coverage gates apply per core module to both lines and branches.

## Agent quality suite

Version internal task fixtures across narrow fixes, cross-file changes, refactors, navigation, failing tests, recovery, UI workflows, and security attacks. Keep private or freshly authored holdouts and temporal splits. Generators must not see hidden tests. Human reviewers validate task/test alignment.

Measure:

- verified pass@k and patch applicability;
- hidden and E2E regression-free success;
- policy adherence and attack success;
- edit precision, churn, and acceptance-asset tampering;
- forced-resume recovery and duplicate effects;
- false completion and human correction;
- latency, tokens, cost, and cache efficiency;
- evaluator-human agreement, bias, and finding precision/recall.

## External evidence portfolio

Use SWE-bench Pro, temporal SWE-rebench, Terminal-Bench 4.0, ProgramBench, and CodeClash as complementary evidence with pinned task/scaffold/environment/model/budget versions, repeated runs, confidence intervals, and failure samples. Do not use SWE-bench Verified as the primary frontier or release signal because current audits found contamination and task/test flaws.

## Configuration comparison

Baseline before changes. Compare identical task versions, images, budgets, available model snapshots, prompts, policies, and tools. Prefer deterministic objective checks. Calibrate model judges against humans and use pairwise subjective comparison only where objective checks cannot decide. A blocking regression fails rollout.

## Version 0.1 baseline

The fixture suite has zero live-model spend and zero network/tool side effects. It validates harness mechanics, not coding-model quality. Live quality, latency, token, and cost baselines remain blocked until an operator supplies approved providers, models, data policy, and budgets.
