"""P0.5 Flatpak command-contract diagnostics.

Not the production Flatpak engine. Isolated so it can be removed later.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import time
from typing import Any

from deckdepot.diagnostics import log_error, log_info, persist_snapshot

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
TEST_APP_ID = "org.kde.kwrite"
TEST_REMOTE = "flathub"
COMMAND_TIMEOUT_SEC = {
    "version": 15,
    "list": 30,
    "install": 300,
    "update": 300,
    "uninstall": 180,
    "remote_ls": 60,
}
UPDATE_LS_ARGS = (
    "remote-ls",
    "--updates",
    "--user",
    "--app",
    "--columns=application,version,branch,arch,origin,commit,ref",
)
LIST_ACTIVE_LATEST_ARGS = (
    "list",
    "--user",
    "--app",
    "--columns=application,version,active,latest",
)


def _now_ms() -> int:
    return int(time.time() * 1000)


def resolved_flatpak_path() -> str | None:
    return shutil.which("flatpak")


def inherited_env() -> dict[str, str]:
    return os.environ.copy()


def sanitized_host_env() -> dict[str, str]:
    """Child env without Decky/PyInstaller library overrides.

    P0.4 showed host flatpak fails inside PluginLoader because LD_LIBRARY_PATH
    points at bundled OpenSSL. This is an environment sanitization for the
    host binary, not a different Flatpak API.
    """
    env = os.environ.copy()
    env.pop("LD_LIBRARY_PATH", None)
    return env


def parse_list_output(stdout: str) -> dict[str, Any]:
    rows: list[dict[str, str]] = []
    malformed: list[dict[str, Any]] = []
    empty_column_examples: list[dict[str, str]] = []
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
                    "raw": line,
                }
            )
            continue
        row = dict(zip(LIST_COLUMNS, parts))
        rows.append(row)
        if any(value == "" for value in parts):
            empty_column_examples.append(row)
    return {
        "delimiter": "tab",
        "headerPresent": False,
        "expectedColumns": list(LIST_COLUMNS),
        "rowCount": len(rows),
        "malformedCount": len(malformed),
        "malformed": malformed[:20],
        "emptyColumnExampleCount": len(empty_column_examples),
        "emptyColumnExamples": empty_column_examples[:5],
        "rows": rows,
        "activeColumnLooksLikeCommit": all(
            len(row["active"]) >= 8 and all(c in "0123456789abcdef" for c in row["active"].lower())
            for row in rows
            if row.get("active")
        )
        if rows
        else None,
    }


async def run_flatpak(
    args: list[str],
    *,
    env: dict[str, str],
    env_name: str,
    timeout_sec: int,
    extra_env: dict[str, str] | None = None,
) -> dict[str, Any]:
    path = resolved_flatpak_path()
    started = time.monotonic()
    result: dict[str, Any] = {
        "argv": [path, *args] if path else ["flatpak", *args],
        "envName": env_name,
        "available": path is not None,
        "path": path,
        "exitCode": None,
        "stdout": "",
        "stderr": "",
        "timedOut": False,
        "elapsedMs": 0,
    }
    if path is None:
        result["errorType"] = "FLATPAK_NOT_FOUND"
        return result
    child_env = env.copy()
    if extra_env:
        child_env.update(extra_env)
    try:
        proc = await asyncio.create_subprocess_exec(
            path,
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=child_env,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=timeout_sec
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            result["timedOut"] = True
            result["errorType"] = "TIMEOUT"
            result["elapsedMs"] = int((time.monotonic() - started) * 1000)
            return result
        result["exitCode"] = proc.returncode
        result["stdout"] = stdout.decode("utf-8", errors="replace")
        result["stderr"] = stderr.decode("utf-8", errors="replace")
        result["elapsedMs"] = int((time.monotonic() - started) * 1000)
    except Exception as exc:  # noqa: BLE001 - diagnostic
        result["errorType"] = type(exc).__name__
        result["errorMessage"] = str(exc)
        result["elapsedMs"] = int((time.monotonic() - started) * 1000)
        log_error(f"flatpak exec failed env={env_name} args={args}", exc)
    return result


async def probe_list_contract(backend_instance_id: str) -> dict[str, Any]:
    log_info("P0.5 list contract probe")
    attempts = []
    for env_name, env, extra in (
        ("inherited", inherited_env(), None),
        ("sanitized_no_ld_library_path", sanitized_host_env(), None),
        (
            "sanitized_lc_all_c",
            sanitized_host_env(),
            {"LC_ALL": "C", "LANG": "C"},
        ),
    ):
        command = await run_flatpak(
            list(LIST_ARGS),
            env=env,
            env_name=env_name,
            timeout_sec=COMMAND_TIMEOUT_SEC["list"],
            extra_env=extra,
        )
        parsed = None
        if command.get("exitCode") == 0:
            parsed = parse_list_output(command.get("stdout") or "")
        attempts.append({"command": command, "parsed": parsed})
        log_info(
            "P0.5 list env=%s exit=%s rows=%s malformed=%s elapsedMs=%s"
            % (
                env_name,
                command.get("exitCode"),
                (parsed or {}).get("rowCount"),
                (parsed or {}).get("malformedCount"),
                command.get("elapsedMs"),
            )
        )

    version_inherited = await run_flatpak(
        ["--version"],
        env=inherited_env(),
        env_name="inherited",
        timeout_sec=COMMAND_TIMEOUT_SEC["version"],
    )
    version_sanitized = await run_flatpak(
        ["--version"],
        env=sanitized_host_env(),
        env_name="sanitized_no_ld_library_path",
        timeout_sec=COMMAND_TIMEOUT_SEC["version"],
    )

    payload = {
        "collectedAtMs": _now_ms(),
        "backendInstanceId": backend_instance_id,
        "testAppId": TEST_APP_ID,
        "listArgs": list(LIST_ARGS),
        "versionInherited": version_inherited,
        "versionSanitized": version_sanitized,
        "listAttempts": attempts,
    }
    persist_snapshot("p0-flatpak-list.json", payload)
    return payload


async def run_mutation(
    operation: str,
    backend_instance_id: str,
) -> dict[str, Any]:
    """Allowlisted disposable-app mutation for P0.5 only."""
    if operation not in {"install", "update", "uninstall"}:
        raise ValueError("unsupported P0.5 operation")
    log_info(f"P0.5 mutation operation={operation} app={TEST_APP_ID}")
    if operation == "install":
        args = [
            "install",
            "--user",
            "-y",
            "--noninteractive",
            TEST_REMOTE,
            TEST_APP_ID,
        ]
        timeout = COMMAND_TIMEOUT_SEC["install"]
    elif operation == "update":
        args = ["update", "--user", "-y", "--noninteractive", TEST_APP_ID]
        timeout = COMMAND_TIMEOUT_SEC["update"]
    else:
        args = ["uninstall", "--user", "-y", "--noninteractive", TEST_APP_ID]
        timeout = COMMAND_TIMEOUT_SEC["uninstall"]

    command = await run_flatpak(
        args,
        env=sanitized_host_env(),
        env_name="sanitized_no_ld_library_path",
        timeout_sec=timeout,
        extra_env={"LC_ALL": "C", "LANG": "C"},
    )
    payload = {
        "collectedAtMs": _now_ms(),
        "backendInstanceId": backend_instance_id,
        "operation": operation,
        "appId": TEST_APP_ID,
        "command": command,
    }
    persist_snapshot(f"p0-flatpak-{operation}.json", payload)
    log_info(
        f"P0.5 {operation} exit={command.get('exitCode')} elapsedMs={command.get('elapsedMs')}"
    )
    return payload


async def probe_update_discovery(backend_instance_id: str) -> dict[str, Any]:
    """P0.6: measure Flatpak's own update-listing commands. Read-only."""
    log_info("P0.6 update discovery probe")
    attempts: list[dict[str, Any]] = []
    for env_name, env in (
        ("inherited", inherited_env()),
        ("sanitized_no_ld_library_path", sanitized_host_env()),
    ):
        command = await run_flatpak(
            list(UPDATE_LS_ARGS),
            env=env,
            env_name=env_name,
            timeout_sec=COMMAND_TIMEOUT_SEC["remote_ls"],
            extra_env={"LC_ALL": "C", "LANG": "C"} if env_name.startswith("sanitized") else None,
        )
        attempts.append(command)
        log_info(
            "P0.6 remote-ls --updates env=%s exit=%s stdoutBytes=%s"
            % (
                env_name,
                command.get("exitCode"),
                len(command.get("stdout") or ""),
            )
        )

    latest_list = await run_flatpak(
        list(LIST_ACTIVE_LATEST_ARGS),
        env=sanitized_host_env(),
        env_name="sanitized_no_ld_library_path",
        timeout_sec=COMMAND_TIMEOUT_SEC["list"],
        extra_env={"LC_ALL": "C", "LANG": "C"},
    )
    json_updates = await run_flatpak(
        ["remote-ls", "--updates", "--user", "--app", "--json"],
        env=sanitized_host_env(),
        env_name="sanitized_no_ld_library_path",
        timeout_sec=COMMAND_TIMEOUT_SEC["remote_ls"],
        extra_env={"LC_ALL": "C", "LANG": "C"},
    )

    payload = {
        "collectedAtMs": _now_ms(),
        "backendInstanceId": backend_instance_id,
        "chosenDiscoveryArgv": list(UPDATE_LS_ARGS),
        "notes": {
            "listLatestColumn": "Observed as '-' even when a newer commit exists; do not use.",
            "displayVersion": "Not sufficient; kwrite kept 26.04.3 while an update existed.",
            "emptyStdoutExit0": "Means no updates, not a query failure.",
            "jsonOmitsCommit": "remote-ls --json on 1.18.2 lacked commit; prefer --columns.",
        },
        "remoteLsUpdatesAttempts": attempts,
        "listActiveLatest": latest_list,
        "remoteLsUpdatesJson": json_updates,
    }
    persist_snapshot("p0-flatpak-updates.json", payload)
    return payload
