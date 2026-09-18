"""Read-only Steam shortcuts.vdf inspection.

This is not a write path and not the production Add-to-Steam mechanism.
It independently confirms whether a created shortcut was flushed to Steam
storage. Matching prefers the returned AddShortcut AppID, then the
diagnostic name/exe/launch-options identity.
"""

from __future__ import annotations

import os
from typing import Any

import decky

from deckdepot.errors import EngineError

TYPE_OBJECT = 0x00
TYPE_STRING = 0x01
TYPE_INT32 = 0x02
TYPE_FLOAT32 = 0x03
TYPE_POINTER = 0x04
TYPE_WIDESTRING = 0x05
TYPE_COLOR = 0x06
TYPE_UINT64 = 0x07
TYPE_END = 0x08
TYPE_INT64 = 0x0A

MAX_VDF_BYTES = 8 * 1024 * 1024
MAX_DEPTH = 8
STEAM_ROOT_RELATIVE = (
    ".local/share/Steam",
    ".steam/steam",
    ".steam/root",
)


class _VdfReader:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.offset = 0

    def _need(self, count: int) -> None:
        if self.offset + count > len(self.data):
            raise ValueError("truncated binary vdf")

    def u8(self) -> int:
        self._need(1)
        value = self.data[self.offset]
        self.offset += 1
        return value

    def cstr(self) -> str:
        start = self.offset
        try:
            end = self.data.index(b"\x00", start)
        except ValueError as exc:
            raise ValueError("unterminated vdf string") from exc
        self.offset = end + 1
        return self.data[start:end].decode("utf-8", "replace")

    def i32(self) -> int:
        self._need(4)
        value = int.from_bytes(self.data[self.offset : self.offset + 4], "little", signed=True)
        self.offset += 4
        return value

    def i64(self) -> int:
        self._need(8)
        value = int.from_bytes(self.data[self.offset : self.offset + 8], "little", signed=True)
        self.offset += 8
        return value

    def u64(self) -> int:
        self._need(8)
        value = int.from_bytes(self.data[self.offset : self.offset + 8], "little", signed=False)
        self.offset += 8
        return value

    def parse_object(self, depth: int = 0) -> dict[str, Any]:
        if depth > MAX_DEPTH:
            raise ValueError("vdf nesting too deep")
        obj: dict[str, Any] = {}
        while True:
            if self.offset >= len(self.data):
                return obj
            kind = self.u8()
            if kind == TYPE_END:
                return obj
            key = self.cstr()
            if kind == TYPE_OBJECT:
                obj[key] = self.parse_object(depth + 1)
            elif kind in {TYPE_STRING, TYPE_WIDESTRING}:
                obj[key] = self.cstr()
            elif kind in {TYPE_INT32, TYPE_POINTER, TYPE_COLOR}:
                obj[key] = self.i32()
            elif kind == TYPE_UINT64:
                obj[key] = self.u64()
            elif kind == TYPE_INT64:
                obj[key] = self.i64()
            elif kind == TYPE_FLOAT32:
                self._need(4)
                self.offset += 4
                obj[key] = None
            else:
                raise ValueError(f"unsupported vdf type {kind}")


def _homes() -> list[str]:
    values = [
        getattr(decky, "DECKY_USER_HOME", None),
        os.environ.get("HOME"),
        os.path.expanduser("~"),
    ]
    out: list[str] = []
    seen: set[str] = set()
    for home in values:
        if not home:
            continue
        real = os.path.realpath(home)
        if real in seen or not os.path.isdir(real):
            continue
        seen.add(real)
        out.append(real)
    return out


def list_shortcuts_vdf_paths() -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    for home in _homes():
        for relative in STEAM_ROOT_RELATIVE:
            userdata = os.path.join(home, relative, "userdata")
            if not os.path.isdir(userdata):
                continue
            try:
                names = os.listdir(userdata)
            except OSError:
                continue
            for name in names:
                if not name.isdigit():
                    continue
                path = os.path.join(userdata, name, "config", "shortcuts.vdf")
                if not os.path.isfile(path):
                    continue
                real = os.path.realpath(path)
                if real in seen:
                    continue
                seen.add(real)
                found.append(real)
    return found


def _lookup(entry: dict[str, Any], *names: str) -> Any:
    lower = {str(key).lower(): value for key, value in entry.items()}
    for name in names:
        if name.lower() in lower:
            return lower[name.lower()]
    return None


def _unsigned_appid(raw: Any) -> int | None:
    if isinstance(raw, bool) or not isinstance(raw, int):
        return None
    return raw % 2**32


