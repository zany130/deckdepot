"""AppMan browse taxonomy.

Software categories follow the rules in the AM repository's ``tools/am2pla-site``
script, applied to the local ``◆ id : summary`` catalog lines. Those rules are
the catalog's own category index. Package format comes only from the AM
database's AppImage and portable list files. A third-party database is a
source, not a format, even when its summary mentions AppImage.

``portable-cli``, ``portable-desktop``, and ``appimage-on-the-fly`` are not
classified. AM builds those from ``#itscliapp``, ``#itsdesktopapp``, and
``#itsappimageonthefly`` markers in stats files that are not part of the
installed database.
"""

from __future__ import annotations

import math
import re

from deckdepot.categories import DEVELOPMENT_SUMMARY_RE
from deckdepot.errors import EngineError

PAGE_SIZE = 48
EVERYTHING_SLUG = "everything"

# Sources this AppMan build registers without an optional install module.
# Verified against AppMan 10.6-6 ``appman -h``: --amutils --busybox
# --coreutilsh --python. ``am`` is the main database and takes no flag.
BASE_SOURCES: tuple[str, ...] = ("am", "amutils", "busybox", "coreutilsh", "python")

# Registered only when install.am contains the matching AM sample, which is
# how am-extras decides to export --appbundle and --soarpkg.
OPTIONAL_MODULE_MARKERS: dict[str, str] = {
    "appbundle": "AM-SAMPLE-AppBundle",
    "soarpkg": "AM-SAMPLE-soarpkg",
}

SOURCE_ORDER: tuple[str, ...] = (
    "am",
    "amutils",
    "busybox",
    "coreutilsh",
    "python",
    "appbundle",
    "soarpkg",
)

SOURCE_CATALOG_FILES: dict[str, str] = {
    "am": "x86_64-apps",
    "amutils": "x86_64-amutils",
    "busybox": "x86_64-busybox",
    "coreutilsh": "x86_64-coreutilsh",
    "python": "x86_64-python",
    "appbundle": "x86_64-appbundle",
    "soarpkg": "x86_64-soarpkg",
}

# Format slices of the AM database. Not third-party sources.
FORMAT_LIST_FILES: dict[str, str] = {
    "appimage": "x86_64-appimages",
    "portable": "x86_64-portable",
}

PACKAGE_FORMATS: tuple[str, ...] = ("appimage", "portable")

# Website categories whose membership is a stats-file marker, not a catalog line.
UNSUPPORTED_FORMAT_COLLECTIONS: tuple[str, ...] = (
    "appimages",
    "portable",
    "portable-cli",
    "portable-desktop",
    "appimage-on-the-fly",
)

METAPACKAGE_NAMES: tuple[str, ...] = ("kdegames", "kdeutils", "node", "platform-tools")

# Slugs and English labels from the AM category list. Format collections are
# omitted; they are filters. ``am-utils`` is the website category of helper
# mentions inside the AM database, not the amutils third-party database.
SOFTWARE_CATEGORIES: tuple[tuple[str, str], ...] = (
    ("ai", "AI"),
    ("am-utils", "AM utilities"),
    ("android", "Android"),
    ("audio", "Audio"),
    ("comic", "Comic"),
    ("command-line", "Command Line"),
    ("communication", "Communication"),
    ("disk", "Disk"),
    ("education", "Education"),
    ("emulator", "Emulator"),
    ("file-manager", "File Manager"),
    ("finance", "Finance"),
    ("game", "Game"),
    ("gnome", "GNOME"),
    ("graphic", "Graphic"),
    ("internet", "Internet"),
    ("kde", "KDE"),
    ("metapackages", "Metapackages"),
    ("office", "Office"),
    ("password", "Password"),
    ("steam", "Steam"),
    ("system-monitor", "System Monitor"),
    ("video", "Video"),
    ("virtual-machine", "Virtual Machine"),
    ("wallet", "Wallet"),
    ("web-app", "Web App"),
    ("web-browser", "Web Browser"),
    ("wine", "Wine"),
    ("youtube", "YouTube"),
)

SOFTWARE_SLUGS: tuple[str, ...] = tuple(slug for slug, _label in SOFTWARE_CATEGORIES)

# DeckDepot major tabs that group AM categories. They are not extra AM names.
MAJOR_SLUGS: tuple[str, ...] = ("utility", "audiovideo", "graphics", "development")

