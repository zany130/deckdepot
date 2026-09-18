"""Conservative Flatpak application ID validation.

This is a security allowlist, not proof that the ID exists on a remote.
"""

from __future__ import annotations

import re

from deckdepot.errors import EngineError

# Reverse-DNS / D-Bus style. ASCII only. At least one dot. Max 255 UTF-8 bytes.
APP_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)+$")
MAX_APP_ID_BYTES = 255


def validate_flatpak_app_id(raw: str) -> str:
    if not isinstance(raw, str):
        raise EngineError("INVALID_ARGUMENT", "application id must be a string")
    app_id = raw.strip()
    if any(ord(ch) < 32 for ch in app_id):
        raise EngineError("INVALID_ARGUMENT", "application id contains control characters")
    if "/" in app_id or "\\" in app_id:
        raise EngineError("INVALID_ARGUMENT", "application id must not contain path separators")
    if len(app_id.encode("utf-8")) > MAX_APP_ID_BYTES:
        raise EngineError("INVALID_ARGUMENT", "application id exceeds 255 bytes")
    if "." not in app_id or not APP_ID_RE.fullmatch(app_id):
        raise EngineError(
            "INVALID_ARGUMENT",
            "application id must be reverse-DNS ASCII (example: org.kde.kwrite)",
        )
    return app_id


REF_RE = re.compile(r"^[A-Za-z0-9._-]+$")


def validate_flatpak_ref(raw: str, *, app_id: str) -> str:
    """Allow `app/<id>/<arch>/<branch>` for ambiguous update targets only."""
    if not isinstance(raw, str):
        raise EngineError("INVALID_ARGUMENT", "ref must be a string")
    ref = raw.strip()
    if any(ord(ch) < 32 for ch in ref):
        raise EngineError("INVALID_ARGUMENT", "ref contains control characters")
    parts = ref.split("/")
    if len(parts) != 4 or parts[0] != "app":
        raise EngineError(
            "INVALID_ARGUMENT",
            "ref must look like app/<id>/<arch>/<branch>",
        )
    if validate_flatpak_app_id(parts[1]) != app_id:
        raise EngineError("INVALID_ARGUMENT", "ref application id does not match")
    if not REF_RE.fullmatch(parts[2]) or not REF_RE.fullmatch(parts[3]):
        raise EngineError("INVALID_ARGUMENT", "ref arch/branch is invalid")
    if len(ref.encode("utf-8")) > MAX_APP_ID_BYTES * 2:
        raise EngineError("INVALID_ARGUMENT", "ref is too long")
    return ref
