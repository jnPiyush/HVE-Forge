from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any
from uuid import uuid4


class Status(StrEnum):
    QUEUED = "queued"
    PREPARING = "preparing"
    RESEARCHING = "researching"
    PLANNING = "planning"
    AWAITING_APPROVAL = "awaiting_approval"
    EXECUTING = "executing"
    VERIFYING = "verifying"
    REVIEWING = "reviewing"
    COMPLETED = "completed"
    BLOCKED = "blocked"
    FAILED = "failed"
    CANCELLED = "cancelled"


TERMINAL = {Status.COMPLETED, Status.BLOCKED, Status.FAILED, Status.CANCELLED}
TRANSITIONS = {
    Status.QUEUED: {Status.PREPARING, Status.CANCELLED},
    Status.PREPARING: {Status.RESEARCHING, Status.FAILED, Status.CANCELLED},
    Status.RESEARCHING: {Status.PLANNING, Status.FAILED, Status.CANCELLED},
    Status.PLANNING: {Status.AWAITING_APPROVAL, Status.EXECUTING, Status.BLOCKED, Status.CANCELLED},
    Status.AWAITING_APPROVAL: {Status.EXECUTING, Status.BLOCKED, Status.CANCELLED},
    Status.EXECUTING: {Status.VERIFYING, Status.FAILED, Status.CANCELLED},
    Status.VERIFYING: {Status.REVIEWING, Status.FAILED, Status.CANCELLED},
    Status.REVIEWING: {Status.COMPLETED, Status.BLOCKED, Status.FAILED, Status.CANCELLED},
}


def may_transition(old: Status, new: Status) -> bool:
    return new in TRANSITIONS.get(old, set())


@dataclass(frozen=True)
class WorkContract:
    objective: str
    scope: tuple[str, ...]
    acceptance: tuple[str, ...]
    verification: tuple[str, ...]
    risks: tuple[str, ...] = ()
    schema_version: str = "1.0"


@dataclass(frozen=True)
class Event:
    task_id: str
    sequence: int
    kind: str
    payload: dict[str, Any]
    created_at: str
    id: str = field(default_factory=lambda: str(uuid4()))
