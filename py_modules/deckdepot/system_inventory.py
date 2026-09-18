"""Read-only system-scoped Flatpak inventory.

Does not install, update, uninstall, or change remotes.
Does not change the M1 user-scoped mutation engine.
"""

from __future__ import annotations

from typing import Any

from deckdepot.errors import EngineError
from deckdepot.flatpak_engine import (
    COMMAND_TIMEOUT_SEC,
    LIST_COLUMNS,
    parse_list_output,
    run_flatpak,
)

SYSTEM_LIST_ARGS = (
    "list",
    "--system",
    "--app",
    f"--columns={','.join(LIST_COLUMNS)}",
)


async def list_system_installed() -> dict[str, Any]:
    command = await run_flatpak(
        list(SYSTEM_LIST_ARGS),
        timeout_sec=COMMAND_TIMEOUT_SEC["list"],
        extra_env={"LC_ALL": "C", "LANG": "C.UTF-8"},
    )
    if command["exitCode"] != 0:
        raise EngineError(
            "PROCESS_FAILED",
            "Could not list system-scoped Flatpaks.",
            details={
                "exitCode": command["exitCode"],
                "stderr": (command["stderr"] or "")[:1500],
                "installationScope": "system",
            },
        )
    parsed = parse_list_output(command["stdout"] or "", installation_scope="system")
    for app in parsed["apps"]:
        app["installationScope"] = "system"
    parsed["installationScope"] = "system"
    parsed["flatpakPath"] = command["argv"][0]
    return parsed
