"""Runtime paths for Myna across Docker, local dev, and portable builds."""
from __future__ import annotations

import os
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parent.parent


def _default_data_root() -> Path:
    configured = os.environ.get("MYNA_DATA_DIR", "").strip()
    if configured:
        return Path(configured).expanduser()
    return APP_ROOT / "data"


def _default_db_root() -> Path:
    configured = os.environ.get("MYNA_DB_DIR", "").strip()
    if configured:
        return Path(configured).expanduser()
    configured_data = os.environ.get("MYNA_DATA_DIR", "").strip()
    if configured_data:
        return Path(configured_data).expanduser() / "db"
    return APP_ROOT / "db"


def _default_profiles_root() -> Path:
    configured = os.environ.get("MYNA_PROFILES_DIR", "").strip()
    if configured:
        return Path(configured).expanduser()
    configured_data = os.environ.get("MYNA_DATA_DIR", "").strip()
    if configured_data:
        return Path(configured_data).expanduser() / "hermes" / "profiles"
    return Path("/root/.hermes/profiles")


def _default_hermes_path() -> Path:
    configured = os.environ.get("HERMES_PATH", "").strip()
    if configured:
        return Path(configured).expanduser()
    bundled = APP_ROOT / "vendor" / "hermes-agent"
    if bundled.exists():
        return bundled
    return Path("/root/hermes")


DATA_ROOT = _default_data_root()
DB_ROOT = _default_db_root()
UPLOADS_DIR = DATA_ROOT / "uploads"
WORKSPACES_ROOT = Path(os.environ.get("MYNA_WORKSPACES_ROOT", "")).expanduser() if os.environ.get("MYNA_WORKSPACES_ROOT", "").strip() else DATA_ROOT / "workspaces"
PROFILES_ROOT = _default_profiles_root()
HERMES_PATH = _default_hermes_path()


def ensure_runtime_dirs() -> None:
    for path in (DATA_ROOT, DB_ROOT, UPLOADS_DIR, WORKSPACES_ROOT, PROFILES_ROOT):
        path.mkdir(parents=True, exist_ok=True)
