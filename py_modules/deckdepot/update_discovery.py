"""User-scoped Flatpak update discovery.

Uses the P0.6 contract:
  flatpak remote-ls --updates --user --app --columns=application,version,branch,arch,origin,commit,ref

Empty stdout + exit 0 means no updates, not a failed query.
Does not compare Flathub/list marketing versions.
Does not list runtimes or `.Locale` refs as store applications.
"""

from __future__ import annotations

from typing import Any

from deckdepot.errors import EngineError
from deckdepot.flatpak_engine import COMMAND_TIMEOUT_SEC, run_flatpak

UPDATE_COLUMNS = (
    "application",
    "version",
    "branch",
    "arch",
    "origin",
    "commit",
    "ref",
)
UPDATE_LS_ARGS = (
    "remote-ls",
    "--updates",
    "--user",
    "--app",
    f"--columns={','.join(UPDATE_COLUMNS)}",
)
RELATED_MARKERS = (".Locale", ".Debug", ".Sources")


def is_store_application_update(app_id: str, ref: str) -> bool:
    """Drop related/partial refs so they cannot inflate store update counts.

    AutoFlatpaks regression class: `.Locale` / runtime pulls are not extra apps.
    Discovery already uses `--app`; this is a second fence.
    """
    if not app_id:
        return False
    if any(marker in app_id for marker in RELATED_MARKERS):
        return False
    if ref.startswith("runtime/"):
        return False
    return True


def parse_update_output(stdout: str) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    dropped: list[dict[str, Any]] = []
    malformed: list[dict[str, Any]] = []
    for index, raw_line in enumerate(stdout.splitlines()):
        line = raw_line.rstrip("\n")
        if line == "":
            continue
        parts = line.split("\t")
        if len(parts) != len(UPDATE_COLUMNS):
            malformed.append(
                {
                    "lineIndex": index,
                    "columnCount": len(parts),
                    "expected": len(UPDATE_COLUMNS),
                }
            )
            continue
        raw = dict(zip(UPDATE_COLUMNS, parts))
        app_id = (raw.get("application") or "").strip()
        ref = (raw.get("ref") or "").strip()
        if not is_store_application_update(app_id, ref):
            dropped.append({"appId": app_id, "ref": ref})
            continue
        version = raw.get("version") or None
        if version == "Latest":
            version = None
        rows.append(
            {
                "provider": "flatpak",
                "installationScope": "user",
                "appId": app_id,
                "name": app_id,
                "branch": raw.get("branch") or "",
                "arch": raw.get("arch") or "",
                "origin": raw.get("origin") or "",
                "commit": raw.get("commit") or "",
                "ref": ref,
                "remoteVersion": version,
                "installedState": "update_available",
            }
        )
    return {
        "ok": True,
        "updates": rows,
        "malformedCount": len(malformed),
        "malformed": malformed[:20],
        "droppedRelatedCount": len(dropped),
        "droppedRelated": dropped[:20],
    }


async def list_user_updates() -> dict[str, Any]:
    command = await run_flatpak(
        list(UPDATE_LS_ARGS),
        timeout_sec=COMMAND_TIMEOUT_SEC["remote_ls"],
        extra_env={"LC_ALL": "C", "LANG": "C.UTF-8"},
    )
    if command["exitCode"] != 0:
        raise EngineError(
            "PROCESS_FAILED",
            "Could not query user-scoped Flatpak updates. The remote may be unreachable.",
            details={
                "exitCode": command["exitCode"],
                "stderr": (command["stderr"] or "")[:1500],
                "degraded": True,
            },
        )
    parsed = parse_update_output(command["stdout"] or "")
    parsed["flatpakPath"] = command["argv"][0]
    parsed["discoveryArgv"] = command["argv"]
    return parsed