UTILITY_SLUGS = frozenset({"file-manager", "disk", "system-monitor", "password"})
NAME_SUBSTRING_SLUGS = frozenset({"gnome", "kde", "password", "steam", "wallet", "wine", "youtube"})

BROWSE_SLUGS = frozenset({*SOFTWARE_SLUGS, *MAJOR_SLUGS, EVERYTHING_SLUG})

_ENTRY_RE = re.compile(r"^◆\s*([A-Za-z0-9][A-Za-z0-9._+-]{0,80})\s*:\s*(.*)$")

_AI_KEYWORDS = re.compile(
    r"chatgpt|openai|gemini|claude|copilot|perplexity| meta |grok|anthropic|"
    r"huggingface|mistral|cohere|together|replicate|cursor|codeium|tabnine|"
    r"replit|windsurf|midjourney|firefly|canva|runway|leonardo|synthesia|"
    r"elevenlabs|heygen|zapier|z\.ai|clickup|grammarly|ollama|lmstudio|"
    r"openwebui|salesforce|watsonx",
    re.I,
)
_ANDROID = re.compile(r"android|platform-tools", re.I)
_AUDIO = re.compile(r"audio|matroska|music|midi|mp3|opus|soundboard", re.I)
_COMIC = re.compile(r"comic|manga|anime", re.I)
_COMMAND_LINE = re.compile(
    r"command-line|command line| cli |-cli|terminal |\"am-utils\"|\"node\"|\"platform-tools\"",
    re.I,
)
_COMMUNICATION = re.compile(
    r"communication|voip|messenger|whatsapp|mastodon|skype|chat client|"
    r"social network|conferencing|discord|email|telegram",
    re.I,
)
_DISK = re.compile(r"disk|partition|usb drive", re.I)
_EDUCATION = re.compile(
    r"education|productivity|study|dictionar|math| book | books | book-|"
    r"ebook|e-book|space simulator|planetarium|astronom|university",
    re.I,
)
_EDUCATION_EXCLUDE = re.compile(r"game|manga|anime", re.I)
_EMULATOR = re.compile(r"emulator", re.I)
_EMULATOR_EXCLUDE = re.compile(r"terminal emulator", re.I)
_FILE_MANAGER = re.compile(
    r"file-manager|file manager|file browse|browse.*file|file explore|explore.*file",
    re.I,
)
_FINANCE = re.compile(r"finance|wallet|money", re.I)
_GAME = re.compile(
    r"game|arcade|steam|wine|strateg|solitaire|poker|chess|puzzle|pinball|"
    r"adventure|playstation|xbox|nintendo|minecraft|doom",
    re.I,
)
_GRAPHIC = re.compile(
    r"drawing|jpg|duplicated images|gimp|inkscape|converseen|visipics|"
    r"imagemagick|photo|svg|png|autocad|blender|3D modeling|paint|pixel|wallpaper",
    re.I,
)
_INTERNET = re.compile(r"internet|vpn|torrent|p2p", re.I)
_OFFICE = re.compile(r"office|document|pdf|docx|reader|spreadsheet", re.I)
_OFFICE_EXCLUDE = re.compile(r"manga|comic", re.I)
_SYSTEM_MONITOR = re.compile(
    r"system-monitor|system monitor|task manager|system resource|system resources|linux processes",
    re.I,
)
_VIDEO = re.compile(r"video|stream|media player|film|movies|netflix|iptv", re.I)
_VIRTUAL_MACHINE = re.compile(r"virtual-machine|virtual machine|virtualization|qemu", re.I)
_WEB_APP = re.compile(r"web-app|webapp|web app", re.I)
_WEB_BROWSER = re.compile(
    r"web-browser|web.*browser|browser.*web|google-chrome|firefox.*browser|"
    r"firefox.*fork|fork.*firefox|safari|microsoft-edge|opera.*browser|"
    r"brave.*browser|vivaldi.*browser|arc.*browser|tor.*browser|chromium|"
    r"duckduckgo.*browser|orion.*browser|waterfox|librewolf|palemoon|seamonkey|"
    r"maxthon|yandex.*browser|uc.*browser|qq.*browser|baidu.*browser|kiwi|"
    r"puffin|dolphin.*browser|epic.*browser|avast.*browser|avg.*browser|midori|"
    r"falkon|konqueror|gnome.*web.*browser|floorp|zen.*browser|slimjet|"
    r"srware.*iron|comodo.*dragon|sleipnir|lunascape|otter.*browser|basilisk|"
    r"icecat|kmeleon|k-melon|netscape|mosaic.*browser",
    re.I,
)
_WEB_BROWSER_EXCLUDE = re.compile(r"embedded web browser video player", re.I)


