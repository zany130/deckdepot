"""Minimal SteamGridDB automation: first matching game, first image per slot.

Secret-bearing HTTPS stays backend-owned and uses Decky get_ssl_context().
The API key is never logged. Artwork misses are skipped, not raised as
Add-to-Steam failures.
"""

from __future__ import annotations

import base64
import json
import os
import stat
import tempfile
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request, urlopen

from deckdepot.diagnostics import helper_ssl_context, log_info
from deckdepot.errors import EngineError
from deckdepot.redact import redact_text

SETTINGS_FILENAME = "steamgriddb.json"
SETTINGS_VERSION = 1
API_BASE = "https://www.steamgriddb.com/api/v2"
USER_AGENT = "DeckDepot/1.0.2"
TIMEOUT_SEC = 20
MAX_KEY_LEN = 256
MAX_NAME_LEN = 128
MAX_IMAGE_BYTES = 8_000_000
MAX_JSON_BYTES = 1_000_000
ALLOWED_IMAGE_HOST_SUFFIXES = (".steamgriddb.com",)
ALLOWED_IMAGE_HOSTS = {"steamgriddb.com", "www.steamgriddb.com"}
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
JPEG_MAGIC = b"\xff\xd8\xff"
WEBP_RIFF = b"RIFF"
WEBP_MARK = b"WEBP"
# Observed from the working SteamGridDB plugin's default (filters=null) search:
# one GET per category with the full default dimension/mime/style lists. Capsule
# and Wide Capsule share /grids; the dimension list is what distinguishes them.
# A single-size `dimensions=` filter can return zero rows when the category
# still has art (Moonlight Wide Capsule: 460x215 empty, 460x215,920x430 returns).
_GRID_STYLES = "alternate,white_logo,no_logo,blurred,material"
_RASTER_MIMES = "image/png,image/jpeg,image/webp"
_ICON_SIZES = (
    1024,
    768,
    512,
    310,
    256,
    194,
    192,
    180,
    160,
    152,
    150,
    144,
    128,
    120,
    114,
    100,
    96,
    90,
    80,
    76,
    72,
    64,
    60,
    57,
    56,
    54,
    48,
    40,
    35,
    32,
    28,
    24,
    20,
    16,
    14,
    10,
    8,
)
_ASSET_CACHE: dict[str, dict[str, Any]] = {}
LIBRARY_SLOTS = (
    (
        "capsule",
        0,
        "grids",
        {
            "page": "0",
            "styles": _GRID_STYLES,
            "dimensions": "600x900,342x482,660x930",
            "mimes": _RASTER_MIMES,
            "nsfw": "false",
            "humor": "any",
            "epilepsy": "any",
        },
    ),
    (
        "header",
        3,
        "grids",
        {
            "page": "0",
            "styles": _GRID_STYLES,
            "dimensions": "460x215,920x430",
            "mimes": _RASTER_MIMES,
            "nsfw": "false",
            "humor": "any",
            "epilepsy": "any",
        },
    ),
    (
        "hero",
        1,
        "heroes",
        {
            "page": "0",
            "styles": "alternate,blurred,material",
            "dimensions": "1920x620,3840x1240,1600x650",
            "mimes": _RASTER_MIMES,
            "nsfw": "false",
            "humor": "any",
            "epilepsy": "any",
        },
    ),
    (
        "logo",
        2,
        "logos",
        {
            "page": "0",
            "styles": "official,white,black,custom",
            "mimes": "image/png,image/webp",
            "nsfw": "false",
            "humor": "any",
            "epilepsy": "any",
        },
    ),
    (
        "icon",
        4,
        "icons",
        {
            "page": "0",
            "styles": "official,custom",
            "dimensions": ",".join(str(size) for size in _ICON_SIZES),
            "mimes": "image/png,image/vnd.microsoft.icon",
            "nsfw": "false",
            "humor": "any",
            "epilepsy": "any",
        },
    ),
)


def _settings_dir() -> str:
    import decky

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


def _empty_settings() -> dict[str, Any]:
    return {"version": SETTINGS_VERSION, "apiKey": ""}


