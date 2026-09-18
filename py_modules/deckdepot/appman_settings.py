"""AppMan provider settings. Search scope is an enum, not a CLI string."""

from __future__ import annotations

import json
import os
from typing import Any

import decky

from deckdepot.appman_ids import validate_search_scope
from deckdepot.errors import EngineError

SETTINGS_FILENAME = "appman.json"
SETTINGS_VERSION = 1


def _settings_dir() -> str:
    settings_dir = getattr(decky, "DECKY_PLUGIN_SETTINGS_DIR", None)
    if not settings_dir:
        raise EngineError(
            "CAPABILITY_UNAVAILABLE",
            "Plugin settings directory is unavailable.",
        )
    os.makedirs(settings_dir, exist_ok=True)
    return settings_dir


def settings_path() -> str:
    return os.path.join(_settings_dir(), SETTINGS_FILENAME)


def default_settings() -> dict[str, Any]:
    return {"version": SETTINGS_VERSION, "searchScope": "default"}


def load_settings() -> dict[str, Any]:
    path = settings_path()
    if not os.path.isfile(path):
        return default_settings()
    try:
        with open(path, encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        raise EngineError(
            "STORAGE_ERROR",
            "Could not read AppMan settings.",
        ) from exc
    if not isinstance(payload, dict):
        return default_settings()
    scope = validate_search_scope(payload.get("searchScope"))
    return {"version": SETTINGS_VERSION, "searchScope": scope}


def save_search_scope(scope: str) -> dict[str, Any]:
    scope = validate_search_scope(scope)
    path = settings_path()
    payload = {"version": SETTINGS_VERSION, "searchScope": scope}
    tmp = f"{path}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
            handle.write("\n")
        os.replace(tmp, path)
    except OSError as exc:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise EngineError("STORAGE_ERROR", "Could not write AppMan settings.") from exc
    return payload
