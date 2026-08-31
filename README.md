# HVE-Forge
Hypervelocity Engineering AI Harness

## Runnable local MVP

Requires Python 3.11+. Run the deterministic, no-network fixture:

```sh
python -m pip install -e .
python -m hve_forge.cli demo
python -m unittest discover -s tests
```

The demo streams ordered JSON event records and only writes `greeting.txt`
inside a temporary workspace. See the [architecture](docs/architecture.md),
[decision](docs/adr/0001-focused-local-runtime.md), [threat model](docs/threat-model.md),
and [research record](docs/research/ai-coding-harness-landscape.md).
