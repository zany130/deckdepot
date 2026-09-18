"""Plugin-owned files: interrupt snapshots and uninstall cleanup.

Does not touch user Flatpaks or Steam shortcuts.
"""

from __future__ import annotations

import json
import os
from typing import Any

import decky

from deckdepot.errors import EngineError

INTERRUPT_FILENAME = "interrupted-task.json"
OWNED_SETTINGS_FILES = ("steamgriddb.json", "shortcut-registry.json", "appman.json")
OWNED_RUNTIME_FILES = (INTERRUPT_FILENAME,)


def _runtime_dir() -> str | None:
    runtime_dir = getattr(decky, "DECKY_PLUGIN_RUNTIME_DIR", None)
    if not runtime_dir:
        return None
    os.makedirs(runtime_dir, exist_ok=True)
    return runtime_dir


def _settings_dir() -> str | None:
    settings_dir = getattr(decky, "DECKY_PLUGIN_SETTINGS_DIR", None)
    if not settings_dir:
        return None
    return settings_dir


def interrupt_path() -> str | None:
    runtime_dir = _runtime_dir()
    if not runtime_dir:
        return None
    return os.path.join(runtime_dir, INTERRUPT_FILENAME)


def persist_interrupted_task(task: dict[str, Any] | None) -> None:
    path = interrupt_path()
    if not path or not task:
        return
    payload = dict(task)
    payload["phase"] = "cancelled"
    payload["statusText"] = "interrupted by plugin unload"
    payload["errorCode"] = "PROCESS_CANCELLED"
    payload["interruptedByUnload"] = True
    tmp = f"{path}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)
            handle.write("\n")
        os.replace(tmp, path)
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def load_interrupted_task() -> dict[str, Any] | None:
    path = interrupt_path()
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        payload = None
    try:
        os.unlink(path)
    except OSError:
        pass
    return payload if isinstance(payload, dict) else None


def _unlink(path: str) -> bool:
    try:
        os.unlink(path)
        return True
    except FileNotFoundError:
        return False
    except OSError as exc:
        raise EngineError(
            "STORAGE_ERROR",
            "Could not remove a plugin-owned file.",
            details={
                "path": os.path.basename(path),
                "errorType": type(exc).__name__,
                "errno": getattr(exc, "errno", None),
            },
        ) from exc


def remove_plugin_owned_files() -> dict[str, Any]:
    removed: list[str] = []
    settings_dir = _settings_dir()
    if settings_dir:
        for name in OWNED_SETTINGS_FILES:
            if _unlink(os.path.join(settings_dir, name)):
                removed.append(name)
    runtime_dir = _runtime_dir()
    if runtime_dir:
        for name in OWNED_RUNTIME_FILES:
            if _unlink(os.path.join(runtime_dir, name)):
                removed.append(name)
    return {"ok": True, "removed": removed}
