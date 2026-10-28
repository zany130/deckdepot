import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cycleDestination,
  defaultDestination,
  destinationsFor,
  isBrowseCacheFresh,
  resolveDestination,
} from "./destinations";

const CATEGORY_IDS = [
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
];

describe("browse destinations", () => {
  it("lists Flathub collections before categories", () => {
    const flatpak = destinationsFor("flatpak");
    assert.deepEqual(
      flatpak.slice(0, 4).map((item) => [item.id, item.kind, item.flathubCollection]),
      [
        ["new-arrivals", "collection", "recently-added"],
        ["recently-updated", "collection", "recently-updated"],
        ["trending", "collection", "trending"],
        ["popular", "collection", "popular"],
      ]
    );
    assert.deepEqual(
      flatpak.filter((item) => item.kind === "category").map((item) => item.id),
      CATEGORY_IDS
    );
  });

  it("hides collections the provider cannot support", () => {
    const appman = destinationsFor("appman");
    assert.equal(appman.some((item) => item.kind === "collection"), false);
    assert.deepEqual(
      appman.map((item) => item.id),
      CATEGORY_IDS
    );
  });

  it("keeps collection ids distinct from category ids", () => {
    const ids = destinationsFor("flatpak").map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("falls back when the selected destination is not on the provider", () => {
    assert.equal(defaultDestination("flatpak"), "new-arrivals");
    assert.equal(defaultDestination("appman"), "game");
    assert.equal(resolveDestination("appman", "trending"), "game");
    assert.equal(resolveDestination("flatpak", "game"), "game");
    assert.equal(resolveDestination("flatpak", "missing"), "new-arrivals");
    assert.equal(resolveDestination("appman", null), "game");
  });

  it("cycles bumpers through the visible tabs, including the ends", () => {
    const ids = destinationsFor("flatpak").map((item) => item.id);
    assert.equal(cycleDestination(ids, "new-arrivals", -1), "other");
    assert.equal(cycleDestination(ids, "other", 1), "new-arrivals");
    assert.equal(cycleDestination(ids, "trending", 1), "popular");
    const appman = destinationsFor("appman").map((item) => item.id);
    assert.equal(cycleDestination(appman, "game", -1), "other");
  });

  it("expires collection cache sooner than a fresh category cache", () => {
    const now = 1_000_000;
    assert.equal(isBrowseCacheFresh(now - 60_000, now, 3 * 60 * 1000), true);
    assert.equal(isBrowseCacheFresh(now - 4 * 60 * 1000, now, 3 * 60 * 1000), false);
    assert.equal(isBrowseCacheFresh(now - 4 * 60 * 1000, now, 10 * 60 * 1000), true);
  });
});
