import json
import subprocess
import sys
import unittest
from pathlib import Path

from hve_forge.domain import Status, may_transition
from hve_forge.policy import PolicyError, workspace_path
from hve_forge.store import Store


class HarnessTests(unittest.TestCase):
    def test_transitions_are_fail_closed(self):
        self.assertTrue(may_transition(Status.QUEUED, Status.PREPARING))
        self.assertFalse(may_transition(Status.QUEUED, Status.COMPLETED))

    def test_workspace_path_rejects_escape_and_symlink(self):
        with self.assertRaises(PolicyError):
            workspace_path(Path(self.temporary_directory.name), "../outside")
        workspace = Path(self.temporary_directory.name)
        (workspace / "link").symlink_to("/tmp")
        with self.assertRaises(PolicyError):
            workspace_path(workspace, "link/escaped")

    def test_events_are_ordered_and_durable(self):
        store = Store(Path(self.temporary_directory.name) / "events.db")
        store.create("task")
        store.transition("task", Status.PREPARING)
        self.assertEqual([event.sequence for event in store.events("task")], [1, 2])

    def test_demo_emits_completed_evidence(self):
        result = subprocess.run(
            [sys.executable, "-m", "hve_forge.cli", "demo"], text=True, capture_output=True, check=True
        )
        events = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual([event["sequence"] for event in events], list(range(1, len(events) + 1)))
        self.assertEqual(events[-1]["payload"]["to"], "completed")
        self.assertEqual(events[-1]["payload"]["evidence"]["file"], "greeting.txt")

    def setUp(self):
        import tempfile
        self.temporary_directory = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.temporary_directory.cleanup()
