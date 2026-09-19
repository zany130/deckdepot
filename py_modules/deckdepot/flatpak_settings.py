"""Flatpak install-scope preference and Discover content filters.

Does not create remotes, edit Flatpak filters, or change installed apps.
"""

from __future__ import annotations

import json
import os
from typing import Any

import decky

from deckdepot.errors import EngineError

SETTINGS_FILENAME = "flatpak.json"
SETTINGS_VERSION = 2
INSTALL_SCOPES = ("automatic", "user", "system")
CONTENT_FILTER_KEYS = (
    "freeSoftwareOnly",
    "flathubResultsOnly",
    "verifiedResultsOnly",
    "hideEndOfLifeApps",
    "respectDistroFilters",
)
CONTENT_FILTER_DEFAULTS = {
    "freeSoftwareOnly": False,
    "flathubResultsOnly": False,
    "verifiedResultsOnly": False,
    "hideEndOfLifeApps": False,
    "respectDistroFilters": True,
}


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
    payload = {"version": SETTINGS_VERSION, "installScope": "automatic"}
    payload.update(CONTENT_FILTER_DEFAULTS)
    return payload


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


def _as_bool(raw: Any, default: bool) -> bool:
    if raw is None:
        return default
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, (int, float)) and raw in {0, 1}:
        return bool(raw)
    if isinstance(raw, str):
        text = raw.strip().lower()
        if text in {"true", "1", "yes", "on"}:
            return True
        if text in {"false", "0", "no", "off"}:
            return False
    return default


def _content_filters_from_payload(payload: dict[str, Any]) -> dict[str, bool]:
    return {
        key: _as_bool(payload.get(key), default)
        for key, default in CONTENT_FILTER_DEFAULTS.items()
    }


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
    normalized = {
        "version": SETTINGS_VERSION,
        "installScope": validate_install_scope(payload.get("installScope")),
    }
    normalized.update(_content_filters_from_payload(payload))
    return normalized


def _write_settings(payload: dict[str, Any]) -> dict[str, Any]:
    path = settings_path()
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


def save_install_scope(scope: str) -> dict[str, Any]:
    current = load_settings()
    current["installScope"] = validate_install_scope(scope)
    current["version"] = SETTINGS_VERSION
    return _write_settings(current)


def content_filters(settings: dict[str, Any] | None = None) -> dict[str, bool]:
    payload = settings if settings is not None else load_settings()
    return {key: bool(payload.get(key, CONTENT_FILTER_DEFAULTS[key])) for key in CONTENT_FILTER_KEYS}


def save_content_filters(updates: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(updates, dict):
        raise EngineError("INVALID_ARGUMENT", "content filters must be an object")
    current = load_settings()
    unknown = [key for key in updates if key not in CONTENT_FILTER_KEYS]
    if unknown:
        raise EngineError(
            "INVALID_ARGUMENT",
            "unsupported content filter key.",
            details={"keys": unknown},
        )
    for key, default in CONTENT_FILTER_DEFAULTS.items():
        if key in updates:
            current[key] = _as_bool(updates[key], default)
    current["version"] = SETTINGS_VERSION
    saved = _write_settings(current)
    return {"ok": True, **content_filters(saved)}
