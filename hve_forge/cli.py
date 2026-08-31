from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

from .domain import WorkContract
from .runtime import execute_fixture
from .store import Store


def main() -> None:
    parser = argparse.ArgumentParser(description="HVE-Forge local harness")
    parser.add_argument("command", choices=["demo"])
    args = parser.parse_args()
    if args.command == "demo":
        with tempfile.TemporaryDirectory(prefix="hve-forge-") as directory:
            workspace = Path(directory) / "workspace"
            workspace.mkdir()
            (workspace / "AGENTS.md").write_text("Only edit greeting.txt.\n")
            store = Store(Path(directory) / "events.sqlite")
            contract = WorkContract("Update fixture greeting", ("greeting.txt",), ("exact greeting",), ("python assertion",))
            task_id = execute_fixture(store, workspace, contract)
            for event in store.events(task_id):
                print(json.dumps(
                    {"taskId": event.task_id, "sequence": event.sequence, "kind": event.kind, "payload": event.payload},
                    sort_keys=True,
                ))


if __name__ == "__main__":
    main()
