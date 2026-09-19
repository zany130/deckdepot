"""Read-only catalog over already-configured enumeratable Flatpak remotes.

Does not add, delete, enable, or reconfigure remotes. Skips no-enumerate
and disabled remotes. Never uses unnamed `remote-ls` as a browse-all.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import shutil
import time
from pathlib import Path
from typing import Any

from deckdepot.diagnostics import log_info
from deckdepot.errors import EngineError
from deckdepot.flatpak_engine import (
    COMMAND_TIMEOUT_SEC,
    list_remotes_for_scope,
    run_flatpak,
    sanitized_host_env,
)
from deckdepot.ids import validate_flatpak_app_id, validate_remote_name

REMOTE_LS_COLUMNS = (
    "application",
    "name",
    "description",
    "version",
    "branch",
    "arch",
    "origin",
    "ref",
)
APPSTREAM_MAIN_TO_SLUG = {
    "Game": "game",
    "Utility": "utility",
    "AudioVideo": "audiovideo",
    "Audio": "audiovideo",
    "Video": "audiovideo",
    "Graphics": "graphics",
    "Network": "network",
    "Office": "office",
    "Development": "development",
}
APPSTREAM_EXTRA_TO_SLUG = {
    "ActionGame": "game",
    "AdventureGame": "game",
    "ArcadeGame": "game",
    "BoardGame": "game",
    "BlocksGame": "game",
    "CardGame": "game",
    "Emulator": "game",
    "KidsGame": "game",
    "LogicGame": "game",
    "RolePlaying": "game",
    "Shooter": "game",
    "Simulation": "game",
    "SportsGame": "game",
    "StrategyGame": "game",
}
DEFAULT_ARCH = "x86_64"
CACHE_TTL_SEC = 300
APPSTREAM_TTL_SEC = 600
ICON_MAX_BYTES = 200_000

_cache: dict[str, tuple[float, Any]] = {}
_cache_lock = asyncio.Lock()


def _now() -> float:
    return time.monotonic()


def clear_catalog_cache() -> None:
    _cache.clear()


def _cache_get(key: str) -> Any | None:
    item = _cache.get(key)
    if not item:
        return None
    expires, value = item
    if expires < _now():
        _cache.pop(key, None)
        return None
    return value


def _cache_set(key: str, value: Any, ttl: int) -> Any:
    _cache[key] = (_now() + ttl, value)
    return value


def _warning(remote_name: str, message: str) -> dict[str, str]:
    return {"remoteName": remote_name, "errorMessage": message}


def catalog_key(
    scope: str,
    remote_name: str,
    app_id: str,
    arch: str,
    branch: str,
) -> str:
    return f"flatpak:{scope}:{remote_name}:{app_id}:{arch}:{branch}"


def _build_ref(app_id: str, arch: str, branch: str, ref: str | None = None) -> str:
    if ref and ref.startswith("app/"):
        return ref
    arch = arch or DEFAULT_ARCH
    branch = branch or "stable"
    return f"app/{app_id}/{arch}/{branch}"


def _summary_row(
    *,
    app_id: str,
    name: str,
    summary: str | None,
    scope: str,
    remote: dict[str, Any],
    branch: str,
    arch: str,
    ref: str,
    version: str | None = None,
    categories: list[str] | None = None,
    icon_url: str | None = None,
    origin: str | None = None,
) -> dict[str, Any]:
    remote_name = str(remote.get("name") or "")
    title = str(remote.get("displayTitle") or remote.get("title") or remote_name)
    return {
        "provider": "flatpak",
        "appId": app_id,
        "name": name or app_id,
        "summary": summary or None,
        "iconUrl": icon_url,
        "categories": categories or [],
        "installedState": "unknown",
        "installationScope": scope,
        "remoteName": remote_name,
        "sourceLabel": title,
        "origin": origin or remote_name,
        "branch": branch,
        "arch": arch or DEFAULT_ARCH,
        "ref": ref,
        "latestVersion": version,
        "catalogKey": catalog_key(
            scope, remote_name, app_id, arch or DEFAULT_ARCH, branch
        ),
    }


async def list_catalog_remotes(*, refresh: bool = False) -> dict[str, Any]:
    async with _cache_lock:
        cached = None if refresh else _cache_get("remotes")
        if cached is not None:
            return cached
        user, system = await asyncio.gather(
            _remotes_or_error("user"),
            _remotes_or_error("system"),
            return_exceptions=False,
        )
        payload = {
            "ok": True,
            "user": user,
            "system": system,
            "enumeratable": [
                *_enumeratable_public(user, "user"),
                *_enumeratable_public(system, "system"),
            ],
        }
        return _cache_set("remotes", payload, CACHE_TTL_SEC)


async def _remotes_or_error(scope: str) -> dict[str, Any]:
    try:
        result = await list_remotes_for_scope(scope)
        return {
            "ok": True,
            "installationScope": scope,
            "remotes": result.get("remotes") or [],
            "error": None,
        }
    except EngineError as exc:
        return {
            "ok": False,
            "installationScope": scope,
            "remotes": [],
            "error": exc.to_dict(),
        }


def _enumeratable_public(bundle: dict[str, Any], scope: str) -> list[dict[str, Any]]:
    rows = []
    for remote in bundle.get("remotes") or []:
        if not remote.get("enumeratable"):
            continue
        rows.append(
            {
                "installationScope": scope,
                "name": remote.get("name"),
                "title": remote.get("displayTitle") or remote.get("name"),
                "url": remote.get("url") or "",
                "priority": remote.get("priority") or 0,
                "filtered": bool(remote.get("filtered")),
                "isFlathub": bool(remote.get("isFlathub")),
            }
        )
    return rows


def _enumeratable_for_scope(bundle: dict[str, Any]) -> list[dict[str, Any]]:
    return [row for row in bundle.get("remotes") or [] if row.get("enumeratable")]


def logical_source_key(remote: dict[str, Any]) -> str | None:
    """Stable identity for pairing the same configured repository across scopes.

    Flathub remotes match even when local names differ. Other remotes match by
    normalized URL. Name-only matching is not used: that would confuse unrelated
    remotes that happen to share a label.
    """
    url = str(remote.get("url") or "").strip().rstrip("/").lower()
    if remote.get("isFlathub") or "flathub.org" in url:
        return "flathub"
    if url:
        return f"url:{url}"
    return None


def system_remote_is_filtered(remote: dict[str, Any]) -> bool:
    """True when Flatpak itself reports an active repository filter.

    Uses remotes columns (`filtered` option and/or a configured filter path).
    Does not read distro-private blocklist files.
    """
    if remote.get("filtered"):
        return True
    return bool(str(remote.get("filter") or "").strip())


def index_logical_sources(
    remotes: list[dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], set[str]]:
    buckets: dict[str, list[dict[str, Any]]] = {}
    for remote in remotes:
        key = logical_source_key(remote)
        if not key:
            continue
        buckets.setdefault(key, []).append(remote)
    index: dict[str, dict[str, Any]] = {}
    ambiguous: set[str] = set()
    for key, rows in buckets.items():
        if len(rows) == 1:
            index[key] = rows[0]
        else:
            ambiguous.add(key)
    return index, ambiguous


def _undetermined_policy(reason: str) -> dict[str, Any]:
    return {
        "ok": True,
        "determined": False,
        "deniedAppIds": [],
        "pairs": [],
        "reason": reason,
    }


def apply_host_policy(
    apps: list[dict[str, Any]], denied_ids: set[str]
) -> tuple[list[dict[str, Any]], int]:
    if not denied_ids:
        return apps, 0
    kept: list[dict[str, Any]] = []
    dropped = 0
    for app in apps:
        if str(app.get("appId") or "") in denied_ids:
            dropped += 1
            continue
        kept.append(app)
    return kept, dropped


def denied_ids_from_policy(policy: dict[str, Any]) -> set[str]:
    if not policy.get("determined"):
        return set()
    return {str(app_id) for app_id in policy.get("deniedAppIds") or [] if app_id}


async def host_policy(*, refresh: bool = False) -> dict[str, Any]:
    """Derive app IDs the host's system Flatpak policy intentionally excludes.

    Case A: the same logical repository exists in both scopes, the system copy
    is filtered, and the app is listed on the user copy but not the system copy.
    Case B: an app exists only on an unrelated user-only or system-only remote
    and is not a policy deny.
    Fail open (determined=False, empty deny set) when inventory cannot be read.
    """
    cached = None if refresh else _cache_get("host-policy")
    if cached is not None:
        return cached
    payload = await _compute_host_policy(refresh=refresh)
    return _cache_set("host-policy", payload, CACHE_TTL_SEC)


async def _compute_host_policy(*, refresh: bool) -> dict[str, Any]:
    try:
        remotes = await list_catalog_remotes(refresh=refresh)
    except Exception as exc:
        log_info(f"host policy unavailable: remotes inventory failed: {exc}")
        return _undetermined_policy("remotes inventory failed")
    user_bundle = remotes.get("user") or {}
    system_bundle = remotes.get("system") or {}
    if not user_bundle.get("ok") or not system_bundle.get("ok"):
        reason = "user or system remotes listing failed"
        log_info(f"host policy unavailable: {reason}")
        return _undetermined_policy(reason)

    user_index, user_ambiguous = index_logical_sources(
        _enumeratable_for_scope(user_bundle)
    )
    system_index, system_ambiguous = index_logical_sources(
        _enumeratable_for_scope(system_bundle)
    )
    for key in sorted(user_ambiguous | system_ambiguous):
        log_info(f"host policy skip ambiguous logical source {key}")

    denied: set[str] = set()
    pairs: list[dict[str, Any]] = []
    for key, user_remote in user_index.items():
        system_remote = system_index.get(key)
        if not system_remote:
            continue
        if not system_remote_is_filtered(system_remote):
            pairs.append(
                {
                    "logicalSource": key,
                    "userRemote": user_remote.get("name"),
                    "systemRemote": system_remote.get("name"),
                    "systemFiltered": False,
                    "deniedCount": 0,
                }
            )
            continue
        user_ids = await _remote_app_ids(
            "user", str(user_remote.get("name") or ""), refresh=refresh
        )
        system_ids = await _remote_app_ids(
            "system", str(system_remote.get("name") or ""), refresh=refresh
        )
        if user_ids is None or system_ids is None:
            log_info(
                "host policy skip filtered source %s: remote-ls failed user=%s system=%s"
                % (key, user_ids is None, system_ids is None)
            )
            continue
        pair_denied = sorted(user_ids - system_ids)
        denied.update(pair_denied)
        pairs.append(
            {
                "logicalSource": key,
                "userRemote": user_remote.get("name"),
                "systemRemote": system_remote.get("name"),
                "systemFiltered": True,
                "deniedCount": len(pair_denied),
            }
        )
        if pair_denied:
            log_info(
                "host policy denied %s from %s (%s user vs %s system): %s"
                % (
                    key,
                    user_remote.get("name"),
                    len(user_ids),
                    len(system_ids),
                    ",".join(pair_denied),
                )
            )
    payload = {
        "ok": True,
        "determined": True,
        "deniedAppIds": sorted(denied),
        "pairs": pairs,
        "reason": None,
    }
    log_info(
        "host policy determined denied=%s pairs=%s"
        % (len(denied), len(pairs))
    )
    return payload


async def _remote_app_ids(
    scope: str, remote_name: str, *, refresh: bool = False
) -> set[str] | None:
    if not remote_name:
        return None
    try:
        listed = await _remote_ls(scope, remote_name, refresh=refresh)
    except EngineError as exc:
        log_info(
            "host policy remote-ls failed scope=%s remote=%s %s"
            % (scope, remote_name, exc.message)
        )
        return None
    return {str(row.get("appId")) for row in listed.get("apps") or [] if row.get("appId")}


async def reject_denied_install(app_id: str) -> None:
    from deckdepot.flatpak_settings import load_settings

    settings = load_settings()
    if not settings.get("respectDistroFilters", True):
        return
    policy = await host_policy()
    if app_id in denied_ids_from_policy(policy):
        log_info(f"host policy blocked install appId={app_id}")
        raise EngineError(
            "INVALID_ARGUMENT",
            "This application isn't available to install from DeckDepot on this host.",
            details={"reason": "host-policy-denied", "appId": app_id},
        )


async def _remote_ls(scope: str, remote_name: str, *, refresh: bool = False) -> dict[str, Any]:
    key = f"ls:{scope}:{remote_name}"
    cached = None if refresh else _cache_get(key)
    if cached is not None:
        return cached
    flag = "--user" if scope == "user" else "--system"
    command = await run_flatpak(
        [
            flag,
            "remote-ls",
            "--app",
            "--cached",
            remote_name,
            f"--columns={','.join(REMOTE_LS_COLUMNS)}",
        ],
        timeout_sec=COMMAND_TIMEOUT_SEC["remote_ls"],
        extra_env={"LC_ALL": "C", "LANG": "C.UTF-8"},
    )
    if command["exitCode"] != 0:
        raise EngineError(
            "PROCESS_FAILED",
            f"Could not list apps from {remote_name}.",
            details={
                "exitCode": command["exitCode"],
                "stderr": (command["stderr"] or "")[:1500],
                "installationScope": scope,
                "remoteName": remote_name,
            },
        )
    apps = []
    for line in (command["stdout"] or "").splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        while len(parts) < len(REMOTE_LS_COLUMNS):
            parts.append("")
        row = dict(zip(REMOTE_LS_COLUMNS, parts[: len(REMOTE_LS_COLUMNS)]))
        app_id = (row.get("application") or "").strip()
        if not app_id:
            continue
        branch = (row.get("branch") or "stable").strip() or "stable"
        arch = (row.get("arch") or DEFAULT_ARCH).strip() or DEFAULT_ARCH
        apps.append(
            {
                "appId": app_id,
                "name": (row.get("name") or app_id).strip(),
                "summary": (row.get("description") or "").strip() or None,
                "version": (row.get("version") or "").strip() or None,
                "branch": branch,
                "arch": arch,
                "origin": (row.get("origin") or remote_name).strip() or remote_name,
                "ref": _build_ref(app_id, arch, branch, (row.get("ref") or "").strip() or None),
            }
        )
    payload = {"ok": True, "apps": apps}
    return _cache_set(key, payload, CACHE_TTL_SEC)


async def flathub_app_ids(scope: str, *, refresh: bool = False) -> dict[str, Any]:
    remotes = await list_catalog_remotes(refresh=refresh)
    bundle = remotes.get(scope) or {}
    flathub = next(
        (row for row in bundle.get("remotes") or [] if row.get("isFlathub") and row.get("enumeratable")),
        None,
    )
    if not flathub:
        return {"ok": True, "present": False, "ids": [], "count": 0, "remoteName": None}
    try:
        listed = await _remote_ls(scope, str(flathub["name"]), refresh=refresh)
    except EngineError as exc:
        return {
            "ok": False,
            "present": True,
            "ids": [],
            "count": 0,
            "remoteName": flathub["name"],
            "error": exc.to_dict(),
        }
    ids = sorted({row["appId"] for row in listed["apps"]})
    return {
        "ok": True,
        "present": True,
        "ids": ids,
        "count": len(ids),
        "remoteName": flathub["name"],
    }


async def _run_appstreamcli(app_id: str) -> dict[str, Any]:
    path = shutil.which("appstreamcli") or "/usr/bin/appstreamcli"
    env = sanitized_host_env()
    env["LC_ALL"] = "C"
    env["LANG"] = "C.UTF-8"
    started = time.monotonic()
    proc = await asyncio.create_subprocess_exec(
        path,
        "get",
        "--details",
        app_id,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
        start_new_session=True,
    )
    try:
        stdout_b, stderr_b = await asyncio.wait_for(
            proc.communicate(), timeout=COMMAND_TIMEOUT_SEC["appstream"]
        )
    except asyncio.TimeoutError as exc:
        if proc.returncode is None:
            proc.kill()
        raise EngineError("PROCESS_FAILED", "appstreamcli timed out.") from exc
    return {
        "exitCode": proc.returncode,
        "stdout": stdout_b.decode("utf-8", "replace"),
        "stderr": stderr_b.decode("utf-8", "replace"),
        "elapsedMs": int((time.monotonic() - started) * 1000),
    }


def _parse_appstream_details(stdout: str) -> dict[str, Any]:
    name = ""
    summary = ""
    homepage = ""
    icon = ""
    developer = ""
    license_name = ""
    screenshot = ""
    bundle = ""
    eol_reason = ""
    description_lines: list[str] = []
    categories: list[str] = []
    section: str | None = None
    for raw in (stdout or "").splitlines():
        line = raw.rstrip()
        if line.startswith("Name:"):
            name = line.split(":", 1)[1].strip()
            section = None
        elif line.startswith("Summary:"):
            summary = line.split(":", 1)[1].strip()
            section = None
        elif line.startswith("Homepage:"):
            homepage = line.split(":", 1)[1].strip()
            section = None
        elif line.startswith("Icon:"):
            icon = line.split(":", 1)[1].strip()
            section = None
        elif line.startswith("Developer:"):
            developer = line.split(":", 1)[1].strip()
            section = None
        elif line.startswith("License:"):
            license_name = line.split(":", 1)[1].strip()
            section = None
        elif line.startswith("End of Life:") or line.startswith("Deprecated:"):
            eol_reason = line.split(":", 1)[1].strip()
            section = None
        elif line.startswith("Bundle:"):
            bundle = line.split(":", 1)[1].strip()
            section = None
        elif line.startswith("Default Screenshot URL:"):
            screenshot = line.split(":", 1)[1].strip()
            section = "screenshot"
        elif line.startswith("Description:"):
            rest = line.split(":", 1)[1].strip()
            description_lines = [rest] if rest else []
            section = "description"
        elif line.startswith("Categories:"):
            categories = []
            section = "categories"
        elif section == "screenshot" and line.strip().startswith("http"):
            screenshot = line.strip()
            section = None
        elif section == "description":
            if line.startswith(" ") or line.startswith("\t") or line.startswith("  "):
                description_lines.append(line.strip())
            elif not line.strip():
                description_lines.append("")
            else:
                section = None
        elif section == "categories":
            stripped = line.strip()
            if stripped.startswith("- "):
                categories.append(stripped[2:].strip())
            elif not stripped:
                continue
            else:
                section = None
    description = "\n".join(item for item in description_lines if item is not None).strip()
    slugs = []
    seen = set()
    for category in categories:
        slug = APPSTREAM_MAIN_TO_SLUG.get(category) or APPSTREAM_EXTRA_TO_SLUG.get(category)
        if slug and slug not in seen:
            seen.add(slug)
            slugs.append(slug)
    return {
        "name": name,
        "summary": summary,
        "homepageUrl": homepage or None,
        "iconName": icon or None,
        "developerName": developer or None,
        "projectLicense": license_name or None,
        "isEol": True if eol_reason else None,
        "screenshotUrl": screenshot if screenshot.startswith("https://") else None,
        "bundleRef": bundle or None,
        "descriptionText": description or None,
        "nativeCategories": categories,
        "categories": slugs,
    }


def _icon_data_url(remote_name: str, app_id: str, icon_name: str | None) -> str | None:
    names = []
    if icon_name:
        names.append(icon_name)
    names.append(f"{app_id}.png")
    roots = [
        Path("/var/lib/flatpak/appstream"),
        Path(os.path.expanduser("~/.local/share/flatpak/appstream")),
    ]
    home = os.environ.get("HOME")
    if home:
        roots.append(Path(home) / ".local/share/flatpak/appstream")
    sizes = ("128x128", "64x64", "48x48", "32x32")
    for root in roots:
        remote_root = root / remote_name
        if not remote_root.is_dir():
            continue
        for size in sizes:
            for filename in names:
                matches = list(remote_root.glob(f"*/icons/{size}/{filename}"))
                active = remote_root / "x86_64" / "active" / "icons" / size / filename
                paths = ([active] if active.is_file() else []) + matches
                for path in paths:
                    try:
                        if not path.is_file():
                            continue
                        raw = path.read_bytes()
                    except OSError:
                        continue
                    if not raw or len(raw) > ICON_MAX_BYTES:
                        continue
                    return "data:image/png;base64," + base64.b64encode(raw).decode("ascii")
    return None


async def appstream_details(app_id: str, *, refresh: bool = False) -> dict[str, Any]:
    try:
        app_id = validate_flatpak_app_id(app_id)
    except EngineError as exc:
        return {"ok": False, "error": exc.to_dict()}
    key = f"appstream:{app_id}"
    cached = None if refresh else _cache_get(key)
    if cached is not None:
        return cached
    command = await _run_appstreamcli(app_id)
    if command["exitCode"] != 0:
        payload = {
            "ok": False,
            "appId": app_id,
            "errorCode": "NOT_FOUND" if command["exitCode"] == 4 else "PROCESS_FAILED",
            "errorMessage": (command["stderr"] or "appstreamcli failed").strip()[:800],
        }
        return _cache_set(key, payload, 60)
    parsed = _parse_appstream_details(command["stdout"] or "")
    payload = {"ok": True, "appId": app_id, **parsed}
    return _cache_set(key, payload, APPSTREAM_TTL_SEC)


async def _enrich_row(
    row: dict[str, Any], remote: dict[str, Any], *, with_icon: bool, refresh: bool
) -> dict[str, Any]:
    details = await appstream_details(row["appId"], refresh=refresh)
    if details.get("ok"):
        if details.get("summary") and not row.get("summary"):
            row["summary"] = details["summary"]
        if details.get("name"):
            row["name"] = details["name"]
        row["categories"] = details.get("categories") or row.get("categories") or []
        row["nativeCategories"] = details.get("nativeCategories") or []
        row["developerName"] = details.get("developerName")
        row["homepageUrl"] = details.get("homepageUrl")
        row["descriptionText"] = details.get("descriptionText")
        row["projectLicense"] = details.get("projectLicense")
        if details.get("isEol") is True:
            row["isEol"] = True
        screenshot = details.get("screenshotUrl")
        row["screenshots"] = [{"url": screenshot}] if screenshot else []
        if with_icon and not row.get("iconUrl"):
            row["iconUrl"] = _icon_data_url(
                str(remote.get("name") or ""),
                row["appId"],
                details.get("iconName"),
            )
    elif with_icon and not row.get("iconUrl"):
        row["iconUrl"] = _icon_data_url(
            str(remote.get("name") or ""), row["appId"], None
        )
    return row


async def search_host_catalog(query: str, *, refresh: bool = False) -> dict[str, Any]:
    trimmed = (query or "").strip()
    if not trimmed:
        return {
            "ok": True,
            "query": "",
            "apps": [],
            "totalHits": 0,
            "page": 1,
            "totalPages": 1,
            "droppedHitCount": 0,
            "warnings": [],
        }
    remotes = await list_catalog_remotes(refresh=refresh)
    warnings: list[dict[str, str]] = []
    user_task = _search_scope("user", trimmed)
    system_task = _search_scope("system", trimmed)
    user_hits, system_hits = await asyncio.gather(user_task, system_task)
    apps: list[dict[str, Any]] = []
    seen: set[str] = set()
    for scope, payload in (("user", user_hits), ("system", system_hits)):
        if not payload.get("ok"):
            warnings.append(
                _warning(
                    scope,
                    str(payload.get("errorMessage") or f"Could not search {scope} remotes"),
                )
            )
            continue
        bundle = remotes.get(scope) or {}
        by_name = {row.get("name"): row for row in bundle.get("remotes") or []}
        for hit in payload.get("hits") or []:
            app_id = hit.get("application_id") or ""
            try:
                app_id = validate_flatpak_app_id(str(app_id))
            except EngineError:
                continue
            branch = str(hit.get("branch") or "stable").strip() or "stable"
            for remote_name in _split_remote_names(hit.get("remotes")):
                remote = by_name.get(remote_name)
                if not remote or not remote.get("enumeratable"):
                    continue
                arch = DEFAULT_ARCH
                ref = _build_ref(app_id, arch, branch)
                key = catalog_key(scope, remote_name, app_id, arch, branch)
                if key in seen:
                    continue
                seen.add(key)
                row = _summary_row(
                    app_id=app_id,
                    name=str(hit.get("name") or app_id),
                    summary=str(hit.get("description") or "").strip() or None,
                    scope=scope,
                    remote=remote,
                    branch=branch,
                    arch=arch,
                    ref=ref,
                    version=str(hit.get("version") or "").strip() or None,
                )
                if not remote.get("isFlathub"):
                    row = await _enrich_row(row, remote, with_icon=True, refresh=refresh)
                apps.append(row)
    return {
        "ok": True,
        "query": trimmed,
        "apps": apps,
        "totalHits": len(apps),
        "page": 1,
        "totalPages": 1,
        "droppedHitCount": 0,
        "warnings": warnings,
    }


def _split_remote_names(raw: Any) -> list[str]:
    if isinstance(raw, list):
        return [str(item).strip() for item in raw if str(item).strip()]
    return [item.strip() for item in str(raw or "").split(",") if item.strip()]


async def _search_scope(scope: str, query: str) -> dict[str, Any]:
    flag = "--user" if scope == "user" else "--system"
    command = await run_flatpak(
        [flag, "search", "--json", query],
        timeout_sec=COMMAND_TIMEOUT_SEC["search"],
        extra_env={"LC_ALL": "C", "LANG": "C.UTF-8"},
    )
    if command["exitCode"] != 0:
        return {
            "ok": False,
            "errorMessage": (command["stderr"] or "flatpak search failed").strip()[:800],
        }
    try:
        parsed = json.loads(command["stdout"] or "[]")
    except json.JSONDecodeError:
        return {"ok": False, "errorMessage": "flatpak search returned invalid JSON."}
    hits = parsed if isinstance(parsed, list) else []
    return {"ok": True, "hits": hits}


async def list_third_party_category(slug: str, *, refresh: bool = False) -> dict[str, Any]:
    remotes = await list_catalog_remotes(refresh=refresh)
    warnings: list[dict[str, str]] = []
    apps: list[dict[str, Any]] = []
    seen: set[str] = set()
    for scope in ("user", "system"):
        bundle = remotes.get(scope) or {}
        if not bundle.get("ok"):
            error = bundle.get("error") or {}
            warnings.append(
                _warning(
                    scope,
                    str(error.get("errorMessage") or f"Could not list {scope} remotes"),
                )
            )
            continue
        for remote in _enumeratable_for_scope(bundle):
            if remote.get("isFlathub"):
                continue
            name = str(remote.get("name") or "")
            try:
                listed = await _remote_ls(scope, name, refresh=refresh)
            except EngineError as exc:
                warnings.append(_warning(name, exc.message))
                continue
            for item in listed.get("apps") or []:
                row = _summary_row(
                    app_id=item["appId"],
                    name=item["name"],
                    summary=item.get("summary"),
                    scope=scope,
                    remote=remote,
                    branch=item["branch"],
                    arch=item["arch"],
                    ref=item["ref"],
                    version=item.get("version"),
                    origin=item.get("origin"),
                )
                row = await _enrich_row(row, remote, with_icon=True, refresh=refresh)
                if slug not in (row.get("categories") or []):
                    continue
                key = row.get("catalogKey") or ""
                if key in seen:
                    continue
                seen.add(key)
                apps.append(row)
    apps.sort(key=lambda row: (str(row.get("name") or ""), str(row.get("branch") or "")))
    return {
        "ok": True,
        "query": slug,
        "apps": apps,
        "totalHits": len(apps),
        "page": 1,
        "totalPages": 1,
        "droppedHitCount": 0,
        "warnings": warnings,
    }


async def get_host_details(
    app_id: str,
    *,
    installation_scope: str = "",
    remote_name: str = "",
    ref: str = "",
    branch: str = "",
    arch: str = "",
    refresh: bool = False,
) -> dict[str, Any]:
    app_id = validate_flatpak_app_id(app_id)
    scope = (installation_scope or "").strip().lower() or None
    remote = None
    if remote_name:
        remote_name = validate_remote_name(remote_name)
    remotes = await list_catalog_remotes(refresh=refresh)
    if scope in {"user", "system"} and remote_name:
        bundle = remotes.get(scope) or {}
        remote = next(
            (row for row in bundle.get("remotes") or [] if row.get("name") == remote_name),
            None,
        )
    details = await appstream_details(app_id, refresh=refresh)
    icon_url = None
    if remote:
        icon_url = _icon_data_url(
            remote_name,
            app_id,
            details.get("iconName") if details.get("ok") else None,
        )
    name = app_id
    summary = None
    if details.get("ok"):
        name = details.get("name") or app_id
        summary = details.get("summary")
    arch = arch or DEFAULT_ARCH
    branch = branch or "stable"
    ref = ref or _build_ref(app_id, arch, branch)
    source_label = (
        (remote or {}).get("displayTitle") or remote_name or "Flatpak"
    )
    screenshots = []
    if details.get("ok") and details.get("screenshotUrl"):
        screenshots = [{"url": details["screenshotUrl"]}]
    app = {
        "provider": "flatpak",
        "appId": app_id,
        "name": name,
        "summary": summary,
        "iconUrl": icon_url,
        "categories": details.get("categories") or [] if details.get("ok") else [],
        "nativeCategories": details.get("nativeCategories") or [],
        "developerName": details.get("developerName") if details.get("ok") else None,
        "installedState": "unknown",
        "installationScope": scope,
        "remoteName": remote_name or None,
        "sourceLabel": source_label,
        "origin": remote_name or None,
        "branch": branch,
        "arch": arch,
        "ref": ref,
        "descriptionText": details.get("descriptionText") if details.get("ok") else None,
        "projectLicense": details.get("projectLicense") if details.get("ok") else None,
        "isEol": True if details.get("ok") and details.get("isEol") is True else None,
        "homepageUrl": details.get("homepageUrl") if details.get("ok") else None,
        "screenshots": screenshots,
        "bundleRef": details.get("bundleRef") if details.get("ok") else None,
        "latestVersion": None,
    }
    return {"ok": True, "app": app}


async def refresh_catalog() -> dict[str, Any]:
    clear_catalog_cache()
    remotes = await list_catalog_remotes(refresh=True)
    await host_policy(refresh=True)
    return {"ok": True, "remotes": remotes.get("enumeratable") or []}
