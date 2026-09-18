"""P0.11 backend `flatpak run` launch probe.

Allowlisted to currently installed user-scoped apps. Starts the process and
observes early-exit; does not kill a still-running GUI.

PluginLoader does not have a gamescope display. Direct launch must overlay
the Steam/gamescope session environment or GUI apps exit immediately.
"""

from __future__ import annotations

import asyncio
import os
import re
import subprocess
import time
from pathlib import Path
from typing import Any

from deckdepot.diagnostics import append_jsonl, log_info, persist_snapshot
from deckdepot.flatpak_contract import (
    LIST_ARGS,
    parse_list_output,
    run_flatpak,
    sanitized_host_env,
)

APP_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{1,200}$")
OBSERVE_SEC = 4
DISPLAY_KEYS = (
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "XAUTHORITY",
    "XDG_RUNTIME_DIR",
    "XDG_SESSION_TYPE",
    "XDG_CURRENT_DESKTOP",
    "DBUS_SESSION_BUS_ADDRESS",
    "XDG_SESSION_ID",
    "LANG",
    "LANGUAGE",
    "LC_ALL",
    "LC_CTYPE",
)
SKIP_CMD_TOKENS = (
    "steamwebhelper",
    "pressure-vessel",
    "podman",
    "mangoapp",
    "cursor",
    "xvfb",
)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _subset(env: dict[str, str]) -> dict[str, str | None]:
    return {key: env.get(key) for key in DISPLAY_KEYS}


def _read_proc_bytes(path: Path) -> bytes | None:
    try:
        return path.read_bytes()
    except OSError:
        return None


def _parse_environ(raw: bytes) -> dict[str, str]:
    env: dict[str, str] = {}
    for item in raw.split(b"\0"):
        if b"=" not in item:
            continue
        key, value = item.split(b"=", 1)
        env[key.decode("utf-8", "replace")] = value.decode("utf-8", "replace")
    return env


def _cmd_score(cmd: str, env: dict[str, str]) -> int:
    lowered = cmd.lower()
    if any(token in lowered for token in SKIP_CMD_TOKENS):
        return -1000
    score = 0
    if env.get("XDG_CURRENT_DESKTOP") == "gamescope":
        score += 20
    if env.get("DISPLAY"):
        score += 5
    xauth = env.get("XAUTHORITY") or ""
    if "pressure-vessel" in xauth:
        score -= 30
    if "ubuntu12_32/steam" in lowered and "steam-runtime/" not in lowered:
        score += 40
    if "bazzite-steam" in lowered:
        score += 25
    if "gamescopereaper -- bazzite-steam" in lowered:
        score += 15
    return score


def discover_gamescope_session() -> dict[str, Any]:
    """Copy display/session keys from a live Steam/gamescope process.

    PluginLoader is a system service and has no DISPLAY. Host proof: Dolphin
    aborted with `could not connect to display` and RetroArch exited 1 in 780ms
    when launched with sanitized PluginLoader env alone.
    """
    uid = os.getuid()
    plugin_env = _subset(dict(os.environ))
    best: dict[str, Any] | None = None
    readable = 0
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        status = _read_proc_bytes(entry / "status")
        if status is None:
            continue
        uid_line = next(
            (
                line
                for line in status.decode("utf-8", "replace").splitlines()
                if line.startswith("Uid:")
            ),
            "",
        )
        if not uid_line:
            continue
        try:
            ruid = int(uid_line.split()[1])
        except (IndexError, ValueError):
            continue
        if ruid != uid:
            continue
        cmdline_raw = _read_proc_bytes(entry / "cmdline")
        environ_raw = _read_proc_bytes(entry / "environ")
        if cmdline_raw is None or environ_raw is None:
            continue
        readable += 1
        cmd = cmdline_raw.replace(b"\0", b" ").decode("utf-8", "replace")
        env = _parse_environ(environ_raw)
        score = _cmd_score(cmd, env)
        if score <= 0:
            continue
        candidate = {
            "pid": int(entry.name),
            "score": score,
            "cmd": cmd[:180],
            "env": {key: env[key] for key in DISPLAY_KEYS if key in env},
        }
        if best is None or score > best["score"]:
            best = candidate

    overlay: dict[str, str] = {}
    runtime_dir = os.environ.get("XDG_RUNTIME_DIR")
    if best:
        overlay.update(best["env"])
        runtime_dir = overlay.get("XDG_RUNTIME_DIR") or runtime_dir
    # Do not set WAYLAND_DISPLAY=gamescope-0. RetroArch then becomes a Wayland
    # client with no X11 window; PPSSPP on DISPLAY=:1 created a 1280x720 window
    # that still did not receive gamescope focus (FOCUSED_APP stayed 769).
    overlay.pop("WAYLAND_DISPLAY", None)
    if "LANG" not in overlay:
        overlay["LANG"] = "C.UTF-8"
    overlay.pop("LC_ALL", None)

    return {
        "pluginDisplayEnv": plugin_env,
        "borrowed": best,
        "overlay": overlay,
        "readableProcEnvs": readable,
        "gamescopeSocketPresent": bool(
            runtime_dir and (Path(runtime_dir) / "gamescope-0").exists()
        ),
        "waylandOverlayOmitted": True,
    }


def launch_env() -> tuple[dict[str, str], dict[str, Any]]:
    env = sanitized_host_env()
    discovery = discover_gamescope_session()
    for key in DISPLAY_KEYS:
        env.pop(key, None)
    env.update(discovery["overlay"])
    return env, discovery


