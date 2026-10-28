"""AppMan category mapping.

Store slugs and token tables live in ``deckdepot.categories`` so Flatpak
and AppMan stay aligned. This module keeps the names AppMan already imports.
"""

from __future__ import annotations

from deckdepot.categories import (
    CATEGORY_IDS as DECKDEPOT_SLUGS,
    desktop_tokens,
    normalize_appman_categories as normalize_categories,
    slug_from_text,
    slugs_for_tokens,
)

__all__ = [
    "DECKDEPOT_SLUGS",
    "normalize_categories",
    "slug_from_desktop_categories",
    "slug_from_text",
]


def slug_from_desktop_categories(raw: str) -> str | None:
    slugs = slugs_for_tokens(desktop_tokens(raw))
    return slugs[0] if slugs else None