def enabled_sources(module_text: str = "") -> list[str]:
    """Sources whose install flag this AppMan build will accept."""
    enabled = set(BASE_SOURCES)
    text = module_text or ""
    for source, marker in OPTIONAL_MODULE_MARKERS.items():
        if marker in text:
            enabled.add(source)
    return [source for source in SOURCE_ORDER if source in enabled]


def is_appman_browse_slug(slug: str) -> bool:
    return slug in BROWSE_SLUGS


def normalize_source_filter(raw: str | None) -> str:
    from deckdepot.appman_ids import validate_source_id

    value = str(raw or "").strip().lower()
    if value in {"", "all"}:
        return "all"
    return validate_source_id(value)


def normalize_format_filter(raw: str | None) -> str:
    value = str(raw or "").strip().lower()
    if value in {"", "all"}:
        return "all"
    if value not in PACKAGE_FORMATS:
        raise EngineError("INVALID_ARGUMENT", "unsupported AppMan package format")
    return value


def coerce_page(page: int | str | None) -> int:
    try:
        value = int(page or 1)
    except (TypeError, ValueError) as exc:
        raise EngineError("INVALID_ARGUMENT", "page must be a number") from exc
    if value < 1:
        raise EngineError("INVALID_ARGUMENT", "page must be at least 1")
    if value > 10000:
        raise EngineError("INVALID_ARGUMENT", "page is too large")
    return value


def parse_catalog_text(text: str) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    current_id = ""
    current_summary = ""

    def flush() -> None:
        nonlocal current_id, current_summary
        if current_id:
            rows.append((current_id, current_summary.strip()))
        current_id = ""
        current_summary = ""

    for raw in (text or "").splitlines():
        stripped = raw.strip()
        match = _ENTRY_RE.match(stripped)
        if match:
            flush()
            current_id = match.group(1)
            current_summary = match.group(2).strip()
            continue
        if current_id and (raw.startswith(" ") or raw.startswith("\t")) and stripped:
            current_summary = f"{current_summary} {stripped}".strip()
    flush()
    return rows


def _is_metapackage(app_id: str, summary: str) -> bool:
    if app_id in METAPACKAGE_NAMES:
        return True
    return any(f'"{name}"' in summary for name in METAPACKAGE_NAMES)


def classify_catalog_entry(app_id: str, summary: str) -> list[str]:
    """Return browse slugs for one catalog line.

    An application may belong to several categories. Format names are never
    returned from this function.
    """
    line = f"◆ {app_id} : {summary or ''}"
    found: list[str] = []

    def add(slug: str, matched: bool) -> None:
        if matched and slug not in found:
            found.append(slug)

    add("ai", "AI" in line or bool(_AI_KEYWORDS.search(line)))
    add("am-utils", '"am-utils"' in line.lower())
    add("android", bool(_ANDROID.search(line)))
    add("audio", bool(_AUDIO.search(line)))
    add("comic", bool(_COMIC.search(line)))
    add("command-line", bool(_COMMAND_LINE.search(line)))
    add("communication", bool(_COMMUNICATION.search(line)))
    add("disk", bool(_DISK.search(line)))
    add("education", bool(_EDUCATION.search(line) and not _EDUCATION_EXCLUDE.search(line)))
    add("emulator", bool(_EMULATOR.search(line) and not _EMULATOR_EXCLUDE.search(line)))
    add("file-manager", bool(_FILE_MANAGER.search(line)))
    add("finance", bool(_FINANCE.search(line)))
    add("game", bool(_GAME.search(line)))
    add("graphic", bool(_GRAPHIC.search(line)))
    add("internet", bool(_INTERNET.search(line)))
    add("metapackages", _is_metapackage(app_id, summary or ""))
    add("office", bool(_OFFICE.search(line) and not _OFFICE_EXCLUDE.search(line)))
    add("system-monitor", bool(_SYSTEM_MONITOR.search(line)))
    add("video", bool(_VIDEO.search(line)))
    add("virtual-machine", bool(_VIRTUAL_MACHINE.search(line)))
    add("web-app", bool(_WEB_APP.search(line)))
    add("web-browser", bool(_WEB_BROWSER.search(line) and not _WEB_BROWSER_EXCLUDE.search(line)))
    lowered = line.lower()
    for slug in NAME_SUBSTRING_SLUGS:
        add(slug, slug in lowered)
    if any(slug in UTILITY_SLUGS for slug in found):
        add("utility", True)
    if "audio" in found or "video" in found:
        add("audiovideo", True)
    if "graphic" in found:
        add("graphics", True)
    if DEVELOPMENT_SUMMARY_RE.search(summary or ""):
        add("development", True)
    return found


