"""Plugin-owned Steam shortcut registry.

There is no library-wide shortcut enumeration. Duplicate protection is
`provider + installationScope + appId -> returned Steam appId`.
Stale entries are kept until the frontend replaces or resets them.
"""

from __future__ import annotations

import json
import os
import tempfile
import time
from typing import Any

import decky

from deckdepot.errors import EngineError
from deckdepot.appman_ids import validate_appman_name
from deckdepot.ids import validate_flatpak_app_id

REGISTRY_FILENAME = "shortcut-registry.json"
REGISTRY_VERSION = 1
PROVIDERS = {"flatpak", "appman"}
SCOPES = {"user", "system"}
MAX_STEAM_APP_ID = 0xFFFFFFFF


def _now_ms() -> int:
    return int(time.time() * 1000)


def _settings_dir() -> str:
    settings_dir = getattr(decky, "DECKY_PLUGIN_SETTINGS_DIR", None)
    if not settings_dir:
        raise EngineError(
            "CAPABILITY_UNAVAILABLE",
            "Plugin settings directory is unavailable.",
        )
    os.makedirs(settings_dir, exist_ok=True)
    return settings_dir


def registry_path() -> str:
    return os.path.join(_settings_dir(), REGISTRY_FILENAME)


def mapping_key(provider: str, installation_scope: str, app_id: str) -> str:
    return f"{provider}:{installation_scope}:{app_id}"


def _empty_registry() -> dict[str, Any]:
    return {"version": REGISTRY_VERSION, "mappings": {}}


def _load_registry() -> dict[str, Any]:
    path = registry_path()
    if not os.path.exists(path):
        return _empty_registry()
    try:
        with open(path, encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        raise EngineError(
            "STORAGE_ERROR",
            "Could not read the Steam shortcut registry.",
            details={"errorType": type(exc).__name__, "errno": getattr(exc, "errno", None)},
        ) from exc
    if not isinstance(payload, dict):
        return _empty_registry()
    mappings = payload.get("mappings")
    if not isinstance(mappings, dict):
        mappings = {}
    return {"version": REGISTRY_VERSION, "mappings": mappings}


def _write_registry(payload: dict[str, Any]) -> None:
    path = registry_path()
    encoded = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    fd, tmp_path = tempfile.mkstemp(
        prefix="shortcut-registry.",
        suffix=".tmp",
        dir=os.path.dirname(path),
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(encoded)
        os.replace(tmp_path, path)
    except OSError as exc:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise EngineError(
            "STORAGE_ERROR",
            "Could not write the Steam shortcut registry.",
            details={"errorType": type(exc).__name__, "errno": getattr(exc, "errno", None)},
        ) from exc
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _validate_scope(raw: str) -> str:
    if raw not in SCOPES:
        raise EngineError("INVALID_ARGUMENT", "installation scope must be user or system")
    return raw


def _validate_provider(raw: str) -> str:
    if raw not in PROVIDERS:
        raise EngineError("INVALID_ARGUMENT", "unsupported provider")
    return raw


def _validate_app_id(provider: str, raw: str) -> str:
    if provider == "appman":
        return validate_appman_name(raw)
    return validate_flatpak_app_id(raw)


def _validate_steam_app_id(raw: Any) -> int:
    if isinstance(raw, bool):
        raise EngineError("INVALID_ARGUMENT", "steam app id must be a positive integer")
    if isinstance(raw, float) and raw.is_integer():
        raw = int(raw)
    if isinstance(raw, str) and raw.isdigit():
        raw = int(raw)
    if not isinstance(raw, int):
        raise EngineError("INVALID_ARGUMENT", "steam app id must be a positive integer")
    if raw <= 0 or raw > MAX_STEAM_APP_ID:
        raise EngineError("INVALID_ARGUMENT", "steam app id is out of range")
    return raw


def list_mappings() -> dict[str, Any]:
    registry = _load_registry()
    mappings = list(registry["mappings"].values())
    return {
        "ok": True,
        "path": registry_path(),
        "count": len(mappings),
        "mappings": mappings,
    }


def get_mapping(provider: str, installation_scope: str, app_id: str) -> dict[str, Any]:
    provider = _validate_provider(provider)
    installation_scope = _validate_scope(installation_scope)
    app_id = _validate_app_id(provider, app_id)
    key = mapping_key(provider, installation_scope, app_id)
    mapping = _load_registry()["mappings"].get(key)
    return {
        "ok": True,
        "found": mapping is not None,
        "mapping": mapping,
        "key": key,
    }


def upsert_mapping(payload: dict[str, Any]) -> dict[str, Any]:
    provider = _validate_provider(str(payload.get("provider") or ""))
    installation_scope = _validate_scope(str(payload.get("installationScope") or ""))
    app_id = _validate_app_id(provider, str(payload.get("appId") or ""))
    steam_app_id = _validate_steam_app_id(payload.get("steamAppId"))
    name = str(payload.get("name") or app_id).strip()[:128]
    exe = str(payload.get("exe") or "").strip()
    start_dir = str(payload.get("startDir") or "").strip()
    launch_options = str(payload.get("launchOptions") or "").strip()
    game_id = payload.get("gameId")
    if game_id is not None:
        game_id = str(game_id)
    key = mapping_key(provider, installation_scope, app_id)
    registry = _load_registry()
    previous = registry["mappings"].get(key)
    created_at = (
        previous.get("createdAtMs") if isinstance(previous, dict) else None
    ) or _now_ms()
    mapping = {
        "provider": provider,
        "appId": app_id,
        "installationScope": installation_scope,
        "steamAppId": steam_app_id,
        "gameId": game_id,
        "name": name,
        "exe": exe,
        "startDir": start_dir,
        "launchOptions": launch_options,
        "createdAtMs": created_at,
        "updatedAtMs": _now_ms(),
    }
    artwork_applied = payload.get("artworkAppliedAtMs")
    if artwork_applied is None and isinstance(previous, dict):
        artwork_applied = previous.get("artworkAppliedAtMs")
    if artwork_applied is not None:
        try:
            mapping["artworkAppliedAtMs"] = int(artwork_applied)
        except (TypeError, ValueError):
            pass
    artwork_generation = payload.get("artworkGeneration")
    if artwork_generation is None and isinstance(previous, dict):
        artwork_generation = previous.get("artworkGeneration")
    if artwork_generation is not None:
        try:
            mapping["artworkGeneration"] = int(artwork_generation)
        except (TypeError, ValueError):
            pass
    registry["mappings"][key] = mapping
    _write_registry(registry)
    return {"ok": True, "mapping": mapping, "replaced": previous is not None}


def delete_mapping(provider: str, installation_scope: str, app_id: str) -> dict[str, Any]:
    provider = _validate_provider(provider)
    installation_scope = _validate_scope(installation_scope)
    app_id = _validate_app_id(provider, app_id)
    key = mapping_key(provider, installation_scope, app_id)
    registry = _load_registry()
    previous = registry["mappings"].pop(key, None)
    if previous is not None:
        _write_registry(registry)
    return {
        "ok": True,
        "removed": previous is not None,
        "mapping": previous,
        "key": key,
    }


def reset_registry() -> dict[str, Any]:
    previous = _load_registry()
    _write_registry(_empty_registry())
    return {
        "ok": True,
        "clearedCount": len(previous.get("mappings") or {}),
        "steamShortcutsRemoved": False,
        "note": "Registry reset does not call RemoveShortcut. Mapped Steam IDs are forgotten only.",
    }
