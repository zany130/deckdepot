"""Production user-scoped Flatpak engine.

Uses the P0.5 list contract and P0.4 sanitized child environment.
Does not parse install percentage output.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import signal
import time
from typing import Any

from deckdepot.errors import EngineError
from deckdepot.ids import validate_flatpak_app_id, validate_flatpak_ref

LIST_COLUMNS = (
    "application",
    "name",
    "version",
    "branch",
    "arch",
    "origin",
    "active",
)
LIST_ARGS = (
    "list",
    "--user",
    "--app",
    f"--columns={','.join(LIST_COLUMNS)}",
)
REMOTE_LIST_ARGS = ("remotes", "--user", "--columns=name,title,url")
FLATHUB_REMOTE = "flathub"
FLATHUB_REPO = "https://dl.flathub.org/repo/flathub.flatpakrepo"
UPDATE_ALL_APP_ID = "all-user-apps"
UPDATE_ALL_ARGS = (
    "update",
    "--user",
    "-y",
    "--noninteractive",
    "--app",
)
COMMAND_TIMEOUT_SEC = {
    "list": 30,
    "remotes": 20,
    "remote_info": 30,
    "remote_add": 60,
    "remote_ls": 60,
    "install": 300,
    "update": 300,
    "uninstall": 180,
}


def sanitized_host_env() -> dict[str, str]:
    env = os.environ.copy()
    env.pop("LD_LIBRARY_PATH", None)
    return env


def resolved_flatpak_path() -> str | None:
    return shutil.which("flatpak")


def require_flatpak_path() -> str:
    path = resolved_flatpak_path()
    if not path:
        raise EngineError(
            "FLATPAK_NOT_FOUND",
            "Flatpak is not available on this system.",
        )
    return path


def parse_list_output(stdout: str) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    malformed: list[dict[str, Any]] = []
    for index, raw_line in enumerate(stdout.splitlines()):
        line = raw_line.rstrip("\n")
        if line == "":
            continue
        parts = line.split("\t")
        if len(parts) != len(LIST_COLUMNS):
            malformed.append(
                {
                    "lineIndex": index,
                    "columnCount": len(parts),
                    "expected": len(LIST_COLUMNS),
                }
            )
            continue
        row = dict(zip(LIST_COLUMNS, parts))
        version = row.get("version") or None
        if version == "Latest":
            version = None
        rows.append(
            {
                "provider": "flatpak",
                "appId": row["application"],
                "name": row["name"] or row["application"],
                "summary": None,
                "categories": [],
                "installedState": "installed",
                "installedVersion": version,
                "latestVersion": None,
                "branch": row["branch"],
                "arch": row["arch"],
                "origin": row["origin"],
                "activeCommit": row["active"] or None,
            }
        )
    return {
        "ok": True,
        "apps": rows,
        "malformedCount": len(malformed),
        "malformed": malformed[:20],
    }


async def run_flatpak(
    args: list[str],
    *,
    timeout_sec: int,
    extra_env: dict[str, str] | None = None,
) -> dict[str, Any]:
    path = require_flatpak_path()
    env = sanitized_host_env()
    if extra_env:
        env.update(extra_env)
    started = time.monotonic()
    proc = await asyncio.create_subprocess_exec(
        path,
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
        start_new_session=True,
    )
    try:
        stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=timeout_sec)
    except asyncio.TimeoutError as exc:
        _terminate_group(proc)
        raise EngineError(
            "PROCESS_FAILED",
            "Flatpak command timed out.",
            details={"argv": [path, *args], "timedOut": True},
        ) from exc
    return {
        "argv": [path, *args],
        "exitCode": proc.returncode,
        "stdout": stdout_b.decode("utf-8", "replace"),
        "stderr": stderr_b.decode("utf-8", "replace"),
        "elapsedMs": int((time.monotonic() - started) * 1000),
        "pid": proc.pid,
    }


def _terminate_group(proc: asyncio.subprocess.Process) -> None:
    if proc.returncode is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return


async def list_installed() -> dict[str, Any]:
    command = await run_flatpak(
        list(LIST_ARGS),
        timeout_sec=COMMAND_TIMEOUT_SEC["list"],
        extra_env={"LC_ALL": "C", "LANG": "C.UTF-8"},
    )
    if command["exitCode"] != 0:
        raise EngineError(
            "PROCESS_FAILED",
            "Could not list installed Flatpaks.",
            details={
                "exitCode": command["exitCode"],
                "stderr": (command["stderr"] or "")[:1500],
            },
        )
    parsed = parse_list_output(command["stdout"] or "")
    parsed["flatpakPath"] = command["argv"][0]
    return parsed


async def list_remotes() -> dict[str, Any]:
    command = await run_flatpak(
        list(REMOTE_LIST_ARGS),
        timeout_sec=COMMAND_TIMEOUT_SEC["remotes"],
        extra_env={"LC_ALL": "C", "LANG": "C.UTF-8"},
    )
    if command["exitCode"] != 0:
        raise EngineError(
            "PROCESS_FAILED",
            "Could not list Flatpak remotes.",
            details={
                "exitCode": command["exitCode"],
                "stderr": (command["stderr"] or "")[:1500],
            },
        )
    remotes = []
    for line in (command["stdout"] or "").splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        name = parts[0].strip() if parts else ""
        if not name:
            continue
        remotes.append(
            {
                "name": name,
                "title": parts[1] if len(parts) > 1 else "",
                "url": parts[2] if len(parts) > 2 else "",
            }
        )
    present = any(remote["name"] == FLATHUB_REMOTE for remote in remotes)
    return {
        "ok": True,
        "present": present,
        "remoteName": FLATHUB_REMOTE,
        "remotes": remotes,
        "flatpakPath": command["argv"][0],
    }


async def add_flathub_remote() -> dict[str, Any]:
    existing = await list_remotes()
    if existing["present"]:
        return {**existing, "alreadyPresent": True}
    command = await run_flatpak(
        [
            "remote-add",
            "--user",
            "--if-not-exists",
            FLATHUB_REMOTE,
            FLATHUB_REPO,
        ],
        timeout_sec=COMMAND_TIMEOUT_SEC["remote_add"],
    )
    if command["exitCode"] != 0:
        raise EngineError(
            "PROCESS_FAILED",
            "Could not add the Flathub remote.",
            details={
                "exitCode": command["exitCode"],
                "stderr": (command["stderr"] or "")[:1500],
            },
        )
    after = await list_remotes()
    if not after["present"]:
        raise EngineError(
            "FLATHUB_REMOTE_MISSING",
            "Flathub remote-add reported success but the remote is still missing.",
        )
    return {**after, "added": True}


async def require_flathub() -> None:
    remotes = await list_remotes()
    if not remotes["present"]:
        raise EngineError(
            "FLATHUB_REMOTE_MISSING",
            "A user-scoped Flathub remote is required. Enable it from DeckDepot first.",
        )


async def require_installed(app_id: str) -> dict[str, str]:
    installed = await list_installed()
    for row in installed["apps"]:
        if row["appId"] == app_id:
            return row
    raise EngineError(
        "INVALID_ARGUMENT",
        f"{app_id} is not an installed user-scoped Flatpak.",
    )


async def confirm_remote_app(app_id: str) -> None:
    await require_flathub()
    command = await run_flatpak(
        ["remote-info", "--user", FLATHUB_REMOTE, app_id],
        timeout_sec=COMMAND_TIMEOUT_SEC["remote_info"],
        extra_env={"LC_ALL": "C", "LANG": "C.UTF-8"},
    )
    if command["exitCode"] != 0:
        raise EngineError(
            "INVALID_ARGUMENT",
            f"{app_id} was not found on the user-scoped Flathub remote.",
            details={"stderr": (command["stderr"] or "")[:1500]},
        )


def mutation_argv(operation: str, app_id: str, ref: str | None = None) -> list[str]:
    app_id = validate_flatpak_app_id(app_id)
    if operation == "install":
        return ["install", "--user", "-y", "--noninteractive", FLATHUB_REMOTE, app_id]
    if operation == "update":
        target = validate_flatpak_ref(ref, app_id=app_id) if ref else app_id
        return ["update", "--user", "-y", "--noninteractive", target]
    if operation == "uninstall":
        return ["uninstall", "--user", "-y", "--noninteractive", app_id]
    raise EngineError("INVALID_ARGUMENT", f"unsupported operation {operation}")


async def spawn_mutation(
    operation: str,
    app_id: str,
    ref: str | None = None,
) -> asyncio.subprocess.Process:
    path = require_flatpak_path()
    if operation == "update_all":
        args = list(UPDATE_ALL_ARGS)
    else:
        args = mutation_argv(operation, app_id, ref)
    env = sanitized_host_env()
    env["LC_ALL"] = "C.UTF-8"
    env["LANG"] = "C.UTF-8"
    return await asyncio.create_subprocess_exec(
        path,
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
        start_new_session=True,
    )
