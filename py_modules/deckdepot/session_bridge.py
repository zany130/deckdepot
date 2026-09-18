"""Transient user-systemd session bridge for system Flatpak mutations.

Verified architecture (SESSION_BRIDGE_PASS):

    DeckDepot backend (non-root PluginLoader child)
      → systemd-run --user
      → user-systemd helper
      → flatpak --system ...
      → existing flatpak-system-helper
      → existing distro/Flatpak polkit policy

Do not use this for AppMan or user-scoped Flatpak. Do not expose arbitrary
command execution. Units are transient (`--collect`); nothing is installed
under the user systemd directory.

PluginLoader/PyInstaller injects LD_LIBRARY_PATH that breaks host OpenSSL and
libsystemd. Every host binary invoked here uses an explicit env dict — never
`os.environ.copy()`.
"""

from __future__ import annotations

import asyncio
import os
import pwd
import time
from typing import Any

from deckdepot.errors import EngineError

SYSTEMD_RUN = "/usr/bin/systemd-run"
SYSTEMCTL = "/usr/bin/systemctl"
PYTHON = "/usr/bin/python3"
PKCHECK = "/usr/bin/pkcheck"
FLATPAK = "/usr/bin/flatpak"

PROBE_UNIT = "deckdepot-session-bridge-probe.service"
PROBE_ACTION = "org.freedesktop.Flatpak.app-install"
PROBE_TIMEOUT_SEC = 12
ALLOWED_FLATPAK_OPS = {"install", "update", "uninstall"}

# Tiny helper: print pkcheck rc for the bridged process itself.
_PROBE_SCRIPT = (
    "import os,subprocess,sys;"
    "pid=os.getpid();"
    "env={'PATH':'/usr/bin:/bin','HOME':os.environ.get('HOME',''),"
    "'USER':os.environ.get('USER',''),"
    "'XDG_RUNTIME_DIR':os.environ.get('XDG_RUNTIME_DIR','')};"
    "r=subprocess.run([%r,'--action-id',%r,'--process',str(pid)],"
    "capture_output=True,text=True,env=env);"
    "sys.stdout.write((r.stdout or '')+(r.stderr or ''));"
    "raise SystemExit(r.returncode)"
) % (PKCHECK, PROBE_ACTION)

_capability_cache: dict[str, Any] | None = None
_capability_lock = asyncio.Lock()


def decky_uid() -> int:
    try:
        import decky

        home = getattr(decky, "DECKY_USER_HOME", None)
        if home:
            return pwd.getpwnam(os.path.basename(os.path.realpath(home))).pw_uid
    except Exception:
        pass
    return os.getuid()