def _normalize_exe(raw: Any) -> str:
    text = str(raw or "").strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in {'"', "'"}:
        text = text[1:-1]
    return text


def _public_entry(entry: dict[str, Any], index: str) -> dict[str, Any]:
    appid = _unsigned_appid(_lookup(entry, "appid"))
    return {
        "index": index,
        "appid": appid,
        "appName": str(_lookup(entry, "appname", "AppName") or ""),
        "exe": _normalize_exe(_lookup(entry, "exe", "Exe")),
        "startDir": str(_lookup(entry, "StartDir", "startdir") or ""),
        "launchOptions": str(_lookup(entry, "LaunchOptions", "launchoptions") or ""),
        "flatpakAppId": str(_lookup(entry, "FlatpakAppID", "flatpakappid") or ""),
    }


def _matches(
    public: dict[str, Any],
    *,
    steam_app_id: int | None,
    name: str,
    exe: str,
    launch_options: str,
) -> dict[str, bool]:
    exe_norm = _normalize_exe(exe)
    name_match = bool(name) and public["appName"] == name
    exe_match = bool(exe_norm) and public["exe"] == exe_norm
    launch_match = public["launchOptions"] == launch_options
    appid_match = steam_app_id is not None and public["appid"] == (steam_app_id % 2**32)
    identity = name_match or (exe_match and launch_options and launch_options in public["launchOptions"])
    return {
        "appIdMatched": bool(appid_match),
        "nameMatched": name_match,
        "exeMatched": exe_match,
        "launchOptionsMatched": launch_match,
        "identityMatched": bool(identity or appid_match),
    }


def inspect_shortcuts_vdf(
    *,
    steam_app_id: int | None = None,
    name: str = "",
    exe: str = "",
    launch_options: str = "",
) -> dict[str, Any]:
    paths = list_shortcuts_vdf_paths()
    files: list[dict[str, Any]] = []
    matches: list[dict[str, Any]] = []
    parse_errors: list[dict[str, str]] = []

    for path in paths:
        try:
            size = os.path.getsize(path)
            mtime_ms = int(os.path.getmtime(path) * 1000)
            if size > MAX_VDF_BYTES:
                parse_errors.append({"path": path, "error": "file too large"})
                continue
            with open(path, "rb") as handle:
                data = handle.read()
            root = _VdfReader(data).parse_object()
            shortcuts = root.get("shortcuts")
            count = len(shortcuts) if isinstance(shortcuts, dict) else 0
            files.append(
                {
                    "path": path,
                    "sizeBytes": size,
                    "mtimeMs": mtime_ms,
                    "shortcutCount": count,
                    "readOnly": True,
                }
            )
            if not isinstance(shortcuts, dict):
                continue
            for index, entry in shortcuts.items():
                if not isinstance(entry, dict):
                    continue
                public = _public_entry(entry, str(index))
                flags = _matches(
                    public,
                    steam_app_id=steam_app_id,
                    name=name,
                    exe=exe,
                    launch_options=launch_options,
                )
                if flags["identityMatched"]:
                    matches.append({**public, **flags, "sourcePath": path})
        except (OSError, ValueError) as exc:
            parse_errors.append({"path": path, "error": f"{type(exc).__name__}: {exc}"})

    confirmed = any(
        row.get("nameMatched") or row.get("appIdMatched") for row in matches
    )
    launch_confirmed = any(row.get("launchOptionsMatched") and row.get("identityMatched") for row in matches)
    return {
        "ok": True,
        "readOnly": True,
        "wroteVdf": False,
        "filesInspected": files,
        "matchCount": len(matches),
        "matches": matches[:10],
        "parseErrors": parse_errors[:10],
        "vdfPersistenceConfirmed": confirmed,
        "vdfLaunchOptionsConfirmed": launch_confirmed,
    }


def inspect_shortcuts_vdf_rpc(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = payload or {}
    steam_app_id = payload.get("steamAppId")
    if steam_app_id is not None:
        if isinstance(steam_app_id, bool) or not isinstance(steam_app_id, int):
            if isinstance(steam_app_id, float) and steam_app_id.is_integer():
                steam_app_id = int(steam_app_id)
            elif isinstance(steam_app_id, str) and steam_app_id.isdigit():
                steam_app_id = int(steam_app_id)
            else:
                raise EngineError("INVALID_ARGUMENT", "steamAppId must be an integer")
    return inspect_shortcuts_vdf(
        steam_app_id=steam_app_id,
        name=str(payload.get("name") or ""),
        exe=str(payload.get("exe") or ""),
        launch_options=str(payload.get("launchOptions") or ""),
    )
