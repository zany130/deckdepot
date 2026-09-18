"""Production AppMan/local-mode engine.

Text parsing only. Exit 0 is not success. PATH prepends ~/.local/bin.
Does not vendor AppMan. Does not use --pkg. Does not launch apps.
"""

from __future__ import annotations

import asyncio
import base64
import os
import re
from typing import Any

import decky

from deckdepot.appman_categories import normalize_categories
from deckdepot.appman_ids import (
    SCOPE_FLAGS,
    SOURCE_FLAGS,
    SOURCE_LABELS,
    source_from_text,
    validate_appman_name,
    validate_search_scope,
    validate_source_id,
)
from deckdepot.appman_settings import load_settings
from deckdepot.errors import EngineError
from deckdepot.flatpak_engine import sanitized_host_env

READ_TIMEOUT_SEC = 25
MUTATION_TIMEOUT_SEC = {
    "install": 600,
    "update": 600,
    "update_all": 600,
    "uninstall": 180,
}
APPMAN_UPDATE_ALL_APP_ID = "all-appman-apps"
CATEGORY_BROWSE_CAP = 40
# AppMan install.am default: download this PNG when an install has no icon.
AM_CATALOGUE_ICONS = (
    "https://raw.githubusercontent.com/Portable-Linux-Apps/"
    "Portable-Linux-Apps.github.io/main/icons"
)
MAX_LOCAL_ICON_BYTES = 256 * 1024
FILES_RE = re.compile(
    r"^[\s◆*-]*([A-Za-z0-9][A-Za-z0-9._+*-]*)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|(.*)$"
)
HTTPS_RE = re.compile(r"https://[^\s]+")
ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")

FAILURE_MARKERS = (
    "INSTALLATION ABORTED",
    "OPERATION ABORTED",
    "ABORTED!",
    "does NOT exist",
    "ERROR DURING INSTALLATION",
    "NOT a valid package",
    "unknown option",
    "Checksum cannot be verified",
    "✖ ERROR",
    "💀 ERROR",
)
INSTALL_SUCCESS_MARKERS = (
    " INSTALLED ",
    "INSTALLED (",
    "is already installed",
    "IS ALREADY INSTALLED",
    "have been installed",
    "installed successfully",
)
REMOVE_SUCCESS_MARKERS = ("has been removed", "HAS BEEN REMOVED")
UPDATE_HARD_FAILURE_MARKERS = (
    "INSTALLATION ABORTED",
    "OPERATION ABORTED",
    "ABORTED!",
    "does NOT exist",
    "ERROR DURING INSTALLATION",
    "NOT a valid package",
    "unknown option",
    "✖ ERROR",
    "💀 ERROR",
    "cannot be updated",
)
UPDATE_SUCCESS_MARKERS = (
    "is updated",
    "already up to date",
    "Nothing to do here",
    "Update not needed",
)


def _user_home() -> str:
    return str(getattr(decky, "DECKY_USER_HOME", None) or os.environ.get("HOME") or "")


def _clip(text: str, limit: int = 4000) -> str:
    text = text or ""
    if len(text) <= limit:
        return text
    return text[:limit] + "\n…[truncated]"


def _strip_ansi(text: str) -> str:
    return ANSI_RE.sub("", text or "")


def detect_binary(user_home: str | None = None) -> str | None:
    home = user_home or _user_home()
    candidates = [
        os.path.join(home, ".local", "bin", "appman"),
        os.path.join(home, "bin", "appman"),
        "/usr/local/bin/appman",
        "/usr/bin/appman",
    ]
    which = os.environ.get("PATH") or ""
    for directory in which.split(":"):
        if directory:
            candidates.append(os.path.join(directory, "appman"))
    seen: set[str] = set()
    for path in candidates:
        if path in seen:
            continue
        seen.add(path)
        if os.path.isfile(path) and os.access(path, os.X_OK):
            return path
    return None


def require_binary() -> str:
    path = detect_binary()
    if not path:
        raise EngineError(
            "APPMAN_NOT_FOUND",
            "AppMan is not installed for this user. DeckDepot does not vendor it.",
        )
    return path


