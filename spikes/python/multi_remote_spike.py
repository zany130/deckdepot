"""v1.1.0 multi-remote proofs: CEF icons, appstreamcli env, Flathub vs filter.

Standalone host harness. Not shipped. Does not add remotes or mutate installs.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import shutil
import ssl
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import aiohttp

REPO = Path(__file__).resolve().parents[2]
RESULTS_DIR = REPO / "spikes" / "results"
CEF_JSON = "http://127.0.0.1:8080/json"
SOH_ID = "org.harbourmasters.soh"
RETROARCH_ID = "org.libretro.RetroArch"
GOOPIE_ID = "xyz.goopie.launcher"
STEAM_ID = "com.valvesoftware.Steam"
LUTRIS_ID = "net.lutris.Lutris"
PONTOON_SCREENSHOT = (
    "https://raw.githubusercontent.com/briaguya0/pontoon/main/soh/screenshot-1.png"
)
BLOCKLIST = Path("/usr/share/ublue-os/flatpak-blocklist")
PLUGIN_ASSETS = Path("/home/zany130/homebrew/plugins/DeckDepot/assets")
SPIKE_ICON_NAME = "spike-soh-icon.png"
USER_AGENT = "DeckDepot-v1.1.0-multi-remote-spike"
TIMEOUT = 25


def _now_ms() -> int:
    return int(time.time() * 1000)


def _run(
    argv: list[str],
    *,
    env: dict[str, str] | None = None,
    timeout: int = TIMEOUT,
) -> dict[str, Any]:
    started = time.monotonic()
    try:
        completed = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {
            "argv": argv,
            "ok": False,
            "errorType": type(exc).__name__,
            "errorMessage": str(exc),
            "elapsedMs": int((time.monotonic() - started) * 1000),
        }
    stdout = completed.stdout or ""
    stderr = completed.stderr or ""
    return {
        "argv": argv,
        "ok": completed.returncode == 0,
        "returncode": completed.returncode,
        "elapsedMs": int((time.monotonic() - started) * 1000),
        "stdoutChars": len(stdout),
        "stderrChars": len(stderr),
        "stdoutHead": stdout[:4000],
        "stderrHead": stderr[:1500],
    }


def _find_mei_dir() -> str | None:
    tmp = Path("/tmp")
    matches = sorted(tmp.glob("_MEI*"), key=lambda p: p.stat().st_mtime, reverse=True)
    for path in matches:
        if (path / "libcrypto.so.3").is_file():
            return str(path)
    return str(matches[0]) if matches else None


def _sanitized_env() -> dict[str, str]:
    env = os.environ.copy()
    env.pop("LD_LIBRARY_PATH", None)
    env["LC_ALL"] = "C"
    env["LANG"] = "C.UTF-8"
    return env


def _pluginloader_env(mei: str) -> dict[str, str]:
    env = os.environ.copy()
    env["LD_LIBRARY_PATH"] = mei
    env["LC_ALL"] = "C"
    env["LANG"] = "C.UTF-8"
    return env


def _soh_icon_path() -> Path | None:
    active = Path(
        "/var/lib/flatpak/appstream/pontoon/x86_64/active/icons/128x128/"
        f"{SOH_ID}.png"
    )
    if active.is_file():
        return active
    found = sorted(Path("/var/lib/flatpak/appstream/pontoon").rglob(f"{SOH_ID}.png"))
    return found[0] if found else None


def _data_url(path: Path) -> str:
    raw = path.read_bytes()
    return "data:image/png;base64," + base64.b64encode(raw).decode("ascii")


def _copy_plugin_icon(src: Path) -> dict[str, Any]:
    dest = PLUGIN_ASSETS / SPIKE_ICON_NAME
    try:
        shutil.copy2(src, dest)
        return {
            "ok": True,
            "dest": str(dest),
            "bytes": dest.stat().st_size,
        }
    except OSError as exc:
        return {
            "ok": False,
            "dest": str(dest),
            "errorType": type(exc).__name__,
            "errorMessage": str(exc),
        }


def _remove_plugin_icon() -> None:
    dest = PLUGIN_ASSETS / SPIKE_ICON_NAME
    try:
        dest.unlink(missing_ok=True)
    except OSError:
        pass


def _cef_targets() -> list[dict[str, Any]]:
    request = urllib.request.Request(
        CEF_JSON, headers={"User-Agent": USER_AGENT}
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        parsed = json.loads(response.read().decode("utf-8"))
    if not isinstance(parsed, list):
        return []
    return [item for item in parsed if isinstance(item, dict)]


def _pick_deckdepot_ws(targets: list[dict[str, Any]]) -> str | None:
    for item in targets:
        url = str(item.get("url") or "")
        if "deckdepot" in url.lower():
            ws = item.get("webSocketDebuggerUrl")
            if isinstance(ws, str) and ws:
                return ws
    for item in targets:
        ws = item.get("webSocketDebuggerUrl")
        if isinstance(ws, str) and ws:
            return ws
    return None


async def _cdp_evaluate(ws_url: str, expression: str) -> dict[str, Any]:
    timeout = aiohttp.ClientTimeout(total=40)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.ws_connect(ws_url, max_msg_size=8_000_000) as ws:
            await ws.send_json(
                {
                    "id": 1,
                    "method": "Runtime.evaluate",
                    "params": {
                        "expression": expression,
                        "awaitPromise": True,
                        "returnByValue": True,
                    },
                }
            )
            async for msg in ws:
                if msg.type != aiohttp.WSMsgType.TEXT:
                    continue
                payload = json.loads(msg.data)
                if payload.get("id") == 1:
                    return payload
    return {"error": {"message": "no CDP response"}}


def _icon_probe_js(tests: list[dict[str, str]]) -> str:
    payload = json.dumps(tests)
    return f"""
