"""P0.12 Flathub v2 schema capture from the Decky backend TLS path.

Production catalog still prefers CEF/frontend fetch. This probe exists to
compare helper-TLS backend fetch against the live schema.
"""

from __future__ import annotations

import json
import ssl
import time
import urllib.error
import urllib.request
from typing import Any

from deckdepot.diagnostics import _helper_ssl_context, log_info, persist_snapshot

SEARCH_URL = "https://flathub.org/api/v2/search"
APPSTREAM_URL = "https://flathub.org/api/v2/appstream/org.libretro.RetroArch"
CATEGORY_URL = "https://flathub.org/api/v2/collection/category/game?page=1&per_page=5"
TIMEOUT_SEC = 20


def _now_ms() -> int:
    return int(time.time() * 1000)


def _fetch(
    context: ssl.SSLContext,
    method: str,
    url: str,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    started = time.monotonic()
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "User-Agent": "DeckDepot-P0.12",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SEC, context=context) as response:
            raw = response.read(200_000)
            text = raw.decode("utf-8", "replace")
            try:
                parsed: Any = json.loads(text)
            except json.JSONDecodeError:
                parsed = None
            return {
                "url": url,
                "method": method,
                "status": getattr(response, "status", None),
                "elapsedMs": int((time.monotonic() - started) * 1000),
                "bytes": len(raw),
                "parsedType": type(parsed).__name__,
                "parsed": parsed,
            }
    except Exception as exc:  # noqa: BLE001 - schema probe
        status = None
        if isinstance(exc, urllib.error.HTTPError):
            status = exc.code
        return {
            "url": url,
            "method": method,
            "status": status,
            "elapsedMs": int((time.monotonic() - started) * 1000),
            "errorType": type(exc).__name__,
            "errorMessage": str(exc),
        }


def _compact_search(parsed: Any) -> Any:
    if not isinstance(parsed, dict):
        return parsed
    hits = parsed.get("hits")
    compact = {key: parsed.get(key) for key in parsed if key != "hits"}
    compact["hits"] = hits[:1] if isinstance(hits, list) else hits
    compact.pop("facetDistribution", None)
    return compact


def _compact_appstream(parsed: Any) -> Any:
    if not isinstance(parsed, dict):
        return parsed
    screenshots = parsed.get("screenshots")
    return {
        "id": parsed.get("id"),
        "name": parsed.get("name"),
        "icon": parsed.get("icon"),
        "icons": parsed.get("icons"),
        "launchable": parsed.get("launchable"),
        "topKeys": sorted(parsed.keys()),
        "screenshot0": screenshots[0] if isinstance(screenshots, list) and screenshots else None,
    }


def probe_flathub_schema(backend_instance_id: str) -> dict[str, Any]:
    log_info("P0.12 Flathub schema probe via Decky TLS helper")
    context, helper_name = _helper_ssl_context()
    if context is None:
        payload = {
            "collectedAtMs": _now_ms(),
            "backendInstanceId": backend_instance_id,
            "client": "backend_get_ssl_context",
            "ok": False,
            "error": "helpers.get_ssl_context unavailable",
        }
        persist_snapshot("p0-flathub-schema-backend.json", payload)
        return payload

    search = _fetch(
        context,
        "POST",
        SEARCH_URL,
        {"query": "retroarch", "filters": []},
    )
    appstream = _fetch(context, "GET", APPSTREAM_URL)
    category = _fetch(context, "GET", CATEGORY_URL)
    if isinstance(search.get("parsed"), dict):
        search = {**search, "parsed": _compact_search(search["parsed"])}
    if isinstance(appstream.get("parsed"), dict):
        appstream = {**appstream, "parsed": _compact_appstream(appstream["parsed"])}
    if isinstance(category.get("parsed"), dict):
        hits = category["parsed"].get("hits")
        category = {
            **category,
            "parsed": {
                "hitsPerPage": category["parsed"].get("hitsPerPage"),
                "page": category["parsed"].get("page"),
                "totalHits": category["parsed"].get("totalHits"),
                "hit0": hits[0] if isinstance(hits, list) and hits else None,
            },
        }

    payload = {
        "collectedAtMs": _now_ms(),
        "backendInstanceId": backend_instance_id,
        "client": "backend_get_ssl_context",
        "helperName": helper_name,
        "search": search,
        "appstream": appstream,
        "category": category,
    }
    persist_snapshot("p0-flathub-schema-backend.json", payload)
    log_info(
        "P0.12 backend search=%s appstream=%s category=%s"
        % (
            search.get("status"),
            appstream.get("status"),
            category.get("status"),
        )
    )
    return payload
