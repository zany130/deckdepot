"""One-shot diagnostic: system-scoped Flatpak from the live Decky backend.

Not production code. Does not change the M1 user-scoped engine.
"""

from __future__ import annotations

import asyncio
import os
import pwd
import shutil
import time
from typing import Any

import decky

from deckdepot.diagnostics import log_info, persist_snapshot
from deckdepot.flatpak_engine import sanitized_host_env

TEST_APP_ID = "org.kde.kcharselect"
SNAPSHOT = "p0-system-scope.json"
IMPORTANT_UPDATE_PREFIXES = (
    "com.heroicgameslauncher.",
    "com.unity.",
    "com.discordapp.",
    "com.valvesoftware.",
    "org.mozilla.",
    "com.google.",
)
READ_TIMEOUT_SEC = 30
MUTATION_TIMEOUT_SEC = 90


def _now_ms() -> int:
    return int(time.time() * 1000)


def _clip(text: str, limit: int = 1500) -> str:
    text = text or ""
    if len(text) <= limit:
        return text
    return text[:limit] + "\n…[truncated]"


def _infer_auth(command: dict[str, Any]) -> dict[str, Any]:
    blob = f"{command.get('stderr') or ''}\n{command.get('stdout') or ''}".lower()
    timed_out = bool(command.get("timedOut"))
    exit_code = command.get("exitCode")
    polkitish = any(
        token in blob
        for token in (
            "policykit",
            "polkit",
            "org.freedesktop.policykit",
            "not authorized",
            "authentication is required",
            "authentication failed",
            "gd.bus.error",
            "gdbus.Error".lower(),
        )
    )
    if timed_out:
        return {
            "polkitInvoked": "unknown",
            "authRequired": "unknown",
            "gamingModeUsable": False,
            "reason": "command timed out; if polkit prompted, Gaming Mode did not complete it",
        }
    if exit_code == 0:
        return {
            "polkitInvoked": "silent_or_none",
            "authRequired": False,
            "gamingModeUsable": "n/a",
            "reason": "succeeded without an interactive authentication prompt completing in this context",
        }
    if polkitish:
        return {
            "polkitInvoked": True,
            "authRequired": True,
            "gamingModeUsable": False,
            "reason": "authorization error in stdout/stderr; no successful interactive auth",
        }
    return {
        "polkitInvoked": "unknown",
        "authRequired": "unknown",
        "gamingModeUsable": False,
        "reason": "non-zero exit without a recognized polkit string",
    }


async def _run(args: list[str], timeout_sec: int) -> dict[str, Any]:
    path = shutil.which("flatpak") or "/usr/bin/flatpak"
    env = sanitized_host_env()
    env["LC_ALL"] = "C.UTF-8"
    env["LANG"] = "C.UTF-8"
    started = time.monotonic()
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
        "stdout": _clip(stdout_b.decode("utf-8", "replace")),
        "stderr": _clip(stderr_b.decode("utf-8", "replace")),
        "elapsedMs": int((time.monotonic() - started) * 1000),
        "pid": proc.pid,
    }


def capture_identity() -> dict[str, Any]:
    uid = os.getuid()
    gid = os.getgid()
    try:
        pw = pwd.getpwuid(uid)
        username = pw.pw_name
    except KeyError:
        username = None
    try:
        loginuid_raw = open("/proc/self/loginuid", "r", encoding="utf-8").read().strip()
        loginuid = int(loginuid_raw) if loginuid_raw else None
    except OSError:
        loginuid = None
    try:
        cgroup = open("/proc/self/cgroup", "r", encoding="utf-8").read().strip()
    except OSError:
        cgroup = None
    decky_names = [
        name
        for name in dir(decky)
        if name.startswith("DECKY_")
        and "KEY" not in name
        and "TOKEN" not in name
        and "SECRET" not in name
    ]
    decky_values = {}
    for name in ("DECKY_USER", "DECKY_USER_HOME", "DECKY_HOME", "DECKY_VERSION"):
        decky_values[name] = getattr(decky, name, None)
    return {
        "osGetuid": uid,
        "osGetgid": gid,
        "usernameFromPwd": username,
        "home": os.environ.get("HOME"),
        "user": os.environ.get("USER"),
        "logname": os.environ.get("LOGNAME"),
        "xdgRuntimeDir": os.environ.get("XDG_RUNTIME_DIR"),
        "xdgSessionId": os.environ.get("XDG_SESSION_ID"),
        "xdgSessionType": os.environ.get("XDG_SESSION_TYPE"),
        "xdgSessionClass": os.environ.get("XDG_SESSION_CLASS"),
        "dbusSessionBusAddressPresent": bool(os.environ.get("DBUS_SESSION_BUS_ADDRESS")),
        "display": os.environ.get("DISPLAY"),
        "waylandDisplay": os.environ.get("WAYLAND_DISPLAY"),
        "loginuid": loginuid,
        "loginuidUnset": loginuid in (None, 0xFFFFFFFF),
        "cgroup": cgroup,
        "pid": os.getpid(),
        "decky": decky_values,
        "deckyAttrNames": decky_names,
        "note": "id/whoami also captured via subprocess below",
    }