(async () => {{
  const tests = {payload};
  const origin = location.origin;
  const href = location.href;
  const results = [];
  const loadImage = (name, src) => new Promise((resolve) => {{
    const img = new Image();
    const timer = setTimeout(() => {{
      resolve({{ kind: "img", name, ok: false, error: "timeout", w: 0, h: 0 }});
    }}, 8000);
    img.onload = () => {{
      clearTimeout(timer);
      resolve({{
        kind: "img",
        name,
        ok: true,
        error: null,
        w: img.naturalWidth,
        h: img.naturalHeight,
      }});
    }};
    img.onerror = () => {{
      clearTimeout(timer);
      resolve({{ kind: "img", name, ok: false, error: "error", w: 0, h: 0 }});
    }};
    img.src = src;
  }});
  const loadFetch = async (name, src) => {{
    try {{
      const response = await fetch(src);
      const buf = await response.arrayBuffer();
      return {{
        kind: "fetch",
        name,
        ok: response.ok && buf.byteLength > 0,
        error: response.ok ? null : ("http-" + response.status),
        status: response.status,
        bytes: buf.byteLength,
        type: response.headers.get("content-type"),
      }};
    }} catch (err) {{
      return {{
        kind: "fetch",
        name,
        ok: false,
        error: String(err && err.message ? err.message : err),
        status: null,
        bytes: 0,
        type: null,
      }};
    }}
  }};
  for (const test of tests) {{
    results.push(await loadImage(test.name, test.src));
    if (!String(test.src).startsWith("data:")) {{
      results.push(await loadFetch(test.name, test.src));
    }}
  }}
  return {{ origin, href, results }};
}})()
"""


def probe_icons() -> dict[str, Any]:
    icon = _soh_icon_path()
    copied = _copy_plugin_icon(icon) if icon else {"ok": False, "error": "no icon"}
    data_url = _data_url(icon) if icon else ""
    file_uri = icon.as_uri() if icon else ""
    tests = [
        {"name": "https-screenshot", "src": PONTOON_SCREENSHOT},
        {"name": "file-appstream", "src": file_uri},
        {"name": "data-url-soh", "src": data_url},
        {
            "name": "plugin-loopback-store",
            "src": "https://steamloopback.host/plugins/DeckDepot/assets/store.png",
        },
        {
            "name": "plugin-relative-store",
            "src": "/plugins/DeckDepot/assets/store.png",
        },
        {
            "name": "plugin-loopback-soh",
            "src": "https://steamloopback.host/plugins/DeckDepot/assets/"
            + SPIKE_ICON_NAME,
        },
        {
            "name": "plugin-127-store",
            "src": "http://127.0.0.1:1337/plugins/DeckDepot/assets/store.png",
        },
    ]
    try:
        targets = _cef_targets()
        ws = _pick_deckdepot_ws(targets)
        cdp = (
            asyncio.run(_cdp_evaluate(ws, _icon_probe_js(tests)))
            if ws
            else {"error": {"message": "no CEF websocket"}}
        )
    finally:
        _remove_plugin_icon()

    value = ((cdp.get("result") or {}).get("result") or {}).get("value")
    exception = (cdp.get("result") or {}).get("exceptionDetails")
    compact_tests = []
    if isinstance(value, dict):
        for row in value.get("results") or []:
            if not isinstance(row, dict):
                continue
            compact_tests.append(
                {
                    "kind": row.get("kind"),
                    "name": row.get("name"),
                    "ok": row.get("ok"),
                    "error": row.get("error"),
                    "w": row.get("w"),
                    "h": row.get("h"),
                    "status": row.get("status"),
                    "bytes": row.get("bytes"),
                    "type": row.get("type"),
                }
            )
    return {
        "iconPath": str(icon) if icon else None,
        "iconBytes": icon.stat().st_size if icon else None,
        "fileUri": file_uri,
        "dataUrlChars": len(data_url),
        "pluginCopy": copied,
        "cefTargets": [
            {
                "title": item.get("title"),
                "url": item.get("url"),
                "type": item.get("type"),
            }
            for item in targets
        ],
        "origin": value.get("origin") if isinstance(value, dict) else None,
        "href": value.get("href") if isinstance(value, dict) else None,
        "tests": compact_tests,
        "cdpException": str(exception)[:800] if exception else None,
        "cdpError": cdp.get("error"),
    }


def _appstream_ids() -> list[str]:
    return [SOH_ID, RETROARCH_ID, GOOPIE_ID]


def probe_appstreamcli() -> dict[str, Any]:
    mei = _find_mei_dir()
    appstreamcli = shutil.which("appstreamcli") or "/usr/bin/appstreamcli"
    variants: dict[str, dict[str, str] | None] = {
        "inherited": os.environ.copy(),
        "pluginloader_ld": _pluginloader_env(mei) if mei else None,
        "sanitized": _sanitized_env(),
    }
    runs: dict[str, Any] = {"appstreamcli": appstreamcli, "mei": mei, "byEnv": {}}
    for env_name, env in variants.items():
        if env is None:
            runs["byEnv"][env_name] = {"skipped": True, "reason": "no MEI dir"}
            continue
        per_id = {}
        for app_id in _appstream_ids():
            result = _run([appstreamcli, "get", "--details", app_id], env=env)
            stdout = result.get("stdoutHead") or ""
            per_id[app_id] = {
                "ok": result["ok"],
                "returncode": result.get("returncode"),
                "elapsedMs": result.get("elapsedMs"),
                "stderrHead": result.get("stderrHead"),
                "hasDescription": "Description:" in stdout or "Description:" in stdout,
                "hasIcon": "Icon:" in stdout,
                "hasScreenshot": "http" in stdout.lower() and "png" in stdout.lower(),
                "hasCategories": "Categories:" in stdout or "Category:" in stdout,
                "stdoutHead": stdout[:2500],
                "errorType": result.get("errorType"),
                "errorMessage": result.get("errorMessage"),
            }
        version = _run([appstreamcli, "--version"], env=env)
        runs["byEnv"][env_name] = {
            "ldLibraryPathSet": bool(env.get("LD_LIBRARY_PATH")),
            "ldLibraryPath": env.get("LD_LIBRARY_PATH"),
            "version": {
                "ok": version["ok"],
                "returncode": version.get("returncode"),
                "stdoutHead": version.get("stdoutHead"),
                "stderrHead": version.get("stderrHead"),
            },
            "ids": per_id,
        }
    return runs


def _http_json(method: str, url: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    started = time.monotonic()
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    context = ssl.create_default_context()
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT, context=context) as response:
            raw = response.read(400_000)
            parsed: Any
            try:
                parsed = json.loads(raw.decode("utf-8", "replace"))
            except json.JSONDecodeError:
                parsed = None
            return {
                "url": url,
                "status": getattr(response, "status", None),
                "ok": True,
                "elapsedMs": int((time.monotonic() - started) * 1000),
                "parsed": parsed,
            }
    except Exception as exc:  # noqa: BLE001 - spike
        status = exc.code if isinstance(exc, urllib.error.HTTPError) else None
        return {
            "url": url,
            "status": status,
            "ok": False,
            "elapsedMs": int((time.monotonic() - started) * 1000),
            "errorType": type(exc).__name__,
            "errorMessage": str(exc),
        }


def _remote_ls_set(scope: str, remote: str) -> dict[str, Any]:
    argv = [
        "flatpak",
        f"--{scope}",
        "remote-ls",
        "--app",
        "--cached",
        remote,
        "--columns=application",
    ]
    started = time.monotonic()
    completed = subprocess.run(
        argv,
        capture_output=True,
        text=True,
        timeout=60,
        env=_sanitized_env(),
        check=False,
    )
    ids = {
        line.strip()
        for line in (completed.stdout or "").splitlines()
        if line.strip()
    }
    return {
        "ok": completed.returncode == 0,
        "returncode": completed.returncode,
        "elapsedMs": int((time.monotonic() - started) * 1000),
        "count": len(ids),
        "ids": ids,
        "stderrHead": (completed.stderr or "")[:800],
    }


def _parse_blocklist() -> list[str]:
    if not BLOCKLIST.is_file():
        return []
    ids = []
    for line in BLOCKLIST.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or not line.startswith("deny "):
            continue
        token = line.split(None, 1)[1]
        app_id = token.split("/", 1)[0]
        if app_id:
            ids.append(app_id)
    return ids


def _search_hits_ids(parsed: Any) -> list[str]:
    if not isinstance(parsed, dict):
        return []
    hits = parsed.get("hits")
    if not isinstance(hits, list):
        return []
    out = []
    for hit in hits:
        if isinstance(hit, dict) and isinstance(hit.get("app_id"), str):
            out.append(hit["app_id"])
    return out


def _category_ids(parsed: Any) -> list[str]:
    if not isinstance(parsed, dict):
        return []
    hits = parsed.get("hits")
    if isinstance(hits, list):
        return _search_hits_ids(parsed)
    for key in ("apps", "results"):
        rows = parsed.get(key)
        if isinstance(rows, list):
            ids = []
            for row in rows:
                if isinstance(row, dict):
                    app_id = row.get("app_id") or row.get("id")
                    if isinstance(app_id, str):
                        ids.append(app_id)
            return ids
    return []


def probe_filter() -> dict[str, Any]:
    blocked = _parse_blocklist()
    watch = (STEAM_ID, LUTRIS_ID, RETROARCH_ID)
    system_ls = _remote_ls_set("system", "flathub")
    user_ls = _remote_ls_set("user", "flathub")
    system = {
        app_id: {
            "ok": system_ls["ok"],
            "count": system_ls["count"],
            "elapsedMs": system_ls["elapsedMs"],
            "present": app_id in system_ls["ids"],
            "stderrHead": system_ls["stderrHead"],
        }
        for app_id in watch
    }
    user = {
        app_id: {
            "ok": user_ls["ok"],
            "count": user_ls["count"],
            "elapsedMs": user_ls["elapsedMs"],
            "present": app_id in user_ls["ids"],
            "stderrHead": user_ls["stderrHead"],
        }
        for app_id in watch
    }
    http_hits = {}
    for app_id in (STEAM_ID, LUTRIS_ID, RETROARCH_ID):
        query = app_id.split(".")[-1]
        search = _http_json(
            "POST",
            "https://flathub.org/api/v2/search",
            {"query": query, "filters": []},
        )
        ids = _search_hits_ids(search.get("parsed"))
        http_hits[app_id] = {
            "ok": search.get("ok"),
            "status": search.get("status"),
            "elapsedMs": search.get("elapsedMs"),
            "query": query,
            "hitCount": len(ids),
            "exactHit": app_id in ids,
            "errorMessage": search.get("errorMessage"),
        }
    category = _http_json(
        "GET",
        "https://flathub.org/api/v2/collection/category/game?page=1&per_page=50",
    )
    category_ids = _category_ids(category.get("parsed"))
    blocked_in_category = sorted(set(blocked) & set(category_ids))
    return {
        "blocklistPath": str(BLOCKLIST),
        "blocklistExists": BLOCKLIST.is_file(),
        "blockedIds": blocked,
        "systemRemoteLs": system,
        "userRemoteLs": user,
        "flathubSearch": http_hits,
        "flathubGameCategory": {
            "ok": category.get("ok"),
            "status": category.get("status"),
            "elapsedMs": category.get("elapsedMs"),
            "pageCount": len(category_ids),
            "blockedOnThisPage": blocked_in_category,
            "includesSteam": STEAM_ID in category_ids,
            "includesLutris": LUTRIS_ID in category_ids,
            "includesRetroArch": RETROARCH_ID in category_ids,
            "errorMessage": category.get("errorMessage"),
        },
        "delta": {
            "steamHttp": http_hits[STEAM_ID]["exactHit"],
            "steamUserRemote": user[STEAM_ID]["present"],
            "steamSystemRemote": system[STEAM_ID]["present"],
            "lutrisHttp": http_hits[LUTRIS_ID]["exactHit"],
            "lutrisUserRemote": user[LUTRIS_ID]["present"],
            "lutrisSystemRemote": system[LUTRIS_ID]["present"],
            "retroarchHttp": http_hits[RETROARCH_ID]["exactHit"],
            "retroarchUserRemote": user[RETROARCH_ID]["present"],
            "retroarchSystemRemote": system[RETROARCH_ID]["present"],
        },
    }


def main() -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "generatedAtMs": _now_ms(),
        "icons": probe_icons(),
        "appstreamcli": probe_appstreamcli(),
        "filter": probe_filter(),
    }
    out = RESULTS_DIR / "multi-remote-spike.json"
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"wrote": str(out), "keys": list(payload.keys())}))


if __name__ == "__main__":
    main()
