"""Conservative AppMan program-name and source validation."""

from __future__ import annotations

import re

from deckdepot.errors import EngineError

NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+-]{0,80}$")
SOURCES = {
    "am",
    "soarpkg",
    "busybox",
    "coreutilsh",
    "python",
    "appbundle",
}
SEARCH_SCOPES = {"default", "all", "appimages", "portable"}
SCOPE_FLAGS = {
    "default": (),
    "all": ("--all",),
    "appimages": ("--appimages",),
    "portable": ("--portable",),
}
SOURCE_FLAGS = {
    "am": (),
    "soarpkg": ("--soarpkg",),
    "busybox": ("--busybox",),
    "coreutilsh": ("--coreutilsh",),
    "python": ("--python",),
    "appbundle": ("--appbundle",),
}
SOURCE_LABELS = {
    "am": "AM",
    "soarpkg": "soarpkg",
    "busybox": "busybox",
    "coreutilsh": "coreutilsh",
    "python": "python",
    "appbundle": "appbundle",
}


def validate_appman_name(raw: str) -> str:
    if not isinstance(raw, str):
        raise EngineError("INVALID_ARGUMENT", "application id must be a string")
    app_id = raw.strip().strip("*")
    if any(ord(ch) < 32 for ch in app_id):
        raise EngineError("INVALID_ARGUMENT", "application id contains control characters")
    if app_id.startswith("-") or "/" in app_id or "\\" in app_id:
        raise EngineError("INVALID_ARGUMENT", "application id must not look like a path or flag")
    if not NAME_RE.fullmatch(app_id):
        raise EngineError("INVALID_ARGUMENT", "application id is not a valid AppMan name")
    return app_id


def validate_source_id(raw: str | None) -> str:
    source = str(raw or "am").strip().lower()
    if source not in SOURCES:
        raise EngineError("INVALID_ARGUMENT", "unsupported AppMan source")
    return source


def validate_search_scope(raw: str | None) -> str:
    scope = str(raw or "default").strip().lower()
    if scope not in SEARCH_SCOPES:
        raise EngineError("INVALID_ARGUMENT", "unsupported AppMan search scope")
    return scope


def source_from_text(text: str) -> str:
    lowered = (text or "").lower()
    for source, flag in (
        ("soarpkg", "--soarpkg"),
        ("soarpkg", ".soarpkg"),
        ("busybox", "--busybox"),
        ("busybox", ".busybox"),
        ("coreutilsh", "--coreutilsh"),
        ("coreutilsh", ".coreutilsh"),
        ("python", "--python"),
        ("python", ".python"),
        ("appbundle", "--appbundle"),
        ("appbundle", ".appbundle"),
    ):
        if flag in lowered:
            return source
    if "[busybox]" in lowered:
        return "busybox"
    return "am"
