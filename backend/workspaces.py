"""Workspace helpers for Myna rooms/projects.

Agent profiles remain per-agent for memory/skills, while filesystem work happens
inside a room/project workspace shared by all agents in that room.
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any


def _default_workspaces_root() -> Path:
    """Default to the app data directory so Docker upgrades keep workspaces."""
    configured = os.environ.get("MYNA_WORKSPACES_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path(__file__).parent.parent / "data" / "workspaces"


WORKSPACES_ROOT = _default_workspaces_root()


def safe_room_workspace_name(room_id: str) -> str:
    """Return a filesystem-safe workspace directory name for a room id."""
    safe = re.sub(r"[^a-zA-Z0-9_.-]", "_", str(room_id or "default"))
    return f"room-{safe[:80]}"


def get_room_workspace_dir(room_id: str, room_settings: dict[str, Any] | None = None) -> Path:
    """Get or create the workspace directory for a room/project.

    A room can optionally bind an absolute local path through
    room_settings["workspace_path"]. If unset, Myna creates an isolated shared
    workspace under /root/myna-workspaces/room-{room_id}.
    """
    settings = room_settings or {}
    raw_path = str(settings.get("workspace_path") or "").strip()

    if raw_path:
        candidate = Path(raw_path).expanduser()
        if not candidate.is_absolute():
            raise ValueError("workspace_path must be an absolute path")
        workspace = candidate
    else:
        workspace = WORKSPACES_ROOT / safe_room_workspace_name(room_id)

    workspace.mkdir(parents=True, exist_ok=True)
    return workspace.resolve()


def get_room_workspace_info(room_id: str, room_settings: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return serializable workspace metadata for API/UI display."""
    workspace = get_room_workspace_dir(room_id, room_settings)
    configured = str((room_settings or {}).get("workspace_path") or "").strip()
    return {
        "workspace_path": str(workspace),
        "workspace_mode": "custom" if configured else "default",
    }
