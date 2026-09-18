"""Temporary PluginLoader → systemd-run --user Gaming Mode session-bridge probe.

Isolated. Removable. Not a production mutation path.
"""

from __future__ import annotations

import json
import os
import pwd
import time
from typing import Any

ACTIONS = (
    "org.freedesktop.Flatpak.app-install",
    "org.freedesktop.Flatpak.app-update",
    "org.freedesktop.Flatpak.app-uninstall",
)

PROBE_UNIT = "deckdepot-session-bridge-spike.service"
MUTATE_UNIT = "deckdepot-session-bridge-mutate.service"
SNAPSHOT = "session-bridge-gaming.json"
TEST_APP_ID = "org.kde.kcharselect"
TEST_REMOTE = "flathub"

SYSTEMD_RUN = "/usr/bin/systemd-run"
PYTHON = "/usr/bin/python3"
FLATPAK = "/usr/bin/flatpak"
PKCHECK = "/usr/bin/pkcheck"
ID_BIN = "/usr/bin/id"
LOGINCTL = "/usr/bin/loginctl"
SYSTEMCTL = "/usr/bin/systemctl"


def _read(path: str) -> str | None:
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            return handle.read().strip()
    except OSError:
        return None


def _uid() -> int:
    try:
        import decky

        home = getattr(decky, "DECKY_USER_HOME", None)
        if home:
            return pwd.getpwnam(os.path.basename(os.path.realpath(home))).pw_uid
    except Exception:
        pass
    return os.getuid()


def _runtime_dir(uid: int) -> str:
    return f"/run/user/{uid}"


def _bridge_env(uid: int) -> dict[str, str]:
    runtime = _runtime_dir(uid)
    pw = pwd.getpwuid(uid)
    return {
        "HOME": pw.pw_dir,
        "USER": pw.pw_name,
        "LOGNAME": pw.pw_name,
        "PATH": "/usr/bin:/bin",
        "XDG_RUNTIME_DIR": runtime,
        "DBUS_SESSION_BUS_ADDRESS": f"unix:path={runtime}/bus",
        "LANG": "C.UTF-8",
        "LC_ALL": "C",
    }


def _host_env() -> dict[str, str]:
    """Sanitized env for host binaries invoked directly from PluginLoader."""
    uid = _uid()
    env = _bridge_env(uid)
    # Direct host tools should not inherit PluginLoader/PyInstaller library paths.
    return env


def _run(
    argv: list[str],
    env: dict[str, str] | None = None,
    timeout: float = 20,
) -> dict[str, Any]:
    import subprocess

    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env if env is not None else _host_env(),
        )
        return {
            "argv": argv,
            "rc": proc.returncode,
            "stdout": proc.stdout or "",
            "stderr": proc.stderr or "",
            "timedOut": False,
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "argv": argv,
            "rc": None,
            "stdout": exc.stdout or "",
            "stderr": (exc.stderr or "") + "\ntimeout",
            "timedOut": True,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "argv": argv,
            "rc": None,
            "stdout": "",
            "stderr": f"{type(exc).__name__}: {exc}",
            "timedOut": False,
        }


def _pkcheck(pid: int, action: str) -> dict[str, Any]:
    result = _run([PKCHECK, "--action-id", action, "--process", str(pid)])
    blob = f"{result.get('stdout') or ''}\n{result.get('stderr') or ''}".lower()
    rc = result.get("rc")
    if rc == 0:
        authorization = "yes"
        agent_required = False
    elif "auth_admin" in blob or rc == 2:
        authorization = "auth_admin"
        agent_required = True
    else:
        authorization = "denied_or_error"
        agent_required = "unknown"
    return {
        "actionId": action,
        "rc": rc,
        "stdout": (result.get("stdout") or "").strip(),
        "stderr": (result.get("stderr") or "").strip(),
        "authorization": authorization,
        "authenticationAgentRequired": agent_required,
        "timedOut": result.get("timedOut"),
    }


def capture_self(label: str) -> dict[str, Any]:
    pid = os.getpid()
    sessionid = _read(f"/proc/{pid}/sessionid")
    groups = None
    status = _read(f"/proc/{pid}/status") or ""
    for line in status.splitlines():
        if line.startswith("Groups:"):
            groups = line
            break
    return {
        "label": label,
        "pid": pid,
        "ppid": os.getppid(),
        "uid": os.getuid(),
        "euid": os.geteuid(),
        "gid": os.getgid(),
        "loginuid": _read(f"/proc/{pid}/loginuid"),
        "sessionid": sessionid,
        "cgroup": _read(f"/proc/{pid}/cgroup"),
        "statusGroups": groups,
        "id": _run([ID_BIN]),
        "inheritedLibraryPaths": {
            key: os.environ.get(key)
            for key in (
                "LD_LIBRARY_PATH",
                "LD_PRELOAD",
                "PYTHONPATH",
                "GI_TYPELIB_PATH",
            )
        },
        "env": {
            key: os.environ.get(key)
            for key in (
                "HOME",
                "USER",
                "XDG_RUNTIME_DIR",
                "XDG_SESSION_ID",
                "DBUS_SESSION_BUS_ADDRESS",
                "DECKY_USER_HOME",
                "LD_LIBRARY_PATH",
            )
        },
        "pkcheck": [_pkcheck(pid, action) for action in ACTIONS],
    }


