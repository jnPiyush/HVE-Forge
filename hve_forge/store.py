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
                id TEXT PRIMARY KEY, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0);
               CREATE TABLE IF NOT EXISTS events (
                task_id TEXT NOT NULL, sequence INTEGER NOT NULL, id TEXT NOT NULL UNIQUE,
                kind TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL,
                PRIMARY KEY(task_id, sequence));"""
        )

    def create(self, task_id: str) -> None:
        with self.db:
            self.db.execute("INSERT INTO tasks(id, status) VALUES (?, ?)", (task_id, Status.QUEUED))
            self._append(task_id, "task.created", {"status": Status.QUEUED})

    def transition(self, task_id: str, target: Status, details: dict | None = None) -> None:
        row = self.db.execute("SELECT status, version FROM tasks WHERE id=?", (task_id,)).fetchone()
        if not row:
            raise KeyError(task_id)
        old, version = Status(row[0]), row[1]
        if not may_transition(old, target):
            raise ValueError(f"invalid transition: {old} -> {target}")
        with self.db:
            changed = self.db.execute(
                "UPDATE tasks SET status=?, version=version+1 WHERE id=? AND version=?",
                (target, task_id, version),
            ).rowcount
            if changed != 1:
                raise RuntimeError("concurrent task update")
            self._append(task_id, "task.transitioned", {"from": old, "to": target, **(details or {})})

    def events(self, task_id: str) -> list[Event]:
        rows = self.db.execute(
            "SELECT sequence, kind, payload, created_at, id FROM events WHERE task_id=? ORDER BY sequence", (task_id,)
        )
        return [Event(task_id, r[0], r[1], json.loads(r[2]), r[3], r[4]) for r in rows]

    def _append(self, task_id: str, kind: str, payload: dict) -> None:
        sequence = self.db.execute("SELECT COALESCE(MAX(sequence), 0)+1 FROM events WHERE task_id=?", (task_id,)).fetchone()[0]
        event = Event(task_id, sequence, kind, payload, datetime.now(UTC).isoformat())
        self.db.execute(
            "INSERT INTO events VALUES (?, ?, ?, ?, ?, ?)",
            (task_id, sequence, event.id, kind, json.dumps(payload, sort_keys=True), event.created_at),
        )
