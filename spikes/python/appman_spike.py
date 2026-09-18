"""Read-only APPMAN-CONTRACT diagnostic. Not a production provider.

Does not install, remove, or update applications. Mutation facts from the
host shell belong in spikes/results, not in this RPC.
"""

from __future__ import annotations

import asyncio
import os
import time
from typing import Any

import decky

from deckdepot.diagnostics import log_info, persist_snapshot
from deckdepot.flatpak_engine import sanitized_host_env

SNAPSHOT = "p0-appman-contract.json"
READ_TIMEOUT_SEC = 25


def _now_ms() -> int:
    return int(time.time() * 1000)


def _clip(text: str, limit: int = 2500) -> str:
    text = text or ""
    if len(text) <= limit:
        return text
    return text[:limit] + "\n…[truncated]"


def _user_home() -> str:
    return str(getattr(decky, "DECKY_USER_HOME", None) or os.environ.get("HOME") or "")


def _candidate_binaries(user_home: str) -> list[str]:
    names = ("appman", "am")
    dirs = [
        os.path.join(user_home, ".local", "bin"),
        os.path.join(user_home, "bin"),
        "/usr/local/bin",
        "/usr/bin",
    ]
    found: list[str] = []
    seen: set[str] = set()
    path_dirs = (os.environ.get("PATH") or "").split(":")
    for directory in [*path_dirs, *dirs]:
        if not directory:
            continue
        for name in names:
            path = os.path.join(directory, name)
            if path in seen or not os.path.isfile(path) or not os.access(path, os.X_OK):
                continue
            seen.add(path)
            found.append(path)
    return found


def _prefer_appman(paths: list[str]) -> str | None:
    for path in paths:
        if os.path.basename(path) == "appman":
            return path
    return paths[0] if paths else None


async def _run(binary: str, args: list[str], timeout_sec: int) -> dict[str, Any]:
    env = sanitized_host_env()
    env["LC_ALL"] = "C.UTF-8"
    env["LANG"] = "C.UTF-8"
    started = time.monotonic()
    proc = await asyncio.create_subprocess_exec(
        binary,
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
        start_new_session=True,
    )
    timed_out = False
    try:
        stdout_b, stderr_b = await asyncio.wait_for(
            proc.communicate(), timeout=timeout_sec
        )
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
        "argv": [binary, *args],
        "exitCode": proc.returncode,
        "timedOut": timed_out,
        "stdout": _clip(stdout_b.decode("utf-8", "replace")),
        "stderr": _clip(stderr_b.decode("utf-8", "replace")),
        "elapsedMs": int((time.monotonic() - started) * 1000),
        "pid": proc.pid,
    }


def _config_info(user_home: str) -> dict[str, Any]:
    config_home = os.environ.get("XDG_CONFIG_HOME") or os.path.join(user_home, ".config")
    path = os.path.join(config_home, "appman", "appman-config")
    if not os.path.isfile(path):
        return {"present": False, "path": path, "location": None}
    try:
        with open(path, encoding="utf-8") as handle:
            location = handle.read().strip()
    except OSError as exc:
        return {
            "present": True,
            "path": path,
            "location": None,
            "errorType": type(exc).__name__,
        }
    return {
        "present": True,
        "path": path,
        "location": location,
        "locationIsOpt": location == "/opt" or location.startswith("/opt/"),
        "locationWritable": os.access(location, os.W_OK) if location else False,
    }


def _share_info(user_home: str) -> dict[str, Any]:
    share = os.path.join(user_home, ".local", "share", "AM")
    names: list[str] = []
    if os.path.isdir(share):
        try:
            names = sorted(os.listdir(share))[:40]
        except OSError:
            names = []
    return {"path": share, "present": os.path.isdir(share), "entries": names}


async def run_appman_contract_spike(backend_instance_id: str) -> dict[str, Any]:
    log_info("appman-contract spike start")
    user_home = _user_home()
    candidates = _candidate_binaries(user_home)
    binary = _prefer_appman(candidates)
    commands: dict[str, Any] = {}
    if binary:
        commands = {
            "version": await _run(binary, ["-v"], 8),
            "helpHead": await _run(binary, ["-h"], READ_TIMEOUT_SEC),
            "filesLess": await _run(binary, ["-f", "--less"], READ_TIMEOUT_SEC),
            "filesByName": await _run(binary, ["-f", "--byname"], READ_TIMEOUT_SEC),
            "querySample": await _run(binary, ["-q", "sample"], READ_TIMEOUT_SEC),
            "queryEmpty": await _run(
                binary, ["-q", "zzzzznotarealapp12345"], READ_TIMEOUT_SEC
            ),
            "aboutMissing": await _run(
                binary, ["-a", "zzzzznotarealapp12345"], READ_TIMEOUT_SEC
            ),
            "unknownOptionJson": await _run(binary, ["--json"], 8),
        }

    payload = {
        "spike": "appman-contract",
        "backendInstanceId": backend_instance_id,
        "collectedAtMs": _now_ms(),
        "pid": os.getpid(),
        "userHome": user_home,
        "pluginLoaderPath": os.environ.get("PATH"),
        "candidates": candidates,
        "selectedBinary": binary,
        "preferAppmanOverAm": True,
        "config": _config_info(user_home),
        "share": _share_info(user_home),
        "commands": commands,
        "mutations": "not_run_in_plugin",
        "observations": {
            "detect": "user-installed ~/.local/bin/appman even if PluginLoader PATH omits it; prepend ~/.local/bin to child PATH to avoid AppMan warning; do not use privileged am /opt",
            "versionFlag": "-v / --version / version",
            "search": "appman -q {keyword}; empty hits still exit 0",
            "installedList": "appman -f / -f --byname; count only via -f --less",
            "availableList": "appman -l is mixed installed+available; --all for full catalog",
            "machineReadable": "no --json; unknown --json still exit 0",
            "exitCodes": "errors often exit 0; parse stdout text, do not trust rc",
            "install": "appman -i {name}; appman -y -i {name} for noninteractive yes",
            "remove": "help says -r confirms and -R does not; headless -r can still remove",
            "update": "appman -u / appman -u {name}",
            "cancel": "no documented cancel API; process-group SIGTERM only",
            "location": "~/.config/appman/appman-config; appman_location= only if file absent",
            "desktopFiles": "AppMan writes ~/.local/share/applications and ~/.local/bin links; not DeckDepot Launch",
            "arch": "uname -m, amd64 mapped to x86_64; lists under ~/.local/share/AM/x86_64-*",
            "thirdParty": "-e user/project; install flags --busybox --python --appbundle --soarpkg --coreutilsh",
            "trust": "downloads install scripts from GitHub AM database; checksum can abort",
            "pinning": "do not vendor; detect user-installed AppMan",
            "categories": "no catalog category field; AppMan TYPE is format; PLA website cats are regex not AppMan API; do not add AppMan-specific category UI; map into DeckDepot slugs only if a later source is reliable",
        },
    }
    persist_snapshot(SNAPSHOT, payload)
    log_info(
        "appman-contract spike done binary=%s filesLess=%s"
        % (
            binary,
            (commands.get("filesLess") or {}).get("stdout"),
        )
    )
    return payload
