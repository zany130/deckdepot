#!/usr/bin/env python3
"""Wait until Gamescope is active, then invoke the DeckDepot session-bridge RPC.

Runs as a user-systemd unit so it can survive a desktop→game-mode switch.
Not production.
"""

from __future__ import annotations

import json
import os
import socket
import struct
import time
import urllib.request

LOGINCTL = "/usr/bin/loginctl"
PGREP = "/usr/bin/pgrep"
STEAMOSCTL = "/usr/bin/steamosctl"
STATUS_PATH = "/home/zany130/homebrew/data/DeckDepot/session-bridge-gaming-orchestrator.json"
SNAPSHOT_PATH = "/home/zany130/homebrew/data/DeckDepot/session-bridge-gaming.json"
REPO_COPY = "/home/zany130/Documents/GitHub/deckdepot/spikes/results/session-bridge-gaming.json"

HOST_ENV = {
    "PATH": "/usr/bin:/bin",
    "HOME": "/home/zany130",
    "USER": "zany130",
    "LOGNAME": "zany130",
    "XDG_RUNTIME_DIR": "/run/user/1000",
    "DBUS_SESSION_BUS_ADDRESS": "unix:path=/run/user/1000/bus",
    "LANG": "C.UTF-8",
    "LC_ALL": "C",
}


def _run(argv: list[str], timeout: float = 8) -> dict:
    import subprocess

    try:
        proc = subprocess.run(
            argv, capture_output=True, text=True, timeout=timeout, env=HOST_ENV
        )
        return {
            "argv": argv,
            "rc": proc.returncode,
            "stdout": proc.stdout or "",
            "stderr": proc.stderr or "",
        }
    except Exception as exc:  # noqa: BLE001
        return {"argv": argv, "rc": None, "stdout": "", "stderr": str(exc)}