def bridge_env() -> dict[str, str]:
    """Env for systemd-run --user and other host binaries from PluginLoader.

    Must not inherit PluginLoader/PyInstaller LD_LIBRARY_PATH.
    Must inject XDG_RUNTIME_DIR so the unprivileged plugin can reach the
    user bus. Do not copy os.environ.
    """
    uid = decky_uid()
    runtime = f"/run/user/{uid}"
    pw = pwd.getpwuid(uid)
    env = {
        "HOME": pw.pw_dir,
        "USER": pw.pw_name,
        "LOGNAME": pw.pw_name,
        "PATH": "/usr/bin:/bin",
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
    }
    if os.path.isdir(runtime):
        env["XDG_RUNTIME_DIR"] = runtime
        bus = f"{runtime}/bus"
        if os.path.exists(bus):
            env["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path={bus}"
    return env


def _require_runtime(env: dict[str, str]) -> str:
    runtime = env.get("XDG_RUNTIME_DIR") or ""
    if not runtime or not os.path.isdir(runtime):
        raise EngineError(
            "SESSION_BRIDGE_UNAVAILABLE",
            "The user systemd runtime directory is not available.",
            details={"runtimeDir": runtime or None},
        )
    bus = os.path.join(runtime, "bus")
    if not os.path.exists(bus):
        raise EngineError(
            "SESSION_BRIDGE_UNAVAILABLE",
            "The user session bus is not reachable.",
            details={"bus": bus},
        )
    return runtime


def validate_system_flatpak_args(args: list[str]) -> list[str]:
    if not args or not isinstance(args, list):
        raise EngineError("INVALID_ARGUMENT", "system Flatpak argv is empty")
    if any(not isinstance(item, str) or item == "" for item in args):
        raise EngineError("INVALID_ARGUMENT", "system Flatpak argv is invalid")
    if any("\x00" in item for item in args):
        raise EngineError("INVALID_ARGUMENT", "system Flatpak argv is invalid")
    if args[0] not in ALLOWED_FLATPAK_OPS:
        raise EngineError(
            "INVALID_ARGUMENT",
            "system Flatpak bridge only allows install, update, or uninstall.",
        )
    if "--system" not in args:
        raise EngineError("INVALID_ARGUMENT", "system Flatpak argv must include --system")
    if "--user" in args:
        raise EngineError("INVALID_ARGUMENT", "system Flatpak bridge cannot take --user")
    return list(args)


def systemd_run_argv(unit: str, command: list[str]) -> list[str]:
    if not unit.endswith(".service") or "/" in unit or ".." in unit:
        raise EngineError("INVALID_ARGUMENT", "invalid transient unit name")
    return [
        SYSTEMD_RUN,
        "--user",
        "--collect",
        "--wait",
        "--pipe",
        "--quiet",
        f"--unit={unit}",
        "--",
        *command,
    ]


async def spawn_bridged_command(
    command: list[str],
    *,
    unit: str,
    timeout_sec: int,
) -> asyncio.subprocess.Process:
    # TaskManager enforces timeout_sec via wait/kill; systemd-run --wait has no
    # matching deadline of its own. Reject non-positive values so callers cannot
    # "simplify" this away.
    if timeout_sec < 1:
        raise EngineError("INVALID_ARGUMENT", "bridge timeout must be positive")
    env = bridge_env()
    _require_runtime(env)
    argv = systemd_run_argv(unit, command)
    return await asyncio.create_subprocess_exec(
        *argv,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
        start_new_session=True,
    )


async def spawn_system_flatpak(
    args: list[str],
    *,
    unit: str,
    timeout_sec: int,
) -> asyncio.subprocess.Process:
    if not os.path.isfile(FLATPAK):
        raise EngineError("FLATPAK_NOT_FOUND", "Flatpak is not available on this system.")
    validated = validate_system_flatpak_args(args)
    return await spawn_bridged_command(
        [FLATPAK, *validated],
        unit=unit,
        timeout_sec=timeout_sec,
    )


async def stop_bridged_unit(unit: str) -> None:
    env = bridge_env()
    try:
        _require_runtime(env)
    except EngineError:
        return
    proc = await asyncio.create_subprocess_exec(
        SYSTEMCTL,
        "--user",
        "stop",
        unit,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
        env=env,
        start_new_session=True,
    )
    try:
        await asyncio.wait_for(proc.wait(), timeout=5)
    except asyncio.TimeoutError:
        if proc.returncode is None:
            try:
                proc.kill()
            except ProcessLookupError:
                pass


async def _run_probe() -> dict[str, Any]:
    env = bridge_env()
    started = time.monotonic()
    try:
        _require_runtime(env)
    except EngineError as exc:
        return {
            "ok": True,
            "available": False,
            "reachable": False,
            "authorized": False,
            "reason": exc.message,
            "errorCode": exc.code,
            "elapsedMs": int((time.monotonic() - started) * 1000),
        }
    argv = systemd_run_argv(PROBE_UNIT, [PYTHON, "-c", _PROBE_SCRIPT])
    try:
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
            start_new_session=True,
        )
        stdout_b, stderr_b = await asyncio.wait_for(
            proc.communicate(), timeout=PROBE_TIMEOUT_SEC
        )
    except FileNotFoundError:
        return {
            "ok": True,
            "available": False,
            "reachable": False,
            "authorized": False,
            "reason": "systemd-run is not available.",
            "errorCode": "SESSION_BRIDGE_UNAVAILABLE",
            "elapsedMs": int((time.monotonic() - started) * 1000),
        }
    except asyncio.TimeoutError:
        await stop_bridged_unit(PROBE_UNIT)
        return {
            "ok": True,
            "available": False,
            "reachable": False,
            "authorized": False,
            "reason": "systemd-run --user timed out.",
            "errorCode": "SESSION_BRIDGE_UNAVAILABLE",
            "elapsedMs": int((time.monotonic() - started) * 1000),
        }
    stdout = (stdout_b or b"").decode("utf-8", "replace")
    stderr = (stderr_b or b"").decode("utf-8", "replace")
    blob = f"{stdout}\n{stderr}".lower()
    rc = proc.returncode
    reachable = rc is not None and "failed to connect" not in blob
    if rc is None or (rc != 0 and not reachable):
        reason = (stderr or stdout or "Could not reach user systemd.").strip()[:500]
        if "failed to connect" in blob or "not defined" in blob:
            reason = "Could not connect to the user systemd manager."
        return {
            "ok": True,
            "available": False,
            "reachable": False,
            "authorized": False,
            "reason": reason,
            "errorCode": "SESSION_BRIDGE_UNAVAILABLE",
            "exitCode": rc,
            "elapsedMs": int((time.monotonic() - started) * 1000),
        }
    authorized = rc == 0
    if authorized:
        reason = "User systemd helper is authorized for system Flatpak actions."
        error_code = None
    elif "auth_admin" in blob or rc == 2:
        reason = "System Flatpak authorization is not available in this session."
        error_code = "SESSION_BRIDGE_UNAUTHORIZED"
    else:
        reason = (stderr or stdout or "System Flatpak authorization failed.").strip()[:500]
        error_code = "SESSION_BRIDGE_UNAUTHORIZED"
    return {
        "ok": True,
        "available": authorized,
        "reachable": True,
        "authorized": authorized,
        "reason": reason,
        "errorCode": error_code,
        "exitCode": rc,
        "elapsedMs": int((time.monotonic() - started) * 1000),
    }


async def probe_capability(*, force: bool = False) -> dict[str, Any]:
    """Non-mutating capability probe. Never blocks plugin load callers with exceptions."""
    global _capability_cache
    async with _capability_lock:
        if _capability_cache is not None and not force:
            return dict(_capability_cache)
        try:
            result = await _run_probe()
        except Exception as exc:  # noqa: BLE001 - capability failure must not raise
            result = {
                "ok": True,
                "available": False,
                "reachable": False,
                "authorized": False,
                "reason": f"{type(exc).__name__}: {exc}",
                "errorCode": "SESSION_BRIDGE_UNAVAILABLE",
            }
        _capability_cache = result
        return dict(result)


def invalidate_capability_cache() -> None:
    global _capability_cache
    _capability_cache = None