def _xprop_root(env: dict[str, str]) -> dict[str, Any]:
    keys = (
        "GAMESCOPE_FOCUSED_APP",
        "GAMESCOPE_FOCUSED_APP_GFX",
        "GAMESCOPE_FOCUSED_WINDOW",
        "GAMESCOPE_FOCUSABLE_WINDOWS",
        "_NET_ACTIVE_WINDOW",
        "GAMESCOPECTRL_BASELAYER_APPID",
    )
    result: dict[str, Any] = {"available": False, "values": {}}
    xprop = "/usr/bin/xprop"
    if not Path(xprop).is_file():
        result["error"] = "xprop missing"
        return result
    try:
        completed = subprocess.run(
            [xprop, "-root", *keys],
            env=env,
            capture_output=True,
            text=True,
            timeout=3,
        )
    except Exception as exc:  # noqa: BLE001
        result["error"] = f"{type(exc).__name__}: {exc}"
        return result
    result["available"] = completed.returncode == 0
    result["stdout"] = (completed.stdout or "")[:2000]
    result["stderr"] = (completed.stderr or "")[:500]
    for line in (completed.stdout or "").splitlines():
        if " = " in line:
            name, value = line.split(" = ", 1)
            result["values"][name.split("(")[0]] = value.strip()
    return result


def _x11_top_windows(env: dict[str, str]) -> list[str]:
    xwininfo = "/usr/bin/xwininfo"
    if not Path(xwininfo).is_file():
        return []
    try:
        completed = subprocess.run(
            [xwininfo, "-root", "-tree"],
            env=env,
            capture_output=True,
            text=True,
            timeout=3,
        )
    except Exception:
        return []
    names = []
    for line in (completed.stdout or "").splitlines():
        if '"' in line and "children:" not in line:
            names.append(line.strip()[:180])
            if len(names) >= 20:
                break
    return names


async def list_installed_user_apps() -> dict[str, Any]:
    command = await run_flatpak(
        list(LIST_ARGS),
        env=sanitized_host_env(),
        env_name="sanitized_no_ld_library_path",
        timeout_sec=30,
        extra_env={"LC_ALL": "C", "LANG": "C"},
    )
    parsed = None
    if command.get("exitCode") == 0:
        parsed = parse_list_output(command.get("stdout") or "")
    rows = (parsed or {}).get("rows") or []
    apps = [
        {
            "application": row.get("application"),
            "name": row.get("name"),
            "version": row.get("version"),
        }
        for row in rows
        if row.get("application")
    ]
    return {
        "collectedAtMs": _now_ms(),
        "exitCode": command.get("exitCode"),
        "apps": apps,
        "flatpakPath": command.get("path"),
    }


async def run_installed_flatpak(app_id: str, backend_instance_id: str) -> dict[str, Any]:
    if not APP_ID_RE.match(app_id):
        raise ValueError("invalid Flatpak application id")
    installed = await list_installed_user_apps()
    known = {row["application"] for row in installed.get("apps", [])}
    if app_id not in known:
        payload = {
            "collectedAtMs": _now_ms(),
            "backendInstanceId": backend_instance_id,
            "ok": False,
            "appId": app_id,
            "reason": "not_installed_user_app",
        }
        persist_snapshot("p0-launch-backend.json", payload)
        return payload

    env, discovery = launch_env()
    log_info(
        "P0.11 flatpak run --user %s display=%s wayland=%s borrowedPid=%s"
        % (
            app_id,
            env.get("DISPLAY"),
            env.get("WAYLAND_DISPLAY"),
            (discovery.get("borrowed") or {}).get("pid"),
        )
    )
    path = installed.get("flatpakPath")
    started = time.monotonic()
    result: dict[str, Any] = {
        "collectedAtMs": _now_ms(),
        "backendInstanceId": backend_instance_id,
        "ok": False,
        "appId": app_id,
        "argv": [path, "run", "--user", app_id],
        "stillRunning": False,
        "exitCode": None,
        "stdout": "",
        "stderr": "",
        "timedOut": False,
        "elapsedMs": 0,
        "session": discovery,
        "childDisplayEnv": _subset(env),
    }
    if not path:
        result["reason"] = "FLATPAK_NOT_FOUND"
        persist_snapshot("p0-launch-backend.json", result)
        return result

    proc = await asyncio.create_subprocess_exec(
        path,
        "run",
        "--user",
        app_id,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=OBSERVE_SEC)
        result["exitCode"] = proc.returncode
        result["stdout"] = stdout.decode("utf-8", errors="replace")[:4000]
        result["stderr"] = stderr.decode("utf-8", errors="replace")[:4000]
        result["stillRunning"] = False
        result["ok"] = proc.returncode == 0
        result["earlyExit"] = True
    except asyncio.TimeoutError:
        result["stillRunning"] = proc.returncode is None
        result["exitCode"] = proc.returncode
        result["ok"] = proc.returncode is None
        result["earlyExit"] = False
        result["note"] = (
            "Process still running after "
            f"{OBSERVE_SEC}s; left running so Gaming Mode visibility can be judged."
        )
    result["elapsedMs"] = int((time.monotonic() - started) * 1000)
    result["gamescopeFocus"] = _xprop_root(env)
    result["x11Windows"] = _x11_top_windows(env)
    result["visibilityNote"] = (
        "Process start != gamescope focus. gamescope --steam keeps "
        "GAMESCOPE_FOCUSED_APP=769 (Steam BPM) unless Steam itself launches the app."
    )
    persist_snapshot("p0-launch-backend.json", result)
    append_jsonl("p0-launch-backend.jsonl", result)
    log_info(
        "P0.11 run app=%s stillRunning=%s exit=%s elapsedMs=%s"
        % (
            app_id,
            result.get("stillRunning"),
            result.get("exitCode"),
            result.get("elapsedMs"),
        )
    )
    return result
