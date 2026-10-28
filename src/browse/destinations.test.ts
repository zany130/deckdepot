import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APPMAN_EVERYTHING_ID,
  APPMAN_FORMAT_FILTERS,
  APPMAN_SOFTWARE_CATEGORIES,
  cycleDestination,
  defaultDestination,
  destinationById,
  destinationsFor,
  flatpakIndexSections,
  isBrowseCacheFresh,
  resolveDestination,
} from "./destinations";

const FLATPAK_TAB_IDS = [
  "trending",
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
  "all-categories",
];

const SHARED_CATEGORY_IDS = ["game", "utility", "audiovideo", "graphics", "development"];

const APPMAN_TAB_IDS = [
  ...SHARED_CATEGORY_IDS,
  "emulator",
  "gnome",
  "kde",
  "metapackages",
  "wine",
  "all-categories",
];

describe("browse destinations", () => {
  it("keeps Trending with the main Flatpak categories", () => {
    const flatpak = destinationsFor("flatpak");
    assert.deepEqual(
      flatpak.map((item) => item.id),
      FLATPAK_TAB_IDS
    );
    assert.equal(flatpak[0]?.flathubCollection, "trending");
    assert.equal(flatpak.find((item) => item.id === "all-categories")?.kind, "index");
    assert.deepEqual(
      flatpak.filter((item) => item.kind === "category" && item.providers.includes("appman")).map((item) => item.id),
      SHARED_CATEGORY_IDS
    );
    assert.equal(flatpak.find((item) => item.id === "office")?.label, "Productivity");
    assert.equal(flatpak.find((item) => item.id === "development")?.label, "Developer Tools");
    assert.equal(flatpak.find((item) => item.id === "network")?.label, "Networking");
    assert.equal(flatpak.find((item) => item.id === "graphics")?.label, "Graphics & Photography");
    assert.equal(destinationById("ai")?.label, "AI");
    assert.equal(destinationById("ai")?.flathubCategory, false);
    assert.equal(destinationById("finance")?.label, "Finance");
    assert.equal(flatpak.some((item) => item.id === "ai" || item.id === "finance"), false);
    assert.equal(flatpak.some((item) => item.id === "other" || item.id === "healthfitness"), false);
  });

  it("hides collections the provider cannot support", () => {
    const appman = destinationsFor("appman");
    assert.equal(appman.some((item) => item.kind === "collection"), false);
    assert.deepEqual(
      appman.map((item) => item.id),
      APPMAN_TAB_IDS
    );
    assert.equal(appman.find((item) => item.id === "all-categories")?.kind, "index");
    assert.equal(appman.some((item) => item.id === "network" || item.id === "office"), false);
  });

  it("keeps collection ids distinct from category ids", () => {
    const ids = destinationsFor("flatpak").map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("falls back when the selected destination is not on the provider", () => {
    assert.equal(defaultDestination("flatpak"), "trending");
    assert.equal(defaultDestination("appman"), "game");
    assert.equal(resolveDestination("appman", "trending"), "game");
    assert.equal(resolveDestination("flatpak", "game"), "game");
    assert.equal(resolveDestination("flatpak", "new-arrivals"), "trending");
    assert.equal(resolveDestination("flatpak", "missing"), "trending");
    assert.equal(resolveDestination("appman", null), "game");
  });

  it("cycles bumpers through the visible tabs, including the ends", () => {
    const ids = destinationsFor("flatpak").map((item) => item.id);
    assert.equal(cycleDestination(ids, "trending", -1), "all-categories");
    assert.equal(cycleDestination(ids, "all-categories", 1), "trending");
    assert.equal(cycleDestination(ids, "trending", 1), "game");
    const appman = destinationsFor("appman").map((item) => item.id);
    assert.equal(cycleDestination(appman, "game", -1), "all-categories");
  });

  it("opens the overflow Flatpak collections from All Categories", () => {
    const discovery = flatpakIndexSections().find((section) => section.title === "Discovery");
    assert.deepEqual(
      discovery?.entries.map((item) => item.id),
      ["new-arrivals", "recently-updated", "popular"]
    );
    assert.equal(destinationById("new-arrivals")?.flathubCollection, "recently-added");
    assert.equal(destinationById("popular")?.flathubCollection, "popular");
    const categories = flatpakIndexSections().find((section) => section.title === "Categories");
    assert.equal(categories?.entries.some((item) => item.id === "ai"), true);
    assert.equal(categories?.entries.some((item) => item.id === "finance"), true);
    assert.equal(destinationsFor("flatpak").some((item) => item.bar === false), false);
  });

  it("keeps AppMan formats and sources out of the category list", () => {
    const ids = APPMAN_SOFTWARE_CATEGORIES.map((item) => item.id);
    for (const required of ["emulator", "gnome", "kde", "metapackages", "wine", "game"]) {
      assert.equal(ids.includes(required), true, required);
    }
    for (const formatId of ["appimages", "portable", "portable-cli", "portable-desktop", "appimage-on-the-fly"]) {
      assert.equal(ids.includes(formatId), false, formatId);
    }
    assert.equal(ids.includes(APPMAN_EVERYTHING_ID), false);
    assert.deepEqual(
      APPMAN_FORMAT_FILTERS.map((item) => item.id),
      ["all", "appimage", "portable"]
    );
  });

  it("expires collection cache sooner than a fresh category cache", () => {
    const now = 1_000_000;
    assert.equal(isBrowseCacheFresh(now - 60_000, now, 3 * 60 * 1000), true);
    assert.equal(isBrowseCacheFresh(now - 4 * 60 * 1000, now, 3 * 60 * 1000), false);
    assert.equal(isBrowseCacheFresh(now - 4 * 60 * 1000, now, 10 * 60 * 1000), true);
  });
});
