from __future__ import annotations

import os
from pathlib import Path


class PolicyError(PermissionError):
    pass


def workspace_path(workspace: Path, requested: str) -> Path:
    root = workspace.resolve()
    relative = Path(requested)
    if relative.is_absolute() or ".." in relative.parts:
        raise PolicyError("path escapes the isolated workspace")
    current = root
    for part in relative.parts:
        current /= part
        if current.is_symlink():
            raise PolicyError("path traverses a symbolic link")
    candidate = (root / requested).resolve()
    if not candidate.is_relative_to(root):
        raise PolicyError("path escapes the isolated workspace")
    return candidate


def validate_edit(arguments: dict) -> None:
    if set(arguments) != {"path", "content"} or not all(isinstance(arguments[x], str) for x in arguments):
        raise ValueError("edit requires exactly string path and content")


def run_command(workspace: Path, argv: list[str], timeout_seconds: int = 30) -> dict:
    import subprocess

    if not argv or not all(isinstance(item, str) for item in argv):
        raise ValueError("command must be a non-empty argv string array")
    # No shell, inherited credentials, or ambient working directory.
    result = subprocess.run(
        argv, cwd=workspace, shell=False, timeout=timeout_seconds, text=True,
        capture_output=True, env={"PATH": os.environ.get("PATH", ""), "HOME": str(workspace / ".home")},
    )
    return {"ok": result.returncode == 0, "exitCode": result.returncode, "stdout": result.stdout[-8192:], "stderr": result.stderr[-8192:]}
