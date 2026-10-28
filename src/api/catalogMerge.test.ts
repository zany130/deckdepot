import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeBrowseApps } from "./catalogMerge";
import type { CatalogAppSummary } from "../types/catalog";
import { catalogKey } from "../types/provider";

function app(partial: Partial<CatalogAppSummary> & Pick<CatalogAppSummary, "appId">): CatalogAppSummary {
  return {
    provider: "flatpak",
    name: partial.name ?? partial.appId,
    categories: [],
    installedState: "unknown",
    ...partial,
  };
}

const generic = app({
  appId: "org.example.Croissant",
  name: "En Croissant",
  remoteName: "flathub",
  sourceLabel: "Flathub",
  origin: "flathub",
  branch: "stable",
  summary: "Chess study",
  projectLicense: "GPL-3.0-or-later",
  verificationVerified: true,
  iconUrl: "https://example.test/icon.png",
});

describe("mergeBrowseApps", () => {
  it("keeps a local Flathub install and drops the generic catalog row", () => {
    const local = app({
      appId: "org.example.Croissant",
      name: "En Croissant",
      remoteName: "flathub",
      sourceLabel: "Flathub",
      origin: "flathub",
      installationScope: "user",
      arch: "x86_64",
      branch: "stable",
      ref: "app/org.example.Croissant/x86_64/stable",
      installedState: "installed",
    });
    const merged = mergeBrowseApps([local, generic]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].installationScope, "user");
    assert.equal(merged[0].ref, local.ref);
    assert.equal(merged[0].installedState, "installed");
    assert.equal(merged[0].projectLicense, "GPL-3.0-or-later");
    assert.equal(merged[0].verificationVerified, true);
    assert.equal(merged[0].summary, "Chess study");
    assert.equal(catalogKey(merged[0]), catalogKey(local));
  });

  it("collapses the same third-party app listed in user and system", () => {
    const user = app({
      appId: "io.github.realgarit.PKHeX-Avalonia",
      name: "PKHeX-Avalonia",
      remoteName: "flatpark",
      sourceLabel: "FlatPark",
      installationScope: "user",
      arch: "x86_64",
      branch: "stable",
    });
    const system = app({
      ...user,
      installationScope: "system",
    });
    const http = app({
      ...generic,
      appId: user.appId,
      name: user.name,
    });
    const merged = mergeBrowseApps([user, http, system]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].installationScope, "user");
    assert.equal(merged[0].remoteName, "flatpark");
    assert.equal(merged[0].summary, http.summary);
  });

  it("keeps the installed scope when user and system both list the app", () => {
    const user = app({
      appId: "io.github.realgarit.PKHeX-Avalonia",
      name: "PKHeX-Avalonia",
      remoteName: "flatpark",
      sourceLabel: "FlatPark",
      installationScope: "user",
      arch: "x86_64",
      branch: "stable",
    });
    const system = app({
      ...user,
      installationScope: "system",
      installedState: "installed",
      ref: "app/io.github.realgarit.PKHeX-Avalonia/x86_64/stable",
    });
    const merged = mergeBrowseApps([user, system]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].installationScope, "system");
    assert.equal(merged[0].installedState, "installed");
    assert.equal(merged[0].ref, system.ref);
  });

  it("keeps different branches and different app ids that share a name", () => {
    const stable = app({
      appId: "org.example.Mod",
      name: "Amethyst Mod Manager",
      remoteName: "flathub",
      sourceLabel: "Flathub",
      installationScope: "user",
      arch: "x86_64",
      branch: "stable",
    });
    const beta = { ...stable, branch: "beta" };
    const other = app({
      appId: "org.example.Other",
      name: "Amethyst Mod Manager",
      remoteName: "flathub",
      sourceLabel: "Flathub",
      installationScope: "user",
      arch: "x86_64",
      branch: "stable",
    });
    const merged = mergeBrowseApps([stable, beta, other]);
    assert.equal(merged.length, 3);
    assert.deepEqual(
      merged.map((item) => `${item.appId}:${item.branch}`),
      ["org.example.Mod:stable", "org.example.Mod:beta", "org.example.Other:stable"]
    );
  });

  it("does not treat a third-party remote as the same install as a scoped Flathub remote", () => {
    const flathub = app({
      appId: "org.example.Mod",
      name: "Amethyst Mod Manager",
      remoteName: "flathub",
      sourceLabel: "Flathub",
      installationScope: "user",
      arch: "x86_64",
      branch: "stable",
    });
    const fedora = app({
      appId: "org.example.Mod",
      name: "Amethyst Mod Manager",
      remoteName: "fedora",
      sourceLabel: "Fedora",
      installationScope: "user",
      arch: "x86_64",
      branch: "stable",
    });
    const http = app({
      appId: "org.example.Mod",
      name: "Amethyst Mod Manager",
      remoteName: "flathub",
      sourceLabel: "Flathub",
      origin: "flathub",
      branch: "stable",
      projectLicense: "MIT",
    });
    const merged = mergeBrowseApps([fedora, flathub, http]);
    assert.deepEqual(
      merged.map((item) => item.remoteName),
      ["fedora", "flathub"]
    );
    assert.equal(merged[0].projectLicense, "MIT");
  });

  it("folds a generic Flathub hit into the third-party row for that app", () => {
    const fedora = app({
      appId: "org.example.Mod",
      name: "Amethyst Mod Manager",
      remoteName: "fedora",
      sourceLabel: "Fedora",
      installationScope: "user",
      arch: "x86_64",
      branch: "stable",
      installedState: "installed",
    });
    const http = app({
      appId: fedora.appId,
      name: fedora.name,
      remoteName: "flathub",
      sourceLabel: "Flathub",
      origin: "flathub",
      branch: "stable",
      projectLicense: "MIT",
      summary: "Mod manager",
    });
    const merged = mergeBrowseApps([fedora, http]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].remoteName, "fedora");
    assert.equal(merged[0].installationScope, "user");
    assert.equal(merged[0].installedState, "installed");
    assert.equal(merged[0].projectLicense, "MIT");
    assert.equal(merged[0].summary, "Mod manager");
  });

  it("collapses the same catalog key across pages and keeps the installed state", () => {
    const first = app({
      appId: "org.example.Croissant",
      remoteName: "flathub",
      sourceLabel: "Flathub",
      branch: "stable",
      installedState: "unknown",
    });
    const again = {
      ...first,
      installedState: "update_available" as const,
      summary: "Updated",
    };
    const merged = mergeBrowseApps([first, again]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].installedState, "update_available");
    assert.equal(merged[0].summary, "Updated");
  });
});
