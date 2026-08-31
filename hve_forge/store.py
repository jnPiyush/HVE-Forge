from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from .domain import Event, Status, may_transition


class Store:
    """SQLite append-only event store with optimistic status transitions."""

    def __init__(self, path: Path) -> None:
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript(
            """CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0,
                next_sequence INTEGER NOT NULL DEFAULT 0);
               CREATE TABLE IF NOT EXISTS events (
                task_id TEXT NOT NULL, sequence INTEGER NOT NULL, id TEXT NOT NULL UNIQUE,
                kind TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL,
                PRIMARY KEY(task_id, sequence));"""
        )

    def create(self, task_id: str) -> None:
        with self.db:
            self.db.execute("INSERT INTO tasks(id, status) VALUES (?, ?)", (task_id, Status.QUEUED))
            self._append(task_id, self._next_sequence(task_id), "task.created", {"status": Status.QUEUED})

    def transition(self, task_id: str, target: Status, details: dict | None = None) -> None:
        with self.db:
            row = self.db.execute("SELECT status, version, next_sequence FROM tasks WHERE id=?", (task_id,)).fetchone()
            if not row:
                raise KeyError(task_id)
            old, version, sequence = Status(row[0]), row[1], row[2]
            if not may_transition(old, target):
                raise ValueError(f"invalid transition: {old} -> {target}")
            changed = self.db.execute(
                "UPDATE tasks SET status=?, version=version+1, next_sequence=next_sequence+1 WHERE id=? AND version=?",
                (target, task_id, version),
            ).rowcount
            if changed != 1:
                raise RuntimeError("concurrent task update")
            self._append(task_id, sequence + 1, "task.transitioned", {**(details or {}), "from": old, "to": target})

    def events(self, task_id: str) -> list[Event]:
        rows = self.db.execute(
            "SELECT sequence, kind, payload, created_at, id FROM events WHERE task_id=? ORDER BY sequence", (task_id,)
        )
        return [Event(task_id=task_id, sequence=r[0], kind=r[1], payload=json.loads(r[2]), created_at=r[3], id=r[4]) for r in rows]

    def _next_sequence(self, task_id: str) -> int:
        self.db.execute("UPDATE tasks SET next_sequence=next_sequence+1 WHERE id=?", (task_id,))
        return self.db.execute("SELECT next_sequence FROM tasks WHERE id=?", (task_id,)).fetchone()[0]

    def _append(self, task_id: str, sequence: int, kind: str, payload: dict) -> None:
        event = Event(task_id, sequence, kind, payload, datetime.now(UTC).isoformat())
        self.db.execute(
            "INSERT INTO events VALUES (?, ?, ?, ?, ?, ?)",
            (task_id, sequence, event.id, kind, json.dumps(payload, sort_keys=True), event.created_at),
        )