async def _capture_id_commands() -> dict[str, Any]:
    results = {}
    for label, argv in (
        ("id", ["id"]),
        ("whoami", ["whoami"]),
    ):
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        results[label] = {
            "exitCode": proc.returncode,
            "stdout": stdout.decode("utf-8", "replace").strip(),
            "stderr": stderr.decode("utf-8", "replace").strip(),
        }
    return results


def _parse_app_ids(stdout: str) -> list[str]:
    ids: list[str] = []
    for line in stdout.splitlines():
        if not line.strip():
            continue
        app_id = line.split("\t", 1)[0].strip()
        if app_id:
            ids.append(app_id)
    return ids


def _safe_update_candidate(app_ids: list[str]) -> str | None:
    for app_id in app_ids:
        if any(app_id.startswith(prefix) for prefix in IMPORTANT_UPDATE_PREFIXES):
            continue
        # Only accept the disposable test app if it happens to have an update.
        if app_id == TEST_APP_ID:
            return app_id
    return None


async def run_system_scope_spike(backend_instance_id: str) -> dict[str, Any]:
    log_info("system-scope spike start")
    identity = capture_identity()
    id_cmds = await _capture_id_commands()
    version = await _run(["--version"], 8)

    list_cmd = await _run(
        ["list", "--system", "--app", "--columns=application,name,origin"],
        READ_TIMEOUT_SEC,
    )
    remotes_cmd = await _run(
        ["remotes", "--system", "--columns=name,title,url,options"],
        READ_TIMEOUT_SEC,
    )
    updates_cmd = await _run(
        [
            "remote-ls",
            "--updates",
            "--system",
            "--app",
            "--columns=application,version,branch,origin,ref",
        ],
        READ_TIMEOUT_SEC,
    )

    installed_ids = _parse_app_ids(list_cmd.get("stdout") or "")
    remote_names = []
    for line in (remotes_cmd.get("stdout") or "").splitlines():
        name = line.split("\t", 1)[0].strip()
        if name:
            remote_names.append(name)
    update_ids = _parse_app_ids(updates_cmd.get("stdout") or "")
    flathub_present = "flathub" in remote_names
    test_already = TEST_APP_ID in installed_ids

    list_result = {
        "command": list_cmd,
        "auth": _infer_auth(list_cmd),
        "appCount": len(installed_ids),
        "testAppInstalledBefore": test_already,
    }
    remotes_result = {
        "command": remotes_cmd,
        "auth": _infer_auth(remotes_cmd),
        "remoteNames": remote_names,
        "flathubPresent": flathub_present,
    }

    safe_update = _safe_update_candidate(update_ids)
    if list_cmd.get("exitCode") != 0:
        update_result = {
            "status": "NOT TESTED — LIST FAILED",
            "availableUpdateAppIds": update_ids,
        }
    elif not update_ids:
        update_result = {
            "status": "NOT TESTED — NO SAFE UPDATE AVAILABLE",
            "reason": "remote-ls --updates --system --app returned no application updates",
            "availableUpdateAppIds": [],
        }
    elif safe_update is None:
        update_result = {
            "status": "NOT TESTED — NO SAFE UPDATE AVAILABLE",
            "reason": "updates exist but are for already-installed user apps; not mutated",
            "availableUpdateAppIds": update_ids,
            "auth": _infer_auth(updates_cmd),
            "discoveryCommand": updates_cmd,
        }
    else:
        update_cmd = await _run(
            ["update", "--system", "-y", "--noninteractive", safe_update],
            MUTATION_TIMEOUT_SEC,
        )
        update_result = {
            "status": "TESTED",
            "appId": safe_update,
            "command": update_cmd,
            "auth": _infer_auth(update_cmd),
        }

    install_result: dict[str, Any]
    uninstall_result: dict[str, Any]
    if list_cmd.get("exitCode") != 0:
        install_result = {"status": "NOT TESTED — LIST FAILED"}
        uninstall_result = {"status": "NOT TESTED"}
    elif not flathub_present:
        install_result = {
            "status": "NOT TESTED — NO SYSTEM FLATHUB REMOTE",
            "note": "did not add or modify remotes",
        }
        uninstall_result = {"status": "NOT TESTED"}
    elif test_already:
        install_result = {
            "status": "NOT TESTED — TEST APP ALREADY SYSTEM-INSTALLED",
            "appId": TEST_APP_ID,
        }
        uninstall_result = {"status": "NOT TESTED — WOULD REMOVE PRE-EXISTING APP"}
    else:
        info_cmd = await _run(
            ["remote-info", "--system", "flathub", TEST_APP_ID],
            READ_TIMEOUT_SEC,
        )
        install_cmd = await _run(
            [
                "install",
                "--system",
                "-y",
                "--noninteractive",
                "flathub",
                TEST_APP_ID,
            ],
            MUTATION_TIMEOUT_SEC,
        )
        after_install = await _run(
            ["list", "--system", "--app", "--columns=application"],
            READ_TIMEOUT_SEC,
        )
        after_ids = _parse_app_ids(after_install.get("stdout") or "")
        installed = TEST_APP_ID in after_ids
        install_result = {
            "status": "TESTED",
            "appId": TEST_APP_ID,
            "remoteInfo": info_cmd,
            "command": install_cmd,
            "auth": _infer_auth(install_cmd),
            "presentAfter": installed,
            "listAfter": {
                "exitCode": after_install.get("exitCode"),
                "appCount": len(after_ids),
            },
        }
        if installed:
            uninstall_cmd = await _run(
                ["uninstall", "--system", "-y", "--noninteractive", TEST_APP_ID],
                MUTATION_TIMEOUT_SEC,
            )
            after_uninstall = await _run(
                ["list", "--system", "--app", "--columns=application"],
                READ_TIMEOUT_SEC,
            )
            gone_ids = _parse_app_ids(after_uninstall.get("stdout") or "")
            removed = TEST_APP_ID not in gone_ids
            uninstall_result = {
                "status": "TESTED",
                "appId": TEST_APP_ID,
                "command": uninstall_cmd,
                "auth": _infer_auth(uninstall_cmd),
                "removed": removed,
                "leftover": not removed,
                "listAfter": {
                    "exitCode": after_uninstall.get("exitCode"),
                    "appCount": len(gone_ids),
                },
            }
        else:
            uninstall_result = {
                "status": "NOT TESTED — INSTALL DID NOT SUCCEED",
                "appId": TEST_APP_ID,
            }

    payload = {
        "spike": "system-scope-flatpak",
        "backendInstanceId": backend_instance_id,
        "collectedAtMs": _now_ms(),
        "identity": identity,
        "idCommands": id_cmds,
        "flatpakVersion": version,
        "list": list_result,
        "remotes": remotes_result,
        "updatesDiscovery": {
            "command": updates_cmd,
            "auth": _infer_auth(updates_cmd),
            "appIds": update_ids,
        },
        "update": update_result,
        "install": install_result,
        "uninstall": uninstall_result,
        "constraints": {
            "sudo": False,
            "rootPluginFlag": False,
            "customPolkitRule": False,
            "remoteMutation": False,
            "m1EngineUnchanged": True,
        },
    }
    persist_snapshot(SNAPSHOT, payload)
    log_info(
        "system-scope spike done listExit=%s install=%s uninstall=%s"
        % (
            list_cmd.get("exitCode"),
            install_result.get("status"),
            uninstall_result.get("status"),
        )
    )
    return payload
