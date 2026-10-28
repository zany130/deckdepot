"""AppMan catalog sources, categories, formats, and pagination."""

from __future__ import annotations

import unittest

from deckdepot.appman_ids import SOURCE_FLAGS, source_from_text, source_mutation_args
from deckdepot.appman_taxonomy import (
    PAGE_SIZE,
    SOFTWARE_SLUGS,
    UNSUPPORTED_FORMAT_COLLECTIONS,
    classify_catalog_entry,
    enabled_sources,
    filter_catalog_rows,
    index_catalog_files,
    normalize_format_filter,
    paginate_rows,
)
from deckdepot.errors import EngineError


def _line(app_id: str, summary: str) -> str:
    return f"◆ {app_id} : {summary}\n"


class AppmanTaxonomyTests(unittest.TestCase):
    def test_gnome_kde_wine_emulator_and_metapackages(self) -> None:
        gnome = classify_catalog_entry(
            "baobab",
            "A graphical directory tree analyzer for the GNOME desktop environment.",
        )
        self.assertIn("gnome", gnome)
        self.assertNotIn("kde", gnome)

        kde_game = classify_catalog_entry(
            "bomber",
            'Arcade spaceship game. This is part of "kdegames".',
        )
        self.assertIn("kde", kde_game)
        self.assertIn("game", kde_game)
        self.assertIn("metapackages", kde_game)

        self.assertIn("metapackages", classify_catalog_entry("kdegames", "KDE games collection."))
        self.assertIn("wine", classify_catalog_entry("bottles", "Manage wine prefixes and run Windows software."))
        self.assertIn(
            "emulator",
            classify_catalog_entry("snes9x", "A Super Nintendo emulator."),
        )
        terminal = classify_catalog_entry("foot", "A fast terminal emulator.")
        self.assertNotIn("emulator", terminal)
        self.assertIn("command-line", terminal)

    def test_format_names_are_not_categories(self) -> None:
        slugs = classify_catalog_entry(
            "sample",
            "Portable AppImage built on the fly for the desktop CLI.",
        )
        for name in UNSUPPORTED_FORMAT_COLLECTIONS:
            self.assertNotIn(name, slugs)
        self.assertNotIn("appimage", slugs)
        for name in UNSUPPORTED_FORMAT_COLLECTIONS:
            self.assertNotIn(name, SOFTWARE_SLUGS)

    def test_format_comes_from_list_membership_not_source_or_summary(self) -> None:
        files = {
            "x86_64-apps": _line("firefox", "Web browser.") + _line("foot", "A fast terminal emulator."),
            "x86_64-appimages": _line("firefox", "Web browser.") + _line("onlyimg", "Listed only as an AppImage."),
            "x86_64-portable": _line("foot", "A fast terminal emulator."),
            "x86_64-python": _line(
                "python3.12",
                "Interactive language [AppImage, build cp312]. To install it use the --python flag.",
            ),
            "x86_64-busybox": _line("ls", "List directory contents. To install it use the --busybox flag."),
            "x86_64-soarpkg": _line("curl", "URL tool. To install it use the --soarpkg flag."),
        }
        rows = index_catalog_files(files, enabled_sources(""))
        by_key = {(row["sourceId"], row["appId"]): row for row in rows}
        self.assertEqual(by_key[("am", "firefox")]["packageFormat"], "appimage")
        self.assertEqual(by_key[("am", "foot")]["packageFormat"], "portable")
        self.assertEqual(by_key[("am", "onlyimg")]["packageFormat"], "appimage")
        self.assertIsNone(by_key[("python", "python3.12")]["packageFormat"])
        self.assertIsNone(by_key[("busybox", "ls")]["packageFormat"])
        self.assertNotIn(("soarpkg", "curl"), by_key)

    def test_optional_sources_follow_install_module_markers(self) -> None:
        self.assertEqual(
            enabled_sources(""),
            ["am", "amutils", "busybox", "coreutilsh", "python"],
        )
        enabled = enabled_sources("AM-SAMPLE-AppBundle\nAM-SAMPLE-soarpkg\n")
        self.assertIn("appbundle", enabled)
        self.assertIn("soarpkg", enabled)

    def test_same_name_in_two_databases_stays_distinct(self) -> None:
        files = {
            "x86_64-apps": _line("curl", "AM build of curl."),
            "x86_64-busybox": _line("curl", "BusyBox curl. To install it use the --busybox flag."),
            "x86_64-python": (
                _line("python3.12", "Build cp312. To install it use the --python flag.")
                + _line("python3.12", "Build cp312-musl. To install it use the --python flag.")
            ),
        }
        rows = index_catalog_files(files, enabled_sources(""))
        curl = [row for row in rows if row["appId"] == "curl"]
        self.assertEqual(sorted(row["sourceId"] for row in curl), ["am", "busybox"])
        python_rows = [row for row in rows if row["appId"] == "python3.12"]
        self.assertEqual(len(python_rows), 1)
        self.assertEqual(python_rows[0]["summary"], "Build cp312. To install it use the --python flag.")

    def test_source_and_format_filters(self) -> None:
        files = {
            "x86_64-apps": _line("firefox", "Web browser.") + _line("foot", "A portable terminal."),
            "x86_64-appimages": _line("firefox", "Web browser."),
            "x86_64-portable": _line("foot", "A portable terminal."),
            "x86_64-busybox": _line("wget", "BusyBox wget. To install it use the --busybox flag."),
        }
        rows = index_catalog_files(files, enabled_sources(""))
        appimages = filter_catalog_rows(rows, "everything", "all", "appimage")
        self.assertEqual([row["appId"] for row in appimages], ["firefox"])
        busybox = filter_catalog_rows(rows, "everything", "busybox", "all")
        self.assertEqual([row["appId"] for row in busybox], ["wget"])
        hidden = filter_catalog_rows(rows, "everything", "busybox", "appimage")
        self.assertEqual(hidden, [])

    def test_pagination_keeps_results_past_the_old_40_cap(self) -> None:
        rows = [
            {
                "appId": f"app-{index}",
                "sourceId": "am",
                "packageFormat": None,
                "categories": ["game"],
                "summary": "game",
            }
            for index in range(90)
        ]
        self.assertGreater(PAGE_SIZE, 40)
        first, total, pages = paginate_rows(rows, 1)
        second, total_again, _pages_again = paginate_rows(rows, 2)
        self.assertEqual(total, 90)
        self.assertEqual(total_again, 90)
        self.assertEqual(len(first), PAGE_SIZE)
        self.assertEqual(len(second), 90 - PAGE_SIZE)
        self.assertEqual(pages, 2)
        self.assertEqual(len(first) + len(second), 90)
        empty, still, still_pages = paginate_rows(rows, 3)
        self.assertEqual(empty, [])
        self.assertEqual(still, 90)
        self.assertEqual(still_pages, 2)

    def test_install_flags_match_the_source(self) -> None:
        self.assertEqual(source_mutation_args("install", "firefox", "am"), ["-y", "-i", "firefox"])
        self.assertEqual(
            source_mutation_args("install", "7z", "amutils"),
            ["-y", "-i", "--amutils", "7z"],
        )
        self.assertEqual(
            source_mutation_args("update", "ls", "busybox"),
            ["-y", "-u", "--busybox", "ls"],
        )
        self.assertEqual(
            source_mutation_args("uninstall", "arch", "coreutilsh"),
            ["-y", "-R", "--coreutilsh", "arch"],
        )
        self.assertEqual(
            source_mutation_args("install", "python3.12", "python"),
            ["-y", "-i", "--python", "python3.12"],
        )
        self.assertEqual(SOURCE_FLAGS["appbundle"], ("--appbundle",))
        self.assertEqual(SOURCE_FLAGS["soarpkg"], ("--soarpkg",))
        self.assertEqual(source_from_text("Install with --amutils or .amutils"), "amutils")
        with self.assertRaises(EngineError):
            normalize_format_filter("appimage-on-the-fly")


if __name__ == "__main__":
    unittest.main()