def _write(path: str, payload: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")


def gaming_mode_active() -> dict:
    sessions = _run([LOGINCTL, "list-sessions", "--no-legend", "--no-pager"])
    details = []
    active_user = []
    for line in (sessions.get("stdout") or "").splitlines():
        parts = line.split()
        if not parts or not parts[0].isdigit():
            continue
        sid = parts[0]
        shown = _run(
            [
                LOGINCTL,
                "show-session",
                sid,
                "-p",
                "Id",
                "-p",
                "Class",
                "-p",
                "Desktop",
                "-p",
                "Type",
                "-p",
                "Active",
                "-p",
                "Seat",
                "-p",
                "Service",
                "-p",
                "State",
            ]
        )
        props = {}
        for item in (shown.get("stdout") or "").splitlines():
            if "=" in item:
                key, value = item.split("=", 1)
                props[key] = value
        details.append(props)
        if props.get("Class") == "user" and props.get("Active") == "yes":
            active_user.append(props)
    gamescope = _run([PGREP, "-a", "gamescope"])
    plasma = _run([PGREP, "-af", "startplasma"])
    desktop_blob = " ".join(
        f"{p.get('Desktop','')}|{p.get('Service','')}|{p.get('Type','')}"
        for p in active_user
    ).lower()
    gamescope_proc = gamescope.get("rc") == 0 and bool((gamescope.get("stdout") or "").strip())
    plasma_proc = plasma.get("rc") == 0 and bool((plasma.get("stdout") or "").strip())
    if any("gamescope" in (p.get("Desktop") or "").lower() for p in active_user):
        active = True
        reason = "logind desktop=gamescope"
    elif gamescope_proc and not plasma_proc:
        active = True
        reason = "gamescope process without Plasma"
    elif "kde" in desktop_blob or "plasma" in desktop_blob:
        active = False
        reason = "plasma/kde still active"
    else:
        active = False
        reason = "no gamescope session yet"
    return {
        "active": active,
        "reason": reason,
        "sessions": details,
        "gamescope": (gamescope.get("stdout") or "").strip(),
        "plasma": (plasma.get("stdout") or "").strip(),
        "list": sessions.get("stdout"),
    }


def _mask_frame(payload: bytes) -> bytes:
    mask = os.urandom(4)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    header = bytearray([0x81])
    n = len(payload)
    if n < 126:
        header.append(0x80 | n)
    elif n < 65536:
        header.append(0x80 | 126)
        header.extend(struct.pack("!H", n))
    else:
        header.append(0x80 | 127)
        header.extend(struct.pack("!Q", n))
    return bytes(header) + mask + masked


def _read_frames(sock: socket.socket, leftover: bytes):
    data = leftover
    while True:
        while len(data) < 2:
            chunk = sock.recv(4096)
            if not chunk:
                return
            data += chunk
        length = data[1] & 0x7F
        idx = 2
        if length == 126:
            while len(data) < 4:
                data += sock.recv(4096)
            length = struct.unpack("!H", data[2:4])[0]
            idx = 4
        elif length == 127:
            while len(data) < 10:
                data += sock.recv(4096)
            length = struct.unpack("!Q", data[2:10])[0]
            idx = 10
        while len(data) < idx + length:
            data += sock.recv(4096)
        frame = data[idx : idx + length]
        data = data[idx + length :]
        opcode = leftover_op = data and None
        # opcode from original first byte — re-parse from the frame header we already consumed
        yield frame


def call_plugin() -> dict:
    token = urllib.request.urlopen("http://127.0.0.1:1337/auth/token", timeout=5).read().decode().strip()
    key = "dGhlIHNhbXBsZSBub25jZQ=="
    req = (
        f"GET /ws?auth={token} HTTP/1.1\r\n"
        "Host: 127.0.0.1:1337\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        "\r\n"
    ).encode()
    sock = socket.create_connection(("127.0.0.1", 1337), timeout=30)
    sock.sendall(req)
    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = sock.recv(4096)
        if not chunk:
            raise RuntimeError("websocket handshake closed")
        buf += chunk
    header, rest = buf.split(b"\r\n\r\n", 1)
    if b"101" not in header.split(b"\r\n", 1)[0]:
        raise RuntimeError(header.decode(errors="replace"))
    payload = json.dumps(
        {
            "type": 0,
            "id": 9101,
            "route": "loader/call_plugin_method",
            "args": ["DeckDepot", "run_session_bridge_diagnostic", True],
        }
    ).encode()
    sock.sendall(_mask_frame(payload))
    sock.settimeout(300)
    data = rest
    frames = []
    deadline = time.time() + 300
    while time.time() < deadline:
        while len(data) < 2:
            data += sock.recv(4096)
        b1, b2 = data[0], data[1]
        opcode = b1 & 0x0F
        length = b2 & 0x7F
        idx = 2
        if length == 126:
            while len(data) < 4:
                data += sock.recv(4096)
            length = struct.unpack("!H", data[2:4])[0]
            idx = 4
        elif length == 127:
            while len(data) < 10:
                data += sock.recv(4096)
            length = struct.unpack("!Q", data[2:10])[0]
            idx = 10
        while len(data) < idx + length:
            data += sock.recv(4096)
        frame = data[idx : idx + length]
        data = data[idx + length :]
        if opcode == 0x1:
            text = frame.decode()
            frames.append(text)
            parsed = json.loads(text)
            if parsed.get("id") == 9101:
                sock.close()
                return {"ok": True, "tokenPresent": True, "message": parsed}
        elif opcode == 0x8:
            break
    sock.close()
    return {"ok": False, "frames": frames, "error": "no matching reply"}


def restore_desktop() -> dict:
    return _run([STEAMOSCTL, "switch-to-desktop-mode", "plasma.desktop"], timeout=30)


def main() -> int:
    started = time.time()
    status = {
        "kind": "session-bridge-gaming-orchestrator",
        "startedAtMs": int(started * 1000),
        "pid": os.getpid(),
        "ppid": os.getppid(),
        "cgroup": open("/proc/self/cgroup", encoding="utf-8").read().strip(),
    }
    _write(STATUS_PATH, {**status, "phase": "waiting_for_gamescope"})
    detected = None
    for _ in range(90):
        detected = gaming_mode_active()
        status["lastDetection"] = detected
        if detected.get("active"):
            break
        time.sleep(2)
    status["waitedSec"] = int(time.time() - started)
    if not detected or not detected.get("active"):
        status["phase"] = "timeout_waiting_for_gamescope"
        _write(STATUS_PATH, status)
        return 2
    status["phase"] = "calling_plugin"
    _write(STATUS_PATH, status)
    try:
        result = call_plugin()
        status["rpc"] = result
        status["phase"] = "rpc_complete"
    except Exception as exc:  # noqa: BLE001
        status["rpcError"] = f"{type(exc).__name__}: {exc}"
        status["phase"] = "rpc_failed"
    if os.path.isfile(SNAPSHOT_PATH):
        try:
            with open(SNAPSHOT_PATH, encoding="utf-8") as handle:
                snapshot = json.load(handle)
            _write(REPO_COPY, snapshot)
            status["repoCopy"] = REPO_COPY
        except Exception as exc:  # noqa: BLE001
            status["repoCopyError"] = str(exc)
    status["restoreDesktop"] = restore_desktop()
    status["phase"] = "done"
    status["elapsedSec"] = int(time.time() - started)
    _write(STATUS_PATH, status)
    return 0 if status.get("phase") == "done" else 1


if __name__ == "__main__":
    raise SystemExit(main())