def _parse_child_json(stdout: str) -> dict[str, Any] | None:
    text = (stdout or "").strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                return None
        return None


def _child_script(plugin_dir: str) -> str:
    candidates = (
        os.path.join(plugin_dir, "session_bridge_child.py"),
        os.path.join(plugin_dir, "py_modules", "deckdepot", "session_bridge_child.py"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "session_bridge_child.py"),
    )
    for path in candidates:
        if os.path.isfile(path):
            return path
    return candidates[0]


def _systemd_run_argv(unit: str, extra: list[str]) -> list[str]:
    return [
        SYSTEMD_RUN,
        "--user",
        "--collect",
        "--wait",
        "--pipe",
        "--quiet",
        f"--unit={unit}",
        "--",
        *extra,
    ]


def _helper_authorized(helper: dict[str, Any] | None) -> bool:
    if not helper:
        return False
    checks = helper.get("pkcheck") or []
    if len(checks) < 3:
        return False
    return all(item.get("authorization") == "yes" and item.get("rc") == 0 for item in checks)


def _is_gaming_mode(helper: dict[str, Any] | None) -> dict[str, Any]:
    if not helper:
        return {"classification": "unknown", "reason": "no helper payload"}
    detected = helper.get("gamingMode") or {}
    classification = detected.get("classification") or "unknown"
    return {
        "classification": classification,
        "reason": detected.get("reason"),
        "active": classification == "gaming",
        "details": detected,
    }


def _app_in_list(stdout: str, app_id: str) -> bool:
    for line in (stdout or "").splitlines():
        if line.strip() == app_id:
            return True
        if line.split("\t", 1)[0].strip() == app_id:
            return True
    return False


def _inventory() -> dict[str, Any]:
    listed = _run(
        [FLATPAK, "--system", "list", "--app", f"--columns=application"],
        timeout=30,
    )
    present = _app_in_list(listed.get("stdout") or "", TEST_APP_ID)
    info = _run([FLATPAK, "--system", "info", TEST_APP_ID], timeout=20)
    return {
        "list": listed,
        "appId": TEST_APP_ID,
        "present": present,
        "infoRc": info.get("rc"),
        "infoStderr": (info.get("stderr") or "").strip()[:500],
    }


def _write_snapshot(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        import decky

        runtime = getattr(decky, "DECKY_PLUGIN_RUNTIME_DIR", None)
        if runtime:
            os.makedirs(runtime, exist_ok=True)
            path = os.path.join(runtime, SNAPSHOT)
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, indent=2, sort_keys=True)
                handle.write("\n")
            payload["snapshotPath"] = path
            # Also copy a stable companion name for the Desktop-origin file.
            companion = os.path.join(runtime, "session-bridge-from-plugin.json")
            with open(companion, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, indent=2, sort_keys=True)
                handle.write("\n")
            payload["companionSnapshotPath"] = companion
    except Exception as exc:  # noqa: BLE001
        payload["snapshotError"] = f"{type(exc).__name__}: {exc}"
    return payload


