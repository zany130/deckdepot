"""Shared browse categories for Flatpak AppStream and AppMan.

Slugs match Flathub's main category collection ids
(https://flathub.org/api/v2/collection/category/{slug}). Display labels for
the original seven categories stay as DeckDepot already shows them. Newer
Flathub mains use Flathub's public names.

`other` is not a Flathub endpoint. It is the local bucket for apps whose
metadata does not map onto a known main category. Dynamic collections
(New Arrivals, Recently Updated, Trending, Popular) are Flathub collection
endpoints and are not represented here; AppMan has no equivalent metadata.
"""

from __future__ import annotations

import re

# Order is the traditional category tab order. Discovery collections are
# defined on the frontend and shown before these.
CATEGORY_ORDER: tuple[tuple[str, str], ...] = (
    ("game", "Games"),
    ("utility", "Utilities"),
    ("audiovideo", "Audio & Video"),
    ("graphics", "Graphics"),
    ("network", "Network"),
    ("office", "Office"),
    ("development", "Development"),
    ("education", "Education"),
    ("science", "Science"),
    ("system", "System"),
    ("healthfitness", "Health & Fitness"),
    ("other", "Other"),
)

CATEGORY_IDS: tuple[str, ...] = tuple(slug for slug, _label in CATEGORY_ORDER)
CATEGORY_LABELS: dict[str, str] = dict(CATEGORY_ORDER)

# AppStream / Freedesktop main category tokens, plus the lowercase Flathub
# collection slug when a remote echoes it back.
APPSTREAM_MAIN_TO_SLUG: dict[str, str] = {
    "Game": "game",
    "Utility": "utility",
    "AudioVideo": "audiovideo",
    "Audio": "audiovideo",
    "Video": "audiovideo",
    "Graphics": "graphics",
    "Network": "network",
    "Office": "office",
    "Development": "development",
    "Education": "education",
    "Science": "science",
    "System": "system",
    "Settings": "system",
    "Health": "healthfitness",
}

# Additional tokens that belong under a main category when the main token
# itself is absent. An app may map to more than one slug.
APPSTREAM_EXTRA_TO_SLUG: dict[str, str] = {
    "ActionGame": "game",
    "AdventureGame": "game",
    "ArcadeGame": "game",
    "BoardGame": "game",
    "BlocksGame": "game",
    "CardGame": "game",
    "Emulator": "game",
    "KidsGame": "game",
    "LogicGame": "game",
    "RolePlaying": "game",
    "Shooter": "game",
    "Simulation": "game",
    "SportsGame": "game",
    "StrategyGame": "game",
    "Player": "audiovideo",
    "Recorder": "audiovideo",
    "Music": "audiovideo",
    "TV": "audiovideo",
    "Midi": "audiovideo",
    "Mixer": "audiovideo",
    "Sequencer": "audiovideo",
    "Tuner": "audiovideo",
    "AudioVideoEditing": "audiovideo",
    "2DGraphics": "graphics",
    "3DGraphics": "graphics",
    "RasterGraphics": "graphics",
    "VectorGraphics": "graphics",
    "Photography": "graphics",
    "Email": "network",
    "WebBrowser": "network",
    "InstantMessaging": "network",
    "Chat": "network",
    "IRCClient": "network",
    "FileTransfer": "network",
    "P2P": "network",
    "RemoteAccess": "network",
    "Feed": "network",
    "HamRadio": "network",
    "News": "network",
    "Spreadsheet": "office",
    "WordProcessor": "office",
    "Presentation": "office",
    "Calendar": "office",
    "ContactManagement": "office",
    "Dictionary": "office",
    "Chart": "office",
    "Finance": "office",
    "FlowChart": "office",
    "PDA": "office",
    "ProjectManagement": "office",
    "Publishing": "office",
    "Viewer": "office",
    "IDE": "development",
    "Debugger": "development",
    "GUIDesigner": "development",
    "Building": "development",
    "RevisionControl": "development",
    "Translation": "development",
    "WebDevelopment": "development",
    "Database": "development",
    "ArtificialIntelligence": "science",
    "Astronomy": "science",
    "Biology": "science",
    "Chemistry": "science",
    "ComputerScience": "science",
    "DataVisualization": "science",
    "Economy": "science",
    "Electricity": "science",
    "Geography": "science",
    "Geology": "science",
    "Geoscience": "science",
    "Math": "science",
    "NumericalAnalysis": "science",
    "Physics": "science",
    "Robotics": "science",
    "Archiving": "utility",
    "Compression": "utility",
    "FileTools": "utility",
    "FileManager": "utility",
    "TerminalEmulator": "utility",
    "TextEditor": "utility",
    "Calculator": "utility",
    "Clock": "utility",
    "Monitor": "utility",
    "Security": "utility",
    "Accessibility": "utility",
    "PackageManager": "utility",
    "Documentation": "utility",
    "Core": "utility",
    "Languages": "education",
    "Literature": "education",
    "Sports": "education",
}

