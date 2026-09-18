#!/usr/bin/env python3
"""Temporary session-bridge child. Prints one JSON object to stdout. Not production."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys

ACTIONS = (
    "org.freedesktop.Flatpak.app-install",
    "org.freedesktop.Flatpak.app-update",
    "org.freedesktop.Flatpak.app-uninstall",
)

ID_BIN = "/usr/bin/id"
PKCHECK_BIN = "/usr/bin/pkcheck"
LOGINCTL_BIN = "/usr/bin/loginctl"
PGREP_BIN = "/usr/bin/pgrep"


def _read(path: str) -> str | None:
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            return handle.read().strip()
    except OSError:
        return None


def _child_env() -> dict[str, str]:
    runtime = os.environ.get("XDG_RUNTIME_DIR", "")
    return {
        "PATH": "/usr/bin:/bin",
        "HOME": os.environ.get("HOME", ""),
        "USER": os.environ.get("USER", ""),
        "LOGNAME": os.environ.get("LOGNAME") or os.environ.get("USER", ""),
        "XDG_RUNTIME_DIR": runtime,
        "DBUS_SESSION_BUS_ADDRESS": os.environ.get("DBUS_SESSION_BUS_ADDRESS")
        or (f"unix:path={runtime}/bus" if runtime else ""),
        "LANG": os.environ.get("LANG") or "C.UTF-8",
        "LC_ALL": "C",
    }


def _run(argv: list[str], timeout: float = 12) -> dict:
    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=_child_env(),
        )
        return {
            "argv": argv,
            "rc": proc.returncode,
            "stdout": (proc.stdout or "").strip(),
            "stderr": (proc.stderr or "").strip(),
            "timedOut": False,
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "argv": argv,
            "rc": None,
            "stdout": (exc.stdout or "") if isinstance(exc.stdout, str) else "",
            "stderr": ((exc.stderr or "") if isinstance(exc.stderr, str) else "")
            + "\ntimeout",
            "timedOut": True,
        }
    except Exception as exc:  # noqa: BLE001
        return {"argv": argv, "rc": None, "error": f"{type(exc).__name__}: {exc}"}


def _pkcheck(pid: int, action: str) -> dict:
    result = _run([PKCHECK_BIN, "--action-id", action, "--process", str(pid)])
    blob = f"{result.get('stdout') or ''}\n{result.get('stderr') or ''}".lower()
    rc = result.get("rc")
    if rc == 0:
        authorization = "yes"
        agent_required = False
    elif "auth_admin" in blob or rc == 2:
        authorization = "auth_admin"
        agent_required = True
    elif rc not in (0, None):
        authorization = "denied_or_error"
        agent_required = "unknown"
    else:
        authorization = "unknown"
        agent_required = "unknown"
    return {
        "actionId": action,
        "rc": rc,
        "stdout": result.get("stdout"),
        "stderr": result.get("stderr"),
        "authorization": authorization,
        "authenticationAgentRequired": agent_required,
        "timedOut": result.get("timedOut"),
    }


def _session_properties(sessionid: str) -> dict:
    return _run(
        [
            LOGINCTL_BIN,
            "show-session",
            sessionid,
            "-p",
            "Id",
            "-p",
            "User",
            "-p",
            "Name",
            "-p",
            "Seat",
            "-p",
            "Display",
            "-p",
            "Type",
            "-p",
            "Class",
            "-p",
            "Desktop",
            "-p",
            "Remote",
            "-p",
            "Active",
            "-p",
            "State",
            "-p",
            "TTY",
            "-p",
            "Leader",
            "-p",
            "Service",
            "-p",
            "Scope",
        ]
    )


def _parse_props(text: str) -> dict[str, str]:
    props: dict[str, str] = {}
    for line in (text or "").splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            props[key] = value
    return props


def _detect_gaming_mode(sessions: list[dict], processes: dict) -> dict:
    graphical = []
    for item in sessions:
        props = item.get("properties") or {}
        if props.get("Class") != "user":
            continue
        graphical.append(props)
    active = [p for p in graphical if p.get("Active") == "yes"]
    desktop = " ".join(
        f"{p.get('Id','')}:{p.get('Desktop','')}:{p.get('Type','')}:{p.get('Service','')}"
        for p in active
    ).lower()
    gamescope_proc = bool(processes.get("gamescope", {}).get("stdout"))
    plasma_proc = bool(processes.get("startplasma", {}).get("stdout"))
    gamescope_session = any(
        token in desktop
        for token in ("gamescope", "game-mode", "ogui", "steam")
    ) and "kde" not in desktop and "plasma" not in desktop
    # SteamOS game mode: active seat session is gamescope, not KDE/Plasma.
    if any(
        "gamescope" in (p.get("Desktop") or "").lower()
        or "gamescope" in (p.get("Service") or "").lower()
        for p in active
    ):
        mode = "gaming"
        reason = "active logind user session desktop/service is gamescope"
    elif gamescope_proc and not plasma_proc and not any(
        "plasma" in (p.get("Desktop") or "").lower() or "kde" in (p.get("Desktop") or "").lower()
        for p in active
    ):
        mode = "gaming"
        reason = "gamescope process present; no Plasma session/process"
    elif any(
        "plasma" in (p.get("Desktop") or "").lower() or "kde" in (p.get("Desktop") or "").lower()
        for p in active
    ):
        mode = "desktop"
        reason = "active logind user session is Plasma/KDE"
    else:
        mode = "unknown"
        reason = "could not classify active graphical session"
        if gamescope_session:
            mode = "gaming"
            reason = "active session names look like gamescope/steam game mode"
    return {
        "classification": mode,
        "reason": reason,
        "gamescopeProcess": gamescope_proc,
        "plasmaProcess": plasma_proc,
        "activeUserSessions": active,
    }


def capture_identity() -> dict:
    pid = os.getpid()
    sessionid = _read(f"/proc/{pid}/sessionid")
    listed = _run([LOGINCTL_BIN, "list-sessions", "--no-legend", "--no-pager"])
    sessions: list[dict] = []
    if listed.get("rc") == 0:
        for line in (listed.get("stdout") or "").splitlines():
            parts = line.split()
            if not parts or not parts[0].isdigit():
                continue
            sid = parts[0]
            shown = _session_properties(sid)
            sessions.append(
                {
                    "id": sid,
                    "listLine": line,
                    "loginctl": shown,
                    "properties": _parse_props(shown.get("stdout") or ""),
                }
            )
    kernel_session = None
    if sessionid and sessionid.isdigit():
        shown = _session_properties(sessionid)
        kernel_session = {
            "sessionid": sessionid,
            "loginctl": shown,
            "properties": _parse_props(shown.get("stdout") or ""),
        }
    bus = os.environ.get("DBUS_SESSION_BUS_ADDRESS", "")
    bus_ok = False
    bus_path = None
    if bus.startswith("unix:path="):
        bus_path = bus.split("=", 1)[1].split(",")[0]
        bus_ok = os.path.exists(bus_path)
    processes = {
        "gamescope": _run([PGREP_BIN, "-a", "gamescope"]),
        "startplasma": _run([PGREP_BIN, "-af", "startplasma"]),
    }
    payload = {
        "kind": "session-bridge-child",
        "pid": pid,
        "ppid": os.getppid(),
        "uid": os.getuid(),
        "euid": os.geteuid(),
        "gid": os.getgid(),
        "id": _run([ID_BIN]),
        "loginuid": _read(f"/proc/{pid}/loginuid"),
        "cgroup": _read(f"/proc/{pid}/cgroup"),
        "statusGroups": None,
        "kernelSession": kernel_session,
        "loginctlSessions": listed,
        "sessions": sessions,
        "gamingMode": _detect_gaming_mode(sessions, processes),
        "processes": processes,
        "env": {
            key: os.environ.get(key)
            for key in (
                "XDG_SESSION_ID",
                "XDG_RUNTIME_DIR",
                "XDG_SESSION_TYPE",
                "XDG_SEAT",
                "DBUS_SESSION_BUS_ADDRESS",
                "DISPLAY",
                "WAYLAND_DISPLAY",
                "XDG_CURRENT_DESKTOP",
                "DESKTOP_SESSION",
                "LD_LIBRARY_PATH",
            )
        },
        "childEnvUsed": _child_env(),
        "sessionBusPath": bus_path,
        "sessionBusSocketExists": bus_ok,
        "hostname": socket.gethostname(),
        "pkcheck": [_pkcheck(pid, action) for action in ACTIONS],
    }
    status = _read(f"/proc/{pid}/status") or ""
    for line in status.splitlines():
        if line.startswith("Groups:"):
            payload["statusGroups"] = line
            break
    return payload


def main(argv: list[str]) -> int:
    payload = capture_identity()
    if len(argv) >= 2 and argv[1] == "exec":
        try:
            sep = argv.index("--")
            timeout = float(argv[2]) if sep > 2 else 120
            command = argv[sep + 1 :]
        except (ValueError, IndexError):
            payload["exec"] = {"error": "usage: exec [timeout] -- argv..."}
            json.dump(payload, sys.stdout, indent=2, sort_keys=True)
            sys.stdout.write("\n")
            return 2
        payload["exec"] = _run(command, timeout=timeout)
    json.dump(payload, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
