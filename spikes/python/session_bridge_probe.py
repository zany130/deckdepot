#!/usr/bin/env python3
"""Isolated session-bridge probe. Prints subject facts and pkcheck of this PID."""

from __future__ import annotations

import os
import subprocess
import sys
import time

ACTIONS = (
    "org.freedesktop.Flatpak.app-install",
    "org.freedesktop.Flatpak.app-update",
    "org.freedesktop.Flatpak.app-uninstall",
)


def read(path: str) -> str:
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            return handle.read().strip()
    except OSError as exc:
        return f"error:{exc}"


def main() -> int:
    hold = 0.0
    if len(sys.argv) > 1:
        hold = float(sys.argv[1])
    pid = os.getpid()
    print(f"pid={pid}")
    print(f"ppid={os.getppid()}")
    print(f"uid={os.getuid()} euid={os.geteuid()} gid={os.getgid()}")
    try:
        print("id=" + subprocess.check_output(["id"], text=True).strip())
    except Exception as exc:  # noqa: BLE001
        print(f"id_error={exc}")
    print(f"loginuid={read(f'/proc/{pid}/loginuid')}")
    print(f"sessionid={read(f'/proc/{pid}/sessionid')}")
    print(f"cgroup={read(f'/proc/{pid}/cgroup').replace(chr(10), '|')}")
    status = read(f"/proc/{pid}/status")
    for line in status.splitlines():
        if line.startswith(("Uid:", "Gid:", "Groups:", "NStgid:")):
            print(line)
    for key in (
        "XDG_SESSION_ID",
        "XDG_RUNTIME_DIR",
        "XDG_SESSION_TYPE",
        "XDG_SEAT",
        "DBUS_SESSION_BUS_ADDRESS",
        "DISPLAY",
        "WAYLAND_DISPLAY",
    ):
        if key in os.environ:
            print(f"env.{key}={os.environ[key]}")
    for action in ACTIONS:
        proc = subprocess.run(
            ["pkcheck", "--action-id", action, "--process", str(pid)],
            capture_output=True,
            text=True,
        )
        out = (proc.stdout + proc.stderr).strip().replace("\n", " | ")
        print(f"pkcheck {action} rc={proc.returncode} out={out}")
    if hold > 0:
        time.sleep(hold)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