def appman_env(user_home: str | None = None) -> dict[str, str]:
    home = user_home or _user_home()
    env = sanitized_host_env()
    env.pop("LD_LIBRARY_PATH", None)
    local_bin = os.path.join(home, ".local", "bin")
    path = env.get("PATH") or ""
    parts = [part for part in path.split(":") if part]
    if local_bin not in parts:
        env["PATH"] = f"{local_bin}:{path}" if path else local_bin
    env["HOME"] = home
    env["LC_ALL"] = "C.UTF-8"
    env["LANG"] = "C.UTF-8"
    return env


def config_info(user_home: str | None = None) -> dict[str, Any]:
    home = user_home or _user_home()
    config_home = os.environ.get("XDG_CONFIG_HOME") or os.path.join(home, ".config")
    path = os.path.join(config_home, "appman", "appman-config")
    if not os.path.isfile(path):
        return {"present": False, "path": path, "location": None}
    try:
        with open(path, encoding="utf-8") as handle:
            location = handle.read().strip() or None
    except OSError as exc:
        raise EngineError("STORAGE_ERROR", "Could not read AppMan config.") from exc
    return {
        "present": True,
        "path": path,
        "location": location,
        "locationIsOpt": bool(location and (location == "/opt" or location.startswith("/opt/"))),
        "locationWritable": bool(location and os.access(location, os.W_OK)),
    }


def _share_dir(user_home: str | None = None) -> str:
    home = user_home or _user_home()
    return os.path.join(home, ".local", "share", "AM")


def _desktop_path(app_id: str) -> str:
    home = _user_home()
    return os.path.join(home, ".local", "share", "applications", f"{app_id}-AM.desktop")


def _desktop_field(app_id: str, key: str) -> str:
    path = _desktop_path(app_id)
    if not os.path.isfile(path):
        return ""
    prefix = f"{key}="
    try:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                if line.startswith(prefix):
                    return line.split("=", 1)[1].strip()
    except OSError:
        return ""
    return ""


def _desktop_categories(app_id: str) -> str:
    return _desktop_field(app_id, "Categories")


def _allowed_icon_roots() -> list[str]:
    roots: list[str] = []
    location = config_info().get("location")
    if location:
        roots.append(os.path.realpath(str(location)))
    home = _user_home()
    roots.append(os.path.realpath(os.path.join(home, ".local", "share", "icons")))
    return roots


def _safe_local_icon_path(raw: str) -> str | None:
    value = (raw or "").strip()
    if value.startswith("file://"):
        value = value[7:]
    if not value.startswith("/") or "://" in value:
        return None
    path = os.path.realpath(value)
    if not os.path.isfile(path):
        return None
    try:
        if os.path.getsize(path) > MAX_LOCAL_ICON_BYTES:
            return None
    except OSError:
        return None
    return path if any(path == root or path.startswith(root + os.sep) for root in _allowed_icon_roots()) else None


def _local_icon_data_url(app_id: str) -> str | None:
    path = _safe_local_icon_path(_desktop_field(app_id, "Icon"))
    if not path:
        return None
    try:
        blob = open(path, "rb").read(MAX_LOCAL_ICON_BYTES + 1)
    except OSError:
        return None
    if not blob or len(blob) > MAX_LOCAL_ICON_BYTES:
        return None
    if blob.startswith(b"\x89PNG\r\n\x1a\n"):
        mime = "image/png"
    elif blob.startswith(b"\xff\xd8\xff"):
        mime = "image/jpeg"
    elif blob.startswith(b"GIF87a") or blob.startswith(b"GIF89a"):
        mime = "image/gif"
    elif blob.startswith(b"RIFF") and blob[8:12] == b"WEBP":
        mime = "image/webp"
    elif blob.lstrip().startswith(b"<svg") or blob.lstrip().startswith(b"<?xml"):
        mime = "image/svg+xml"
    else:
        return None
    return f"data:{mime};base64,{base64.standard_b64encode(blob).decode('ascii')}"


def _catalog_icon_url(app_id: str, source_id: str) -> str | None:
    if source_id != "am":
        return None
    return f"{AM_CATALOGUE_ICONS}/{app_id}.png"


def _resolve_icon_url(app_id: str, source_id: str, *, resolve_local_icon: bool) -> str | None:
    if resolve_local_icon:
        local = _local_icon_data_url(app_id)
        if local:
            return local
    return _catalog_icon_url(app_id, source_id)


