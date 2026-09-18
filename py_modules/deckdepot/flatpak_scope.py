"""Host-respecting Flatpak scope detection. Never creates remotes."""

from __future__ import annotations

from typing import Any

from deckdepot.errors import EngineError
from deckdepot.flatpak_engine import list_remotes_for_scope
from deckdepot.flatpak_settings import load_settings
from deckdepot.session_bridge import probe_capability


def automatic_default_scope(*, user_configured: bool, system_configured: bool) -> str | None:
    """Host-respecting default for *new* installs.

    Configured usable scope(s)      Automatic default
    User only                       User
    System only                     System
    User + System                   System
    Neither                         None (do not invent a remote)
    """
    if system_configured:
        return "system"
    if user_configured:
        return "user"
    return None


async def collect_scope_status(*, probe: bool = True) -> dict[str, Any]:
    settings = load_settings()
    preference = settings["installScope"]
    user_remotes: dict[str, Any]
    system_remotes: dict[str, Any]
    try:
        user_remotes = await list_remotes_for_scope("user")
        user_error = None
    except EngineError as exc:
        user_remotes = {"ok": False, "present": False, "remoteName": None, "remotes": []}
        user_error = exc.to_dict()
    try:
        system_remotes = await list_remotes_for_scope("system")
        system_error = None
    except EngineError as exc:
        system_remotes = {"ok": False, "present": False, "remoteName": None, "remotes": []}
        system_error = exc.to_dict()

    user_remote_present = bool(user_remotes.get("present"))
    system_remote_present = bool(system_remotes.get("present"))
    bridge = (
        await probe_capability()
        if probe
        else {
            "ok": True,
            "available": False,
            "reachable": False,
            "authorized": False,
            "reason": "Capability probe skipped.",
        }
    )
    user_usable = user_remote_present
    system_usable = system_remote_present and bool(bridge.get("available"))
    system_configured = system_remote_present
    user_configured = user_remote_present

    if preference == "user":
        resolved = "user" if user_usable else None
        unavailable_reason = (
            None
            if resolved
            else "No usable user-scoped Flathub remote is configured. DeckDepot will not create one."
        )
    elif preference == "system":
        if not system_remote_present:
            resolved = None
            unavailable_reason = "No usable system-scoped Flathub remote is configured. DeckDepot will not create one."
        elif not bridge.get("available"):
            resolved = None
            unavailable_reason = bridge.get("reason") or "System Flatpak management is unavailable."
        else:
            resolved = "system"
            unavailable_reason = None
    else:
        resolved = automatic_default_scope(
            user_configured=user_configured, system_configured=system_configured
        )
        if resolved == "system" and not system_usable:
            unavailable_reason = (
                bridge.get("reason")
                if system_configured and not bridge.get("available")
                else "No usable system-scoped Flathub remote is configured. DeckDepot will not create one."
            )
            resolved = None
        elif resolved is None:
            unavailable_reason = "No Flathub remote is configured for user or system scope."
        else:
            unavailable_reason = None

    return {
        "ok": True,
        "installScopePreference": preference,
        "resolvedInstallScope": resolved,
        "unavailableReason": unavailable_reason,
        "userRemotePresent": user_remote_present,
        "systemRemotePresent": system_remote_present,
        "userConfigured": user_configured,
        "systemConfigured": system_configured,
        "userUsable": user_usable,
        "systemUsable": system_usable,
        "systemMutationsAvailable": bool(bridge.get("available")),
        "userRemoteName": user_remotes.get("remoteName"),
        "systemRemoteName": system_remotes.get("remoteName"),
        "userRemotes": user_remotes.get("remotes") or [],
        "systemRemotes": system_remotes.get("remotes") or [],
        "userRemoteError": user_error,
        "systemRemoteError": system_error,
        "bridge": bridge,
    }


async def resolve_new_install_scope(requested: str | None = None) -> str:
    status = await collect_scope_status()
    requested = (requested or "").strip().lower()
    if requested in {"user", "system"}:
        if requested == "user" and not status["userUsable"]:
            raise EngineError(
                "SCOPE_UNAVAILABLE",
                "No usable user-scoped Flathub remote is configured. DeckDepot will not create one.",
                details=status,
            )
        if requested == "system" and not status["systemRemotePresent"]:
            raise EngineError(
                "SCOPE_UNAVAILABLE",
                "No usable system-scoped Flathub remote is configured. DeckDepot will not create one.",
                details=status,
            )
        if requested == "system" and not status["systemUsable"]:
            bridge = status.get("bridge") or {}
            raise EngineError(
                str(bridge.get("errorCode") or "SESSION_BRIDGE_UNAVAILABLE"),
                str(
                    bridge.get("reason")
                    or "System Flatpak management is unavailable."
                ),
                details=status,
            )
        return requested
    resolved = status.get("resolvedInstallScope")
    if resolved in {"user", "system"}:
        return resolved
    raise EngineError(
        "SCOPE_UNAVAILABLE",
        status.get("unavailableReason") or "No Flatpak install scope is available.",
        details=status,
    )
