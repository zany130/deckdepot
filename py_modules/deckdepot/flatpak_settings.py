"""Flatpak install-scope preference. Does not create remotes or change installed apps."""

from __future__ import annotations

import json
import os
from typing import Any

import decky

from deckdepot.errors import EngineError

SETTINGS_FILENAME = "flatpak.json"
SETTINGS_VERSION = 1
INSTALL_SCOPES = ("automatic", "user", "system")


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
    return {"version": SETTINGS_VERSION, "installScope": "automatic"}


def validate_install_scope(raw: Any) -> str:
    if raw is None or raw == "":
        return "automatic"
    if not isinstance(raw, str):
        raise EngineError("INVALID_ARGUMENT", "install scope must be a string")
    scope = raw.strip().lower()
    if scope not in INSTALL_SCOPES:
        raise EngineError(
            "INVALID_ARGUMENT",
            "install scope must be automatic, user, or system.",
        )
    return scope


def load_settings() -> dict[str, Any]:
    path = settings_path()
    if not os.path.isfile(path):
        return default_settings()
    try:
        with open(path, encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        raise EngineError("STORAGE_ERROR", "Could not read Flatpak settings.") from exc
    if not isinstance(payload, dict):
        return default_settings()
    return {
        "version": SETTINGS_VERSION,
        "installScope": validate_install_scope(payload.get("installScope")),
    }


def save_install_scope(scope: str) -> dict[str, Any]:
    scope = validate_install_scope(scope)
    path = settings_path()
    payload = {"version": SETTINGS_VERSION, "installScope": scope}
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
        raise EngineError("STORAGE_ERROR", "Could not write Flatpak settings.") from exc
    return payload
