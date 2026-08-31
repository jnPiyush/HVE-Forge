from __future__ import annotations

import hashlib
from pathlib import Path
from uuid import uuid4

from .domain import Status, WorkContract
from .policy import run_command, validate_edit, workspace_path
from .store import Store


class FixtureProvider:
    """Deterministic provider fixture; production providers implement this port."""
    model = "fixture-v1"

    def edit(self) -> dict:
        return {"path": "greeting.txt", "content": "Hello, HVE-Forge!\n"}


def execute_fixture(store: Store, workspace: Path, contract: WorkContract) -> str:
    task_id = str(uuid4())
    store.create(task_id)
    for state in (Status.PREPARING, Status.RESEARCHING, Status.PLANNING, Status.EXECUTING):
        store.transition(task_id, state)
    instruction = workspace / "AGENTS.md"
    if not instruction.exists():
        raise FileNotFoundError("fixture workspace must provide AGENTS.md")
    store.transition(task_id, Status.VERIFYING, {"instructionHash": hashlib.sha256(instruction.read_bytes()).hexdigest()})
    edit = FixtureProvider().edit()
    validate_edit(edit)
    workspace_path(workspace, edit["path"]).write_text(edit["content"])
    check = run_command(workspace, ["python", "-c", "assert open('greeting.txt').read() == 'Hello, HVE-Forge!\\n'"])
    if not check["ok"]:
        store.transition(task_id, Status.FAILED, {"verification": check})
        return task_id
    store.transition(task_id, Status.REVIEWING, {"verification": check})
    final_hash = hashlib.sha256((workspace / "greeting.txt").read_bytes()).hexdigest()
    store.transition(task_id, Status.COMPLETED, {"evidence": {"file": "greeting.txt", "sha256": final_hash}})
    return task_id