async def run_appman(
    args: list[str],
    *,
    timeout_sec: int,
    binary: str | None = None,
) -> dict[str, Any]:
    path = binary or require_binary()
    env = appman_env()
    proc = await asyncio.create_subprocess_exec(
        path,
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
        start_new_session=True,
    )
    timed_out = False
    try:
        stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=timeout_sec)
    except asyncio.TimeoutError:
        timed_out = True
        try:
            os.killpg(proc.pid, 15)
        except ProcessLookupError:
            pass
        try:
            stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=5)
        except Exception:
            stdout_b, stderr_b = b"", b""
            try:
                os.killpg(proc.pid, 9)
            except ProcessLookupError:
                pass
    return {
        "argv": [path, *args],
        "exitCode": proc.returncode,
        "timedOut": timed_out,
        "stdout": _strip_ansi(stdout_b.decode("utf-8", "replace")),
        "stderr": _strip_ansi(stderr_b.decode("utf-8", "replace")),
        "pid": proc.pid,
    }


def _parse_entries(stdout: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    for raw in (stdout or "").splitlines():
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped or stripped.startswith("WARNING") or "not in PATH" in stripped:
            continue
        if stripped.startswith("SEARCH RESULTS") or stripped.startswith("---"):
            continue
        if stripped.startswith("YOU HAVE") or stripped.startswith("TOTAL SIZE"):
            continue
        if "No search results" in stripped:
            continue
        cleaned = stripped.lstrip("◆*-• ").strip()
        match = re.match(
            r"^([A-Za-z0-9][A-Za-z0-9._+-]*)\s*:\s+(.*)$",
            cleaned,
        )
        if match and (stripped.startswith("◆") or " : " in stripped[:48]):
            if current:
                rows.append(current)
            current = {
                "appId": match.group(1).strip(),
                "summary": match.group(2).strip(),
            }
            continue
        if current and (line.startswith(" ") or line.startswith("\t")):
            extra = stripped
            if extra:
                current["summary"] = f"{current['summary']} {extra}".strip()
    if current:
        rows.append(current)
    return rows


def _to_summary(
    app_id: str,
    summary: str,
    *,
    source_id: str | None = None,
    am_type: str | None = None,
    am_db: str | None = None,
    installed_state: str = "unknown",
    installed_version: str | None = None,
    desktop_categories: str = "",
    resolve_local_icon: bool = False,
) -> dict[str, Any]:
    source = validate_source_id(source_id or source_from_text(summary))
    categories, native = normalize_categories(
        summary=f"{app_id} {summary}",
        desktop_categories=desktop_categories,
    )
    label = SOURCE_LABELS.get(source, source)
    return {
        "provider": "appman",
        "appId": app_id,
        "name": app_id,
        "summary": summary or None,
        "iconUrl": _resolve_icon_url(app_id, source, resolve_local_icon=resolve_local_icon),
        "categories": categories,
        "nativeCategories": native,
        "sourceId": source,
        "sourceLabel": f"AppMan · {label}",
        "amType": am_type,
        "amDb": am_db or source,
        "installedState": installed_state,
        "installedVersion": installed_version,
        "installationScope": "user",
        "hasUpdater": False,
    }


def _catalog_list_file(scope: str, user_home: str) -> list[str]:
    share = _share_dir(user_home)
    mapping = {
        "default": ["x86_64-apps"],
        "appimages": ["x86_64-appimages"],
        "portable": ["x86_64-portable"],
        "all": [
            "x86_64-apps",
            "x86_64-busybox",
            "x86_64-coreutilsh",
            "x86_64-python",
            "x86_64-appbundle",
            "x86_64-soarpkg",
        ],
    }
    return [os.path.join(share, name) for name in mapping[scope]]


def _read_catalog_file(path: str) -> list[dict[str, Any]]:
    if not os.path.isfile(path):
        return []
    try:
        text = open(path, encoding="utf-8", errors="replace").read()
    except OSError:
        return []
    rows = []
    for entry in _parse_entries(text):
        try:
            app_id = validate_appman_name(entry["appId"])
        except EngineError:
            continue
        rows.append(_to_summary(app_id, entry.get("summary") or "", source_id=source_from_text(entry.get("summary") or "")))
    return rows


def _lookup_catalog_summary(app_id: str, source_id: str) -> str | None:
    """Reuse the local AppMan catalog description already shown on browse cards."""
    try:
        scope = validate_search_scope(load_settings()["searchScope"])
    except EngineError:
        scope = "default"
    matched: str | None = None
    for path in _catalog_list_file(scope, _user_home()):
        for entry in _read_catalog_file(path):
            if entry.get("appId") != app_id:
                continue
            text = (entry.get("summary") or "").strip()
            if not text:
                continue
            if entry.get("sourceId") == source_id:
                return text
            if matched is None:
                matched = text
    return matched


def parse_search_output(stdout: str) -> list[dict[str, Any]]:
    apps: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for entry in _parse_entries(stdout):
        try:
            app_id = validate_appman_name(entry["appId"])
        except EngineError:
            continue
        summary = entry.get("summary") or ""
        source = source_from_text(summary)
        key = (source, app_id)
        if key in seen:
            continue
        seen.add(key)
        apps.append(_to_summary(app_id, summary, source_id=source))
    return apps


async def status() -> dict[str, Any]:
    binary = detect_binary()
    settings = load_settings()
    info = {
        "ok": True,
        "available": bool(binary),
        "binary": binary,
        "searchScope": settings["searchScope"],
        "config": config_info(),
        "trustLabel": (
            "AppMan downloads installation scripts from the GitHub AM database. "
            "This is not a Flathub sandbox."
        ),
    }
    if not binary:
        return info
    command = await run_appman(["-v"], timeout_sec=8, binary=binary)
    version = ""
    for line in (command.get("stdout") or "").splitlines():
        stripped = line.strip()
        if stripped and "WARNING" not in stripped and "not in PATH" not in stripped and not stripped.startswith("-"):
            version = stripped
            break
    info["version"] = version or None
    return info


async def search(query: str, scope: str | None = None) -> dict[str, Any]:
    trimmed = (query or "").strip()
    if not trimmed:
        return {"ok": True, "query": "", "apps": [], "totalHits": 0, "available": bool(detect_binary())}
    if len(trimmed) > 80:
        raise EngineError("INVALID_ARGUMENT", "search query is too long")
    binary = detect_binary()
    if not binary:
        return {
            "ok": True,
            "query": trimmed,
            "apps": [],
            "totalHits": 0,
            "available": False,
        }
    resolved_scope = validate_search_scope(scope or load_settings()["searchScope"])
    flags = list(SCOPE_FLAGS[resolved_scope])
    command = await run_appman(
        ["-q", *flags, trimmed],
        timeout_sec=READ_TIMEOUT_SEC,
        binary=binary,
    )
    apps = parse_search_output(command["stdout"])
    return {
        "ok": True,
        "query": trimmed,
        "apps": apps,
        "totalHits": len(apps),
        "searchScope": resolved_scope,
        "available": True,
        "timedOut": command["timedOut"],
    }


async def list_category(slug: str, scope: str | None = None) -> dict[str, Any]:
    slug = (slug or "").strip()
    if slug not in {
        "game",
        "utility",
        "audiovideo",
        "graphics",
        "network",
        "office",
        "development",
    }:
        raise EngineError("INVALID_ARGUMENT", "unknown store category")
    binary = detect_binary()
    if not binary:
        return {"ok": True, "apps": [], "totalHits": 0, "available": False, "slug": slug}
    resolved_scope = validate_search_scope(scope or load_settings()["searchScope"])
    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for path in _catalog_list_file(resolved_scope, _user_home()):
        for app in _read_catalog_file(path):
            key = (app["sourceId"], app["appId"])
            if key in seen:
                continue
            seen.add(key)
            if slug in (app.get("categories") or []):
                rows.append(app)
    return {
        "ok": True,
        "slug": slug,
        "apps": rows[:CATEGORY_BROWSE_CAP],
        "totalHits": len(rows),
        "truncated": len(rows) > CATEGORY_BROWSE_CAP,
        "searchScope": resolved_scope,
        "available": True,
    }


def _parse_about(stdout: str) -> dict[str, Any]:
    text = stdout or ""
    status = "unknown"
    lowered = text.lower()
    if "status: installed" in lowered:
        status = "installed"
    elif "status: not installed" in lowered:
        status = "not_installed"
    description_lines: list[str] = []
    sites: list[str] = []
    shots: list[str] = []
    section = "body"
    skip_headers = True
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("PACKAGE:") or stripped.startswith("STATUS:") or stripped.startswith("---"):
            continue
        if stripped.startswith("Disk usage:") or stripped.startswith("Installed version:"):
            continue
        if stripped.startswith("SCREENSHOTS:"):
            section = "shots"
            continue
        if stripped.startswith("SITES:"):
            section = "sites"
            continue
        if stripped.startswith("SOURCES:"):
            section = "sources"
            continue
        if not stripped:
            continue
        if section == "shots":
            if stripped.startswith("http"):
                shots.append(stripped)
            continue
        if section == "sites":
            if stripped.startswith("http"):
                sites.append(stripped)
            continue
        if section == "sources":
            continue
        if skip_headers and stripped.upper() == stripped and len(stripped) < 12:
            continue
        skip_headers = False
        description_lines.append(stripped)
    description = " ".join(description_lines).strip()
    version = None
    usage = None
    for line in text.splitlines():
        if line.strip().startswith("Installed version:"):
            version = line.split(":", 1)[1].strip() or None
        if line.strip().startswith("Disk usage:"):
            usage = line.split(":", 1)[1].strip() or None
    return {
        "installedState": "installed" if status == "installed" else "not_installed" if status == "not_installed" else "unknown",
        "descriptionText": description or None,
        "homepageUrl": next((url for url in sites if url.startswith("https://")), None),
        "screenshots": [{"url": url} for url in shots if url.startswith("https://")],
        "installedVersion": version,
        "diskUsage": usage,
        "sites": sites,
    }


async def get_details(app_id: str, source_id: str = "am") -> dict[str, Any]:
    app_id = validate_appman_name(app_id)
    source_id = validate_source_id(source_id)
    binary = require_binary()
    flags = list(SOURCE_FLAGS[source_id])
    command = await run_appman(
        ["-a", *flags, app_id],
        timeout_sec=READ_TIMEOUT_SEC,
        binary=binary,
    )
    parsed = _parse_about(command["stdout"])
    catalog_summary = _lookup_catalog_summary(app_id, source_id)
    about_text = (parsed.get("descriptionText") or "").strip() or None
    summary = catalog_summary or ((about_text[:180] if about_text else None))
    desktop = _desktop_categories(app_id) if parsed["installedState"] == "installed" else ""
    app = _to_summary(
        app_id,
        summary or "",
        source_id=source_id,
        installed_state=parsed["installedState"],
        installed_version=parsed.get("installedVersion"),
        desktop_categories=desktop,
        resolve_local_icon=parsed["installedState"] == "installed",
    )
    app["descriptionText"] = about_text or catalog_summary
    app["homepageUrl"] = parsed.get("homepageUrl")
    app["screenshots"] = parsed.get("screenshots") or []
    app["latestVersion"] = parsed.get("installedVersion") if parsed["installedState"] == "installed" else None
    app["bundleRef"] = None
    app["launchableDesktopId"] = f"{app_id}-AM.desktop" if desktop else None
    app["hasUpdater"] = parsed["installedState"] == "installed" and _has_updater(app_id)
    return {"ok": True, "app": app}


def parse_installed_table(stdout: str) -> list[dict[str, Any]]:
    apps: list[dict[str, Any]] = []
    for raw in (stdout or "").splitlines():
        line = raw.strip()
        if "|" not in line or line.startswith("-") or "APPNAME" in line:
            continue
        match = FILES_RE.match(line.replace("◆", "◆"))
        if not match:
            parts = [part.strip() for part in line.split("|")]
            if len(parts) < 4:
                continue
            name, db, version, am_type = parts[0], parts[1], parts[2], parts[3]
        else:
            name, db, version, am_type = (
                match.group(1),
                match.group(2).strip(),
                match.group(3).strip(),
                match.group(4).strip(),
            )
        name = name.replace("◆", "").strip()
        try:
            app_id = validate_appman_name(name)
        except EngineError:
            continue
        source = "am"
        db_l = db.lower()
        if db_l in SOURCE_FLAGS:
            source = db_l
        desktop = _desktop_categories(app_id)
        row = _to_summary(
            app_id,
            "",
            source_id=source,
            am_type=am_type.replace("*", "") or None,
            am_db=db or source,
            installed_state="installed",
            installed_version=re.sub(r"[✓✖🔒*]+", "", version).strip() or None,
            desktop_categories=desktop,
            resolve_local_icon=True,
        )
        row["hasUpdater"] = _has_updater(app_id)
        apps.append(row)
    return _dedupe_appman_apps(apps)


async def list_installed() -> dict[str, Any]:
    binary = detect_binary()
    if not binary:
        return {"ok": True, "apps": [], "available": False, "malformedCount": 0}
    command = await run_appman(
        ["-f", "--byname"],
        timeout_sec=READ_TIMEOUT_SEC,
        binary=binary,
    )
    apps = parse_installed_table(command["stdout"])
    return {
        "ok": True,
        "apps": apps,
        "available": True,
        "malformedCount": 0,
        "appmanPath": binary,
    }


async def require_installed(app_id: str, source_id: str) -> dict[str, Any]:
    installed = await list_installed()
    for row in installed["apps"]:
        if row["appId"] == app_id and row.get("sourceId") == source_id:
            return row
    raise EngineError(
        "INVALID_ARGUMENT",
        f"{app_id} is not an AppMan-installed app.",
    )


def _dedupe_appman_apps(apps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: dict[tuple[str, str], dict[str, Any]] = {}
    for app in apps:
        app_id = str(app.get("appId") or "")
        source_id = str(app.get("sourceId") or "am")
        if not app_id:
            continue
        key = (source_id, app_id)
        if key in seen:
            continue
        seen[key] = app
    return list(seen.values())


def _apps_location() -> str | None:
    location = config_info().get("location")
    return str(location) if location else None


def _has_updater(app_id: str) -> bool:
    location = _apps_location()
    if not location:
        return False
    path = os.path.join(os.path.realpath(location), app_id, "AM-updater")
    return os.path.isfile(path)


def mutation_argv(operation: str, app_id: str, source_id: str) -> list[str]:
    if operation == "update_all":
        # Live contract: empty ENTRIES + --apps runs every AM-updater and does
        # not sync AppMan itself. Do not add other --flags; unknown flags with
        # no program name become a full `appman -u` including self-sync.
        return ["-y", "-u", "--apps"]
    app_id = validate_appman_name(app_id)
    source_id = validate_source_id(source_id)
    flags = list(SOURCE_FLAGS[source_id])
    if operation == "install":
        return ["-y", "-i", *flags, app_id]
    if operation == "update":
        # Never call `appman -u` without a program name. Extra --flags with no
        # name are treated as empty ENTRIES and update every AM-updater app.
        return ["-y", "-u", *flags, app_id]
    if operation == "uninstall":
        return ["-y", "-R", *flags, app_id]
    raise EngineError("INVALID_ARGUMENT", f"unsupported operation {operation}")


async def spawn_mutation(
    operation: str,
    app_id: str,
    source_id: str = "am",
) -> asyncio.subprocess.Process:
    path = require_binary()
    args = mutation_argv(operation, app_id, source_id)
    env = appman_env()
    return await asyncio.create_subprocess_exec(
        path,
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
        start_new_session=True,
    )


def interpret_result(operation: str, stdout: str, stderr: str) -> tuple[bool, str]:
    blob = f"{stdout}\n{stderr}"
    upper = blob.upper()
    lower = blob.lower()
    if operation in {"update", "update_all"}:
        if any(marker.upper() in upper for marker in UPDATE_HARD_FAILURE_MARKERS):
            return False, _clip(blob, 1500)
        # AppMan always prints "is updated" after running AM-updater, including
        # when the version did not change. Checksum warnings are not hard fails.
        if any(marker.lower() in lower for marker in UPDATE_SUCCESS_MARKERS):
            return True, _clip(blob, 1500)
        if "ERROR" not in upper and "ABORTED" not in upper:
            return True, _clip(blob, 1500)
        return False, _clip(blob, 1500)
    if any(marker.upper() in upper for marker in FAILURE_MARKERS):
        return False, _clip(blob, 1500)
    if operation == "uninstall":
        ok = any(marker.lower() in blob.lower() for marker in REMOVE_SUCCESS_MARKERS)
        return ok, _clip(blob, 1500)
    ok = any(marker.lower() in blob.lower() for marker in INSTALL_SUCCESS_MARKERS)
    return ok, _clip(blob, 1500)