def run_session_bridge_spike(plugin_dir: str, mutate: bool = False) -> dict[str, Any]:
    started = time.time()
    uid = _uid()
    child = _child_script(plugin_dir)
    bridge_env = _bridge_env(uid)
    backend = capture_self("deckdepot-backend")
    probe_argv = _systemd_run_argv(PROBE_UNIT, [PYTHON, child])
    command = _run(probe_argv, env=bridge_env, timeout=40)
    helper = _parse_child_json(command.get("stdout") or "")
    gaming = _is_gaming_mode(helper)
    authorized = _helper_authorized(helper)
    linger = _run(
        [LOGINCTL, "show-user", str(uid), "-p", "Linger", "-p", "State", "-p", "Sessions"]
    )
    sessions = _run([LOGINCTL, "list-sessions", "--no-legend", "--no-pager"])
    user_unit = _run(
        [
            SYSTEMCTL,
            "show",
            f"user@{uid}.service",
            "-p",
            "ActiveState",
            "-p",
            "SubState",
            "-p",
            "WantedBy",
            "-p",
            "ActiveEnterTimestamp",
        ]
    )
    runtime = _runtime_dir(uid)
    payload: dict[str, Any] = {
        "kind": "session-bridge-gaming",
        "collectedAtMs": int(time.time() * 1000),
        "elapsedMs": int((time.time() - started) * 1000),
        "pluginDir": plugin_dir,
        "childScriptExists": os.path.isfile(child),
        "childScript": child,
        "bridgeClientEnv": bridge_env,
        "runtimeDirExists": os.path.isdir(runtime),
        "userBusExists": os.path.exists(os.path.join(runtime, "bus")),
        "systemdRunArgv": probe_argv,
        "systemdRun": {
            "rc": command.get("rc"),
            "timedOut": command.get("timedOut"),
            "stdout": command.get("stdout"),
            "stderr": command.get("stderr"),
        },
        "backend": backend,
        "helper": helper,
        "gamingMode": gaming,
        "helperAuthorized": authorized,
        "loginctlUser": linger,
        "loginctlSessions": sessions,
        "userSystemdUnit": user_unit,
        "mutateRequested": bool(mutate),
        "testAppId": TEST_APP_ID,
    }

    failure = None
    if command.get("rc") not in (0,) or command.get("timedOut"):
        failure = {
            "where": "systemd-run --user probe",
            "class": "inability_to_reach_user_systemd"
            if "Failed to connect" in (command.get("stderr") or "")
            or "not defined" in (command.get("stderr") or "")
            else "environment_or_exec_failure",
            "stderr": command.get("stderr"),
        }
    elif not helper:
        failure = {
            "where": "helper stdout parse",
            "class": "environment_or_exec_failure",
        }
    elif not authorized:
        groups = (helper.get("id") or {}).get("stdout") or ""
        if "wheel" not in groups:
            klass = "missing_groups"
        elif (helper.get("gamingMode") or {}).get("classification") == "desktop":
            klass = "bad_session_classification"
        else:
            klass = "polkit_auth_failure"
        failure = {
            "where": "helper pkcheck",
            "class": klass,
            "pkcheck": helper.get("pkcheck"),
        }

    mutation: dict[str, Any] = {"performed": False}
    if mutate and not failure and authorized and gaming.get("active"):
        before = _inventory()
        mutation["before"] = before
        if before.get("present"):
            mutation["skipped"] = True
            mutation["reason"] = "test app already installed at system scope"
        else:
            install_argv = _systemd_run_argv(
                MUTATE_UNIT,
                [
                    PYTHON,
                    child,
                    "exec",
                    "240",
                    "--",
                    FLATPAK,
                    "--system",
                    "-y",
                    "--noninteractive",
                    "install",
                    TEST_REMOTE,
                    TEST_APP_ID,
                ],
            )
            install = _run(install_argv, env=bridge_env, timeout=260)
            install_helper = _parse_child_json(install.get("stdout") or "")
            after_install = _inventory()
            mutation["install"] = {
                "argv": install_argv,
                "rc": install.get("rc"),
                "timedOut": install.get("timedOut"),
                "stderr": install.get("stderr"),
                "exec": (install_helper or {}).get("exec"),
                "inventory": after_install,
                "verifiedPresent": bool(after_install.get("present")),
            }
            remove_argv = _systemd_run_argv(
                MUTATE_UNIT,
                [
                    PYTHON,
                    child,
                    "exec",
                    "120",
                    "--",
                    FLATPAK,
                    "--system",
                    "-y",
                    "--noninteractive",
                    "uninstall",
                    TEST_APP_ID,
                ],
            )
            remove = _run(remove_argv, env=bridge_env, timeout=140)
            remove_helper = _parse_child_json(remove.get("stdout") or "")
            after_remove = _inventory()
            mutation["remove"] = {
                "argv": remove_argv,
                "rc": remove.get("rc"),
                "timedOut": remove.get("timedOut"),
                "stderr": remove.get("stderr"),
                "exec": (remove_helper or {}).get("exec"),
                "inventory": after_remove,
                "verifiedGone": not bool(after_remove.get("present")),
            }
            mutation["performed"] = True
            mutation["success"] = bool(
                after_install.get("present") and not after_remove.get("present")
            )
            if not mutation["success"]:
                failure = {
                    "where": "mutation cycle",
                    "class": "mutation_failure_after_authorization",
                    "installPresent": after_install.get("present"),
                    "removedGone": not after_remove.get("present"),
                }
            if after_remove.get("present") and after_install.get("present"):
                # Best-effort restore through the same bridge.
                _run(remove_argv, env=bridge_env, timeout=140)
                mutation["restoreRetry"] = _inventory()
    elif mutate:
        mutation["skipped"] = True
        if not gaming.get("active"):
            mutation["reason"] = "not_gaming_mode"
        elif not authorized:
            mutation["reason"] = "not_authorized"
        else:
            mutation["reason"] = "probe_failed"
        mutation["gamingMode"] = gaming
        mutation["helperAuthorized"] = authorized

    payload["mutation"] = mutation
    payload["failure"] = failure
    payload["elapsedMs"] = int((time.time() - started) * 1000)
    return _write_snapshot(payload)
