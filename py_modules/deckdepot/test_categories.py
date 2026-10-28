"""Category mapping tests. These do not call Flathub or AppMan."""

from __future__ import annotations

import sys
import types
import unittest

if "decky" not in sys.modules:
    decky = types.ModuleType("decky")
    decky.logger = types.SimpleNamespace(
        info=lambda *_args, **_kwargs: None,
        error=lambda *_args, **_kwargs: None,
        warning=lambda *_args, **_kwargs: None,
    )
    sys.modules["decky"] = decky

from deckdepot.categories import (
    CATEGORY_IDS,
    normalize_appman_categories,
    slugs_for_tokens,
)
from deckdepot.flatpak_catalog import _parse_appstream_details


EXPECTED = (
    "game",
    "utility",
    "audiovideo",
    "graphics",
    "network",
    "office",
    "development",
    "education",
    "science",
    "system",
    "healthfitness",
    "other",
)


class CategoryTests(unittest.TestCase):
    def test_category_ids(self) -> None:
        self.assertEqual(CATEGORY_IDS, EXPECTED)

    def test_existing_and_new_tokens(self) -> None:
        self.assertEqual(slugs_for_tokens(["Game"]), ["game"])
        self.assertEqual(slugs_for_tokens(["Utility"]), ["utility"])
        self.assertEqual(slugs_for_tokens(["AudioVideo"]), ["audiovideo"])
        self.assertEqual(slugs_for_tokens(["Graphics"]), ["graphics"])
        self.assertEqual(slugs_for_tokens(["Network"]), ["network"])
        self.assertEqual(slugs_for_tokens(["Office"]), ["office"])
        self.assertEqual(slugs_for_tokens(["Development"]), ["development"])
        self.assertEqual(slugs_for_tokens(["Education"]), ["education"])
        self.assertEqual(slugs_for_tokens(["Science"]), ["science"])
        self.assertEqual(slugs_for_tokens(["System"]), ["system"])
        self.assertEqual(slugs_for_tokens(["Settings"]), ["system"])
        self.assertEqual(slugs_for_tokens(["Health"]), ["healthfitness"])
        self.assertEqual(slugs_for_tokens(["education"]), ["education"])

    def test_multi_category(self) -> None:
        self.assertEqual(
            slugs_for_tokens(["Education", "Game", "Player"]),
            ["game", "audiovideo", "education"],
        )

    def test_unknown_token_is_not_a_slug(self) -> None:
        self.assertEqual(slugs_for_tokens(["NotARealCategory"]), [])

    def test_desktop_beats_summary_keywords(self) -> None:
        slugs, native = normalize_appman_categories(
            summary="a fun game",
            desktop_categories="Office;",
        )
        self.assertEqual(slugs, ["office"])
        self.assertEqual(native, ["Office"])

    def test_unknown_desktop_does_not_guess_from_summary(self) -> None:
        slugs, native = normalize_appman_categories(
            summary="a fun game",
            desktop_categories="FooBar;",
        )
        self.assertEqual(slugs, [])
        self.assertEqual(native, ["FooBar"])

    def test_summary_fallback_and_unclassified(self) -> None:
        slugs, _native = normalize_appman_categories(summary="A puzzle game")
        self.assertEqual(slugs, ["game"])
        empty, _native = normalize_appman_categories(summary="A quiet afternoon helper")
        self.assertEqual(empty, [])

    def test_appstream_keeps_multiple_known_slugs(self) -> None:
        parsed = _parse_appstream_details(
            "Name: Example\nCategories:\n- Game\n- Education\n- NotARealCategory\n"
        )
        self.assertEqual(parsed["categories"], ["game", "education"])
        self.assertEqual(
            parsed["nativeCategories"],
            ["Game", "Education", "NotARealCategory"],
        )


if __name__ == "__main__":
    unittest.main()