def _load_settings() -> dict[str, Any]:
    path = settings_path()
    if not os.path.exists(path):
        return _empty_settings()
    try:
        with open(path, encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        raise EngineError(
            "STORAGE_ERROR",
            "Could not read SteamGridDB settings.",
            details={"errorType": type(exc).__name__},
        ) from exc
    if not isinstance(payload, dict):
        return _empty_settings()
    key = payload.get("apiKey")
    return {
        "version": SETTINGS_VERSION,
        "apiKey": key.strip() if isinstance(key, str) else "",
    }


def _write_settings(payload: dict[str, Any]) -> None:
    path = settings_path()
    encoded = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    fd, tmp_path = tempfile.mkstemp(
        prefix="steamgriddb.",
        suffix=".tmp",
        dir=os.path.dirname(path),
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(encoded)
        os.replace(tmp_path, path)
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
    except OSError as exc:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise EngineError(
            "STORAGE_ERROR",
            "Could not write SteamGridDB settings.",
            details={"errorType": type(exc).__name__, "errno": getattr(exc, "errno", None)},
        ) from exc
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _validate_key(raw: str) -> str:
    key = raw.strip()
    if not key:
        raise EngineError("INVALID_ARGUMENT", "SteamGridDB API key is empty.")
    if len(key) > MAX_KEY_LEN:
        raise EngineError("INVALID_ARGUMENT", "SteamGridDB API key is too long.")
    if any(ord(ch) < 32 for ch in key):
        raise EngineError("INVALID_ARGUMENT", "SteamGridDB API key is invalid.")
    return key


def get_status() -> dict[str, Any]:
    settings = _load_settings()
    context, helper = helper_ssl_context()
    return {
        "ok": True,
        "configured": bool(settings["apiKey"]),
        "tlsAvailable": context is not None,
        "tlsHelper": helper if context is not None else "unavailable",
    }


def set_api_key(api_key: str) -> dict[str, Any]:
    key = _validate_key(str(api_key or ""))
    _write_settings({"version": SETTINGS_VERSION, "apiKey": key})
    log_info("SteamGridDB API key saved")
    return get_status()


def clear_api_key() -> dict[str, Any]:
    _write_settings(_empty_settings())
    log_info("SteamGridDB API key cleared")
    return get_status()


def _skip(reason: str, **extra: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {"ok": True, "skipped": True, "reason": reason}
    payload.update(extra)
    return payload


def _redact(message: str, secret: str) -> str:
    return redact_text(message, secret)


def _image_host_allowed(host: str) -> bool:
    lowered = host.lower().rstrip(".")
    if lowered in ALLOWED_IMAGE_HOSTS:
        return True
    return any(lowered.endswith(suffix) for suffix in ALLOWED_IMAGE_HOST_SUFFIXES)


def _validate_image_url(raw: str) -> str:
    parsed = urlparse(raw)
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or not _image_host_allowed(parsed.netloc)
    ):
        raise EngineError("INVALID_ARGUMENT", "SteamGridDB image URL is not allowed.")
    return raw


def _request_json(url: str, context: Any, api_key: str) -> dict[str, Any]:
    last_network: URLError | None = None
    for attempt in range(2):
        request = Request(
            url,
            method="GET",
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
        )
        try:
            with urlopen(request, timeout=TIMEOUT_SEC, context=context) as response:
                raw = response.read(MAX_JSON_BYTES)
                parsed = json.loads(raw.decode("utf-8", "replace"))
        except HTTPError as exc:
            raise EngineError(
                "NETWORK_ERROR",
                "SteamGridDB request failed.",
                details={"httpStatus": exc.code},
            ) from exc
        except URLError as exc:
            last_network = exc
            if attempt == 0:
                time.sleep(0.4)
                continue
            raise EngineError(
                "NETWORK_ERROR",
                _redact(str(exc.reason or exc), api_key),
            ) from exc
        except json.JSONDecodeError as exc:
            raise EngineError(
                "REMOTE_SCHEMA_ERROR", "SteamGridDB returned invalid JSON."
            ) from exc
        if not isinstance(parsed, dict):
            raise EngineError(
                "REMOTE_SCHEMA_ERROR", "SteamGridDB response is not an object."
            )
        return parsed
    raise EngineError(
        "NETWORK_ERROR",
        _redact(str(last_network.reason if last_network else "network error"), api_key),
    )


def _candidate_urls(images: Any) -> list[str]:
    urls: list[str] = []
    if not isinstance(images, list):
        return urls
    for image in images:
        if not isinstance(image, dict):
            continue
        url = image.get("url")
        if not isinstance(url, str) or not url:
            continue
        try:
            urls.append(_validate_image_url(url))
        except EngineError:
            continue
    return urls


def _list_images(
    context: Any, api_key: str, kind: str, game_id: int, params: dict[str, str]
) -> Any:
    query = urlencode(params)
    url = f"{API_BASE}/{kind}/game/{game_id}"
    if query:
        url = f"{url}?{query}"
    payload = _request_json(url, context, api_key)
    if payload.get("success") is not True:
        return None
    return payload.get("data")


def _asset_from_urls(
    urls: list[str], context: Any, category: str, asset_type: int
) -> dict[str, Any] | None:
    for url in urls:
        try:
            blob = _download_image(url, context)
        except EngineError:
            continue
        image_type = _steam_image_type(blob)
        if image_type is None:
            continue
        return {
            "category": category,
            "assetType": asset_type,
            "imageType": image_type,
            "byteLength": len(blob),
            "base64": base64.b64encode(blob).decode("ascii"),
        }
    return None


def _slot_candidates(
    context: Any,
    api_key: str,
    game_id: int,
    slot: tuple[str, int, str, dict[str, str]],
) -> dict[str, Any] | None:
    category, asset_type, kind, params = slot
    filtered = dict(params)
    urls = _candidate_urls(_list_images(context, api_key, kind, game_id, filtered))
    if not urls and "dimensions" in filtered:
        unfiltered = dict(filtered)
        unfiltered.pop("dimensions")
        log_info(
            f"SteamGridDB {category} filtered list empty, retry without dimensions"
        )
        urls = _candidate_urls(
            _list_images(context, api_key, kind, game_id, unfiltered)
        )
    if not urls:
        return None
    return {"category": category, "assetType": asset_type, "urls": urls}


def _download_image(url: str, context: Any) -> bytes:
    safe_url = _validate_image_url(url)
    request = Request(
        safe_url,
        method="GET",
        headers={"User-Agent": USER_AGENT, "Accept": "image/png,image/jpeg,image/webp"},
    )
    try:
        with urlopen(request, timeout=TIMEOUT_SEC, context=context) as response:
            chunks: list[bytes] = []
            total = 0
            while True:
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_IMAGE_BYTES:
                    raise EngineError("REMOTE_SCHEMA_ERROR", "SteamGridDB image is too large.")
                chunks.append(chunk)
            return b"".join(chunks)
    except EngineError:
        raise
    except HTTPError as exc:
        raise EngineError(
            "NETWORK_ERROR",
            "SteamGridDB image download failed.",
            details={"httpStatus": exc.code},
        ) from exc
    except URLError as exc:
        raise EngineError("NETWORK_ERROR", str(exc.reason or exc)) from exc


def _steam_image_type(blob: bytes) -> str | None:
    """Format string for SetCustomArtworkForApp.

    Decky types this as "png" | "jpg". The working SteamGridDB plugin still
    lists WebP in Capsule/Wide Capsule/Hero/Logo defaults and applies those
    downloads with format "png". No device evidence that WebP cannot be used.
    """
    if blob.startswith(JPEG_MAGIC):
        return "jpg"
    if blob.startswith(PNG_MAGIC):
        return "png"
    if len(blob) >= 12 and blob.startswith(WEBP_RIFF) and blob[8:12] == WEBP_MARK:
        return "png"
    return None


def _pick_game(games: list[Any], display_name: str) -> dict[str, Any] | None:
    exact = None
    for row in games:
        if not isinstance(row, dict) or not isinstance(row.get("id"), int):
            continue
        if str(row.get("name") or "") == display_name:
            exact = row
            break
    if exact is not None:
        return exact
    first = games[0]
    return first if isinstance(first, dict) and isinstance(first.get("id"), int) else None


def fetch_capsule_artwork(name: str) -> dict[str, Any]:
    display_name = str(name or "").strip()[:MAX_NAME_LEN]
    if not display_name:
        return _skip("empty_name")

    settings = _load_settings()
    api_key = settings["apiKey"]
    if not api_key:
        return _skip("not_configured")

    context, helper = helper_ssl_context()
    if context is None:
        return _skip("tls_unavailable")

    try:
        search_url = f"{API_BASE}/search/autocomplete/{quote(display_name, safe='')}"
        search = _request_json(search_url, context, api_key)
        games = search.get("data")
        if search.get("success") is not True or not isinstance(games, list) or not games:
            log_info("SteamGridDB search returned no games")
            return _skip("no_results")
        first = _pick_game(games, display_name)
        if first is None:
            return _skip("no_results")
        game_id = first["id"]
        matched_name = str(first.get("name") or display_name)

        categories: list[str] = []
        _ASSET_CACHE.clear()
        for slot in LIBRARY_SLOTS:
            pending = _slot_candidates(context, api_key, game_id, slot)
            if pending is None:
                continue
            category = str(pending["category"])
            _ASSET_CACHE[category] = pending
            categories.append(category)
            log_info(
                f"SteamGridDB {category} listed helper={helper} "
                f"gameId={game_id} candidates={len(pending['urls'])}"
            )
        if not categories:
            log_info(f"SteamGridDB artwork missing for gameId={game_id}")
            return _skip("no_image", steamGridDbGameId=game_id, matchedName=matched_name)

        return {
            "ok": True,
            "skipped": False,
            "matchedName": matched_name,
            "steamGridDbGameId": game_id,
            "categories": categories,
        }
    except EngineError as exc:
        log_info(f"SteamGridDB fetch skipped code={exc.code}")
        return {
            "ok": True,
            "skipped": True,
            "reason": "provider_error",
            "errorCode": exc.code,
            "errorMessage": _redact(exc.message, api_key),
        }


def get_cached_artwork(category: str) -> dict[str, Any]:
    pending = _ASSET_CACHE.get(str(category or ""))
    if not pending:
        return _skip("no_image")
    if pending.get("base64"):
        return {"ok": True, "skipped": False, "asset": pending}

    context, helper = helper_ssl_context()
    if context is None:
        return _skip("tls_unavailable")
    asset = _asset_from_urls(
        list(pending.get("urls") or []),
        context,
        str(pending.get("category") or category),
        int(pending.get("assetType") or 0),
    )
    if asset is None:
        log_info(f"SteamGridDB {category} had listed urls but none Steam can apply")
        return _skip("no_image")
    _ASSET_CACHE[str(category)] = asset
    log_info(
        f"SteamGridDB {asset['category']} ready helper={helper} "
        f"imageType={asset['imageType']} bytes={asset['byteLength']}"
    )
    return {"ok": True, "skipped": False, "asset": asset}


def clear_asset_cache() -> None:
    _ASSET_CACHE.clear()