def package_format_for(app_id: str, source_id: str, appimage_ids: set[str], portable_ids: set[str]) -> str | None:
    """Format is membership in an AM format list. Other sources stay unset."""
    if source_id != "am":
        return None
    in_appimage = app_id in appimage_ids
    in_portable = app_id in portable_ids
    if in_appimage and in_portable:
        return None
    if in_appimage:
        return "appimage"
    if in_portable:
        return "portable"
    return None


def index_catalog_files(files: dict[str, str], enabled: list[str] | set[str]) -> list[dict[str, object]]:
    """Build deduped catalog rows from filename -> text.

    ``enabled`` is the set of sources the CLI can install. Catalog files for
    other sources are ignored even if they are still on disk.
    """
    allowed = set(enabled)
    appimage_ids = {app_id for app_id, _summary in parse_catalog_text(files.get(FORMAT_LIST_FILES["appimage"], ""))}
    portable_ids = {app_id for app_id, _summary in parse_catalog_text(files.get(FORMAT_LIST_FILES["portable"], ""))}
    seen: set[tuple[str, str]] = set()
    rows: list[dict[str, object]] = []

    def add_row(source_id: str, app_id: str, summary: str) -> None:
        if source_id not in allowed:
            return
        key = (source_id, app_id)
        if key in seen:
            return
        seen.add(key)
        rows.append(
            {
                "appId": app_id,
                "summary": summary,
                "sourceId": source_id,
                "packageFormat": package_format_for(app_id, source_id, appimage_ids, portable_ids),
                "categories": classify_catalog_entry(app_id, summary),
            }
        )

    if "am" in allowed:
        listed: set[str] = set()
        for app_id, summary in parse_catalog_text(files.get(SOURCE_CATALOG_FILES["am"], "")):
            listed.add(app_id)
            add_row("am", app_id, summary)
        for fmt, ids in (("appimage", appimage_ids), ("portable", portable_ids)):
            filename = FORMAT_LIST_FILES[fmt]
            for app_id, summary in parse_catalog_text(files.get(filename, "")):
                if app_id in listed:
                    continue
                add_row("am", app_id, summary)
                listed.add(app_id)

    for source_id in SOURCE_ORDER:
        if source_id == "am" or source_id not in allowed:
            continue
        filename = SOURCE_CATALOG_FILES[source_id]
        for app_id, summary in parse_catalog_text(files.get(filename, "")):
            add_row(source_id, app_id, summary)
    return rows


def filter_catalog_rows(
    rows: list[dict[str, object]],
    slug: str,
    source_id: str = "all",
    package_format: str = "all",
) -> list[dict[str, object]]:
    selected: list[dict[str, object]] = []
    for row in rows:
        if source_id != "all" and row.get("sourceId") != source_id:
            continue
        if package_format != "all" and row.get("packageFormat") != package_format:
            continue
        if slug != EVERYTHING_SLUG:
            categories = row.get("categories") or []
            if slug not in categories:
                continue
        selected.append(row)
    return selected


def paginate_rows(
    rows: list[dict[str, object]],
    page: int,
    page_size: int = PAGE_SIZE,
) -> tuple[list[dict[str, object]], int, int]:
    """Return one page without dropping the tail.

    ``total`` is the full match count. ``total_pages`` is at least 1.
    """
    total = len(rows)
    total_pages = max(1, math.ceil(total / page_size)) if page_size else 1
    if page > total_pages:
        return [], total, total_pages
    start = (page - 1) * page_size
    return rows[start : start + page_size], total, total_pages
