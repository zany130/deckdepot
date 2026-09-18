"""Map AppMan text/desktop metadata onto DeckDepot store slugs.

User-facing slugs stay: game, utility, audiovideo, graphics, network,
office, development. Unconfident rows keep categories=[] (search/installed
only). Native AppMan/PLA tokens are preserved separately.
"""

from __future__ import annotations

import re

DECKDEPOT_SLUGS = (
    "game",
    "utility",
    "audiovideo",
    "graphics",
    "network",
    "office",
    "development",
)

# First match wins. Keep this conservative: PLA steam|wine|stream false
# positives must not dump helpers into Games / Audio & Video.
_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "game",
        re.compile(
            r"\b(video ?games?|emulator|emulation|roms?\b|rpg\b|fps\b|"
            r"platformer|arcade game|strategy game|rts game|puzzle game|"
            r"adventure game|nintendo|playstation|xbox|minecraft|doom)\b|"
            r"\bgames?\b",
            re.I,
        ),
    ),
    (
        "audiovideo",
        re.compile(
            r"\b(audio editor|video editor|media player|music player|"
            r"audio player|video player|podcast|iptv|equalizer|"
            r"sound editor|movie player)\b",
            re.I,
        ),
    ),
    (
        "graphics",
        re.compile(
            r"\b(image editor|photo editor|graphics editor|vector|"
            r"drawing program|paint\b|gimp|inkscape|blender|"
            r"wallpaper|pixel art)\b",
            re.I,
        ),
    ),
    (
        "network",
        re.compile(
            r"\b(web browser|browser\b|vpn\b|torrent|messenger|"
            r"chat client|email client|file sharing|remote desktop)\b",
            re.I,
        ),
    ),
    (
        "office",
        re.compile(
            r"\b(office suite|word process|spreadsheet|presentation|"
            r"pdf (reader|editor)|document editor)\b",
            re.I,
        ),
    ),
    (
        "development",
        re.compile(
            r"\b(ide\b|debugger|compiler|code editor|git client|"
            r"programming language|sdk\b|developer tool)\b",
            re.I,
        ),
    ),
    (
        "utility",
        re.compile(
            r"\b(file manager|archive|archiver|terminal emulator|"
            r"calculator|disk utility|partition|password manager|"
            r"system monitor|task manager|package manager|"
            r"command-?line)\b",
            re.I,
        ),
    ),
)

_FD_PRIORITY = (
    ("game", ("Game", "Emulator")),
    (
        "audiovideo",
        ("AudioVideo", "Audio", "Video", "Player", "Recorder", "TV", "Music"),
    ),
    (
        "graphics",
        (
            "Graphics",
            "2DGraphics",
            "3DGraphics",
            "RasterGraphics",
            "VectorGraphics",
            "Photography",
        ),
    ),
    (
        "network",
        (
            "Network",
            "Email",
            "WebBrowser",
            "InstantMessaging",
            "Chat",
            "FileTransfer",
            "P2P",
            "RemoteAccess",
        ),
    ),
    (
        "office",
        (
            "Office",
            "Spreadsheet",
            "WordProcessor",
            "Presentation",
            "Calendar",
            "ContactManagement",
            "Dictionary",
            "Finance",
            "ProjectManagement",
            "Publishing",
        ),
    ),
    (
        "development",
        (
            "Development",
            "IDE",
            "Debugger",
            "GUIDesigner",
            "Building",
            "RevisionControl",
            "Translation",
            "Database",
            "WebDevelopment",
        ),
    ),
    (
        "utility",
        (
            "Utility",
            "System",
            "Settings",
            "Accessibility",
            "Archiving",
            "Compression",
            "FileTools",
            "FileManager",
            "TerminalEmulator",
            "TextEditor",
            "Calculator",
            "Clock",
            "Monitor",
            "Security",
            "PackageManager",
            "Science",
            "Education",
            "Documentation",
            "Core",
        ),
    ),
)


def slug_from_text(text: str) -> str | None:
    blob = text or ""
    for slug, pattern in _RULES:
        if pattern.search(blob):
            return slug
    return None


def slug_from_desktop_categories(raw: str) -> str | None:
    tokens = {part.strip() for part in (raw or "").split(";") if part.strip()}
    if not tokens:
        return None
    for slug, names in _FD_PRIORITY:
        if tokens.intersection(names):
            return slug
    return None


def normalize_categories(
    *,
    summary: str = "",
    desktop_categories: str = "",
) -> tuple[list[str], list[str]]:
    native: list[str] = []
    if desktop_categories.strip():
        native = [part.strip() for part in desktop_categories.split(";") if part.strip()]
    slug = slug_from_desktop_categories(desktop_categories) or slug_from_text(summary)
    return ([slug] if slug else [], native)