_SLUG_INDEX = {slug: index for index, slug in enumerate(CATEGORY_IDS)}

# Summary-only fallback. Not applied when desktop/AppStream tokens exist.
# Patterns are specific phrases, not loose words pulled from descriptions.
_TEXT_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "game",
        re.compile(
            r"\b(video ?games?|games?|emulator|emulation|rpg\b|fps\b|"
            r"platformer|arcade game|strategy game|puzzle game|"
            r"adventure game)\b",
            re.I,
        ),
    ),
    (
        "audiovideo",
        re.compile(
            r"\b(audio editor|video editor|media player|music player|"
            r"audio player|video player|podcast|sound editor|movie player)\b",
            re.I,
        ),
    ),
    (
        "graphics",
        re.compile(
            r"\b(image editor|photo editor|graphics editor|vector editor|"
            r"drawing program|pixel art)\b",
            re.I,
        ),
    ),
    (
        "network",
        re.compile(
            r"\b(web browser|vpn\b|torrent client|messenger|"
            r"chat client|email client|remote desktop)\b",
            re.I,
        ),
    ),
    (
        "office",
        re.compile(
            r"\b(office suite|word process|spreadsheet|pdf (reader|editor)|"
            r"document editor)\b",
            re.I,
        ),
    ),
    (
        "development",
        re.compile(
            r"\b(debugger|compiler|code editor|git client|"
            r"programming language|developer tool)\b",
            re.I,
        ),
    ),
    (
        "education",
        re.compile(
            r"\b(language learning|flash ?cards?|classroom|educational software)\b",
            re.I,
        ),
    ),
    (
        "science",
        re.compile(
            r"\b(periodic table|astronomy app|telescope|molecular editor)\b",
            re.I,
        ),
    ),
    (
        "system",
        re.compile(
            r"\b(system settings|disk utility|partition manager)\b",
            re.I,
        ),
    ),
    (
        "utility",
        re.compile(
            r"\b(file manager|archive manager|archiver|terminal emulator|"
            r"password manager|system monitor|task manager|package manager)\b",
            re.I,
        ),
    ),
)


def is_known_category(slug: str) -> bool:
    return slug in _SLUG_INDEX


def _ordered(slugs: list[str]) -> list[str]:
    unique: list[str] = []
    for slug in slugs:
        if slug in _SLUG_INDEX and slug != "other" and slug not in unique:
            unique.append(slug)
    unique.sort(key=lambda slug: _SLUG_INDEX[slug])
    return unique


def slugs_for_tokens(tokens: list[str]) -> list[str]:
    """Map category tokens onto known slugs. Unknown tokens are ignored."""
    found: list[str] = []
    for token in tokens:
        cleaned = (token or "").strip()
        if not cleaned:
            continue
        slug = APPSTREAM_MAIN_TO_SLUG.get(cleaned) or APPSTREAM_EXTRA_TO_SLUG.get(cleaned)
        if not slug and cleaned.lower() in _SLUG_INDEX and cleaned.lower() != "other":
            slug = cleaned.lower()
        if slug:
            found.append(slug)
    return _ordered(found)


def slug_from_text(text: str) -> str | None:
    """Conservative summary fallback. Does not inspect long descriptions."""
    blob = text or ""
    for slug, pattern in _TEXT_RULES:
        if pattern.search(blob):
            return slug
    return None


def desktop_tokens(raw: str) -> list[str]:
    return [part.strip() for part in (raw or "").split(";") if part.strip()]


def normalize_appman_categories(
    *,
    summary: str = "",
    desktop_categories: str = "",
) -> tuple[list[str], list[str]]:
    """Return (store slugs, original desktop tokens).

    Desktop tokens win. Summary phrases are used only when no token maps.
    Unclassified apps return an empty slug list and belong in Other.
    """
    native = desktop_tokens(desktop_categories)
    slugs = slugs_for_tokens(native)
    if native and not slugs:
        return [], native
    if not slugs:
        fallback = slug_from_text(summary)
        if fallback:
            slugs = [fallback]
    return slugs, native
