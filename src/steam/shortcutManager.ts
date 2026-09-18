import {
  deleteShortcutMapping,
  getShortcutMapping,
  upsertShortcutMapping,
} from "../api/shortcutRegistryBridge";
import { getApps, lookupOverview } from "../api/steamCapabilities";
import {
  ShortcutMapping,
  ShortcutResult,
  ShortcutStatusResult,
  ShortcutTarget,
} from "../types/steam";
import { applyArtworkBestEffort } from "./artworkManager";
import { probeShortcutCapabilities } from "./capabilityProbe";

const HYDRATION_TIMEOUT_MS = 4000;
const HYDRATION_POLL_MS = 50;

export function shortcutLaunchOptions(
  appId: string,
  installationScope: "user" | "system"
): string {
  // Gaming Mode Steam has DISPLAY=:1 and no WAYLAND_DISPLAY. Flatpaks with
  // fallback-x11 then withhold X11 because a host Wayland socket exists, so Qt
  // aborts with "could not connect to display". --socket=x11 puts DISPLAY=:1
  // in the sandbox; device-tested with Moonlight via steam-launch-wrapper.
  return `run --${installationScope} --socket=x11 ${appId}`;
}

export const STEAM_ARTWORK_GENERATION = 3;
export const STEAM_FLATPAK_START_DIR = "";

export function sanitizeShortcutName(name: string, fallback: string): string {
  const cleaned = name.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || fallback).slice(0, 128);
}

function fail(
  errorCode: string,
  errorMessage: string,
  state: "unsupported" | "error" = "error",
  details?: Record<string, unknown>
): ShortcutResult {
  return details
    ? { ok: false, state, errorCode, errorMessage, details }
    : { ok: false, state, errorCode, errorMessage };
}

function overviewGameId(overview: Record<string, unknown> | null): string | null {
  if (!overview) {
    return null;
  }
  return typeof overview.m_gameid === "string" ? overview.m_gameid : null;
}

function overviewRow(lookup: Record<string, unknown>): Record<string, unknown> | null {
  const overview = lookup.overview;
  if (!overview || typeof overview !== "object") {
    return null;
  }
  return overview as Record<string, unknown>;
}

function unregisterHandle(handle: unknown): void {
  if (!handle || typeof handle !== "object") {
    return;
  }
  const row = handle as Record<string, unknown>;
  for (const key of ["unregister", "Unregister", "disconnect"]) {
    const fn = row[key];
    if (typeof fn === "function") {
      try {
        fn.call(handle);
      } catch {
        // Listener cleanup is best-effort.
      }
    }
  }
}

function subscribeOverviewChanges(onChange: () => void): () => void {
  const apps = getApps();
  const register = apps?.RegisterForAppOverviewChanges;
  if (typeof register !== "function") {
    return () => undefined;
  }
  try {
    const handle = (register as (cb: () => void) => unknown).call(apps, onChange);
    return () => unregisterHandle(handle);
  } catch {
    return () => undefined;
  }
}

async function waitForOverview(steamAppId: number): Promise<{
  present: boolean;
  elapsedMs: number;
  timedOut: boolean;
  gameId: string | null;
  displayName?: string | null;
}> {
  const started = Date.now();
  const caps = probeShortcutCapabilities();
  if (!caps.overviewLookup) {
    return {
      present: false,
      elapsedMs: 0,
      timedOut: false,
      gameId: null,
    };
  }

  const read = () => {
    const lookup = lookupOverview(steamAppId);
    const overview = overviewRow(lookup);
    return {
      present: lookup.present === true,
      gameId: overviewGameId(overview),
      displayName:
        overview && typeof overview.display_name === "string"
          ? overview.display_name
          : null,
    };
  };

  const immediate = read();
  if (immediate.present) {
    return { ...immediate, elapsedMs: 0, timedOut: false };
  }

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (timedOut: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      unsubscribe();
      window.clearInterval(poll);
      window.clearTimeout(timeout);
      const current = read();
      resolve({
        ...current,
        elapsedMs: Date.now() - started,
        timedOut,
      });
    };

    const unsubscribe = subscribeOverviewChanges(() => {
      if (read().present) {
        finish(false);
      }
    });
    const poll = window.setInterval(() => {
      if (read().present) {
        finish(false);
      }
    }, HYDRATION_POLL_MS);
    const timeout = window.setTimeout(() => finish(true), HYDRATION_TIMEOUT_MS);
  });
}

async function callShortcutSetter(
  method: "SetShortcutName" | "SetShortcutLaunchOptions" | "SetShortcutStartDir",
  steamAppId: number,
  value: string
): Promise<boolean> {
  const apps = getApps();
  const fn = apps?.[method];
  if (typeof fn !== "function") {
    return false;
  }
  try {
    await (fn as (id: number, next: string) => unknown).call(apps, steamAppId, value);
    return true;
  } catch {
    return false;
  }
}

async function applyReadySetters(
  steamAppId: number,
  name: string,
  launchOptions: string,
  startDir: string
): Promise<{ nameSet: boolean; launchOptionsSet: boolean; startDirSet: boolean }> {
  const caps = probeShortcutCapabilities();
  const nameSet = caps.setShortcutName
    ? await callShortcutSetter("SetShortcutName", steamAppId, name)
    : false;
  const launchOptionsSet = caps.setShortcutLaunchOptions
    ? await callShortcutSetter("SetShortcutLaunchOptions", steamAppId, launchOptions)
    : false;
  const startDirSet = caps.setShortcutStartDir
    ? await callShortcutSetter("SetShortcutStartDir", steamAppId, startDir)
    : false;
  return { nameSet, launchOptionsSet, startDirSet };
}

async function callAddShortcut(
  name: string,
  exe: string,
  startDir: string,
  launchOptions: string
): Promise<number> {
  const apps = getApps();
  const fn = apps?.AddShortcut;
  if (typeof fn !== "function") {
    throw new Error("AddShortcut missing");
  }
  const appId = await (fn as (
    shortcutName: string,
    executable: string,
    directory: string,
    options: string
  ) => Promise<number>).call(apps, name, exe, startDir, launchOptions);
  const numeric = Number(appId);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`AddShortcut returned an unusable AppID: ${String(appId)}`);
  }
  return numeric >>> 0;
}

async function callRemoveShortcut(steamAppId: number): Promise<void> {
  const apps = getApps();
  const fn = apps?.RemoveShortcut;
  if (typeof fn !== "function") {
    throw new Error("RemoveShortcut missing");
  }
  await (fn as (id: number) => unknown).call(apps, steamAppId);
}

async function persistMapping(mapping: ShortcutMapping): Promise<ShortcutMapping> {
  const result = await upsertShortcutMapping(mapping);
  if (!result.ok) {
    throw new Error(`${result.errorCode}: ${result.errorMessage}`);
  }
  return result.mapping;
}

export async function repairOwnedShortcut(
  mapping: ShortcutMapping
): Promise<ShortcutMapping> {
  const isFlatpak = (mapping.provider || "flatpak") === "flatpak";
  const expectedLaunch = isFlatpak
    ? shortcutLaunchOptions(mapping.appId, mapping.installationScope)
    : mapping.launchOptions;
  const expectedStartDir = isFlatpak ? STEAM_FLATPAK_START_DIR : mapping.startDir;
  const startDirNeedsRepair = mapping.startDir !== expectedStartDir;
  const launchNeedsRepair = mapping.launchOptions !== expectedLaunch;
  const artworkNeedsApply = mapping.artworkGeneration !== STEAM_ARTWORK_GENERATION;
  if (!startDirNeedsRepair && !launchNeedsRepair && !artworkNeedsApply) {
    return mapping;
  }
  const live = lookupOverview(mapping.steamAppId);
  if (live.present !== true) {
    return mapping;
  }
  const caps = probeShortcutCapabilities();
  const next: ShortcutMapping = { ...mapping };
  let changed = false;
  if (startDirNeedsRepair && caps.setShortcutStartDir) {
    const startDirSet = await callShortcutSetter(
      "SetShortcutStartDir",
      mapping.steamAppId,
      expectedStartDir
    );
    if (startDirSet) {
      next.startDir = expectedStartDir;
      changed = true;
    }
  }
  if (launchNeedsRepair && caps.setShortcutLaunchOptions) {
    const launchOptionsSet = await callShortcutSetter(
      "SetShortcutLaunchOptions",
      mapping.steamAppId,
      expectedLaunch
    );
    if (launchOptionsSet) {
      next.launchOptions = expectedLaunch;
      changed = true;
    }
  }
  if (artworkNeedsApply) {
    const applied = await applyArtworkBestEffort(mapping.steamAppId, mapping.name);
    if (applied) {
      next.artworkAppliedAtMs = Date.now();
      next.artworkGeneration = STEAM_ARTWORK_GENERATION;
      changed = true;
    }
  }
  if (!changed) {
    return mapping;
  }
  next.updatedAtMs = Date.now();
  return persistMapping(next);
}

function mappingFromTarget(
  target: ShortcutTarget,
  steamAppId: number,
  launchOptions: string,
  gameId: string | null
): ShortcutMapping {
  const now = Date.now();
  return {
    provider: target.provider,
    appId: target.appId,
    installationScope: target.installationScope,
    steamAppId,
    gameId,
    name: sanitizeShortcutName(target.name, target.appId),
    exe: target.exe,
    startDir: target.startDir,
    launchOptions,
    createdAtMs: now,
    updatedAtMs: now,
  };
}

export async function getShortcutStatus(
  target: Pick<ShortcutTarget, "provider" | "appId" | "installationScope">
): Promise<ShortcutStatusResult> {
  const caps = probeShortcutCapabilities();
  if (!caps.supported) {
    return {
      ok: false,
      state: "unsupported",
      errorCode: "STEAM_API_UNAVAILABLE",
      errorMessage: "Steam AddShortcut/RemoveShortcut is not available.",
    };
  }
  try {
    const lookup = await getShortcutMapping(
      target.provider,
      target.installationScope,
      target.appId
    );
    if (!lookup.ok) {
      return {
        ok: false,
        state: "error",
        errorCode: lookup.errorCode,
        errorMessage: lookup.errorMessage,
      };
    }
    if (!lookup.found || !lookup.mapping) {
      return { ok: true, state: "not_added", mapping: null, overviewPresent: false };
    }
    const live = lookupOverview(lookup.mapping.steamAppId);
    const overview = live.present === true;
    const row =
      live.overview && typeof live.overview === "object"
        ? (live.overview as Record<string, unknown>)
        : null;
    if (overview) {
      return {
        ok: true,
        state: "added_live",
        mapping: lookup.mapping,
        overviewPresent: true,
        gameId: overviewGameId(row),
        steamAppId: lookup.mapping.steamAppId,
      };
    }
    return {
      ok: true,
      state: "known_from_plugin_registry",
      mapping: lookup.mapping,
      overviewPresent: false,
      steamAppId: lookup.mapping.steamAppId,
    };
  } catch (exc) {
    return {
      ok: false,
      state: "error",
      errorCode: "STEAM_OPERATION_FAILED",
      errorMessage: String(exc),
    };
  }
}

export async function addOwnedShortcut(target: ShortcutTarget): Promise<ShortcutResult> {
  const caps = probeShortcutCapabilities();
  if (!caps.addShortcut) {
    return fail(
      "STEAM_API_UNAVAILABLE",
      "Steam AddShortcut is not available.",
      "unsupported"
    );
  }

  const name = sanitizeShortcutName(target.name, target.appId);
  const launchOptions =
    target.provider === "flatpak"
      ? shortcutLaunchOptions(target.appId, target.installationScope)
      : target.launchOptions || "";
  const startDir =
    target.provider === "flatpak" ? STEAM_FLATPAK_START_DIR : target.startDir;

  try {
    const existing = await getShortcutMapping(
      target.provider,
      target.installationScope,
      target.appId
    );
    if (!existing.ok) {
      return fail(existing.errorCode, existing.errorMessage);
    }

    if (existing.found && existing.mapping) {
      if (!caps.overviewLookup) {
        const mapping = await persistMapping({
          ...existing.mapping,
          name,
          exe: target.exe,
          startDir,
          launchOptions,
          updatedAtMs: Date.now(),
        });
        return {
          ok: true,
          state: "known_from_plugin_registry",
          steamAppId: mapping.steamAppId,
          gameId: mapping.gameId,
          alreadyPresent: true,
          hydrationTimedOut: false,
          nameSet: false,
          launchOptionsSet: false,
          mapping,
          overviewPresent: false,
        };
      }
      const live = await waitForOverview(existing.mapping.steamAppId);
      if (live.present) {
        const setters = await applyReadySetters(
          existing.mapping.steamAppId,
          name,
          launchOptions,
          startDir
        );
        const mapping = await persistMapping({
          ...existing.mapping,
          name,
          exe: target.exe,
          startDir,
          launchOptions,
          gameId: live.gameId ?? existing.mapping.gameId,
          updatedAtMs: Date.now(),
        });
        return {
          ok: true,
          state: "added_live",
          steamAppId: mapping.steamAppId,
          gameId: mapping.gameId,
          alreadyPresent: true,
          hydrationTimedOut: false,
          nameSet: setters.nameSet,
          launchOptionsSet: setters.launchOptionsSet,
          mapping,
          overviewPresent: true,
        };
      }
      try {
        if (caps.removeShortcut) {
          await callRemoveShortcut(existing.mapping.steamAppId);
        }
      } catch {
        // Stale mapped IDs may already be gone. Continue with a fresh AddShortcut.
      }
    }

    const steamAppId = await callAddShortcut(
      name,
      target.exe,
      startDir,
      launchOptions
    );
    const hydrated = await waitForOverview(steamAppId);
    const setters = hydrated.present
      ? await applyReadySetters(steamAppId, name, launchOptions, startDir)
      : { nameSet: false, launchOptionsSet: false, startDirSet: false };
    const mapping = await persistMapping(
      mappingFromTarget(
        { ...target, name, startDir },
        steamAppId,
        launchOptions,
        hydrated.gameId
      )
    );
    return {
      ok: true,
      state: hydrated.present ? "added_live" : "known_from_plugin_registry",
      steamAppId,
      gameId: hydrated.gameId,
      alreadyPresent: false,
      hydrationTimedOut: hydrated.timedOut,
      nameSet: setters.nameSet,
      launchOptionsSet: setters.launchOptionsSet,
      mapping,
      overviewPresent: hydrated.present,
    };
  } catch (exc) {
    return fail("STEAM_OPERATION_FAILED", String(exc));
  }
}

export async function addFlatpakShortcut(target: ShortcutTarget): Promise<ShortcutResult> {
  return addOwnedShortcut({ ...target, provider: "flatpak" });
}

export async function removeFlatpakShortcut(
  target: Pick<ShortcutTarget, "provider" | "appId" | "installationScope">
): Promise<ShortcutResult> {
  const caps = probeShortcutCapabilities();
  if (!caps.removeShortcut) {
    return fail(
      "STEAM_API_UNAVAILABLE",
      "Steam RemoveShortcut is not available.",
      "unsupported"
    );
  }
  try {
    const lookup = await getShortcutMapping(
      target.provider,
      target.installationScope,
      target.appId
    );
    if (!lookup.ok) {
      return fail(lookup.errorCode, lookup.errorMessage);
    }
    if (!lookup.found || !lookup.mapping) {
      return fail(
        "INVALID_ARGUMENT",
        "No plugin-owned Steam AppID is mapped for this app. RemoveShortcut is not called without a known ID."
      );
    }
    await callRemoveShortcut(lookup.mapping.steamAppId);
    const deleted = await deleteShortcutMapping(
      target.provider,
      target.installationScope,
      target.appId
    );
    if (!deleted.ok) {
      return fail(deleted.errorCode, deleted.errorMessage, "error", {
        steamAppId: lookup.mapping.steamAppId,
        removedFromSteam: true,
      });
    }
    return {
      ok: true,
      state: "not_added",
      steamAppId: lookup.mapping.steamAppId,
      gameId: lookup.mapping.gameId,
      alreadyPresent: false,
      hydrationTimedOut: false,
      nameSet: false,
      launchOptionsSet: false,
      mapping: lookup.mapping,
      overviewPresent: false,
    };
  } catch (exc) {
    return fail("STEAM_OPERATION_FAILED", String(exc));
  }
}

export async function forgetShortcutMapping(
  target: Pick<ShortcutTarget, "provider" | "appId" | "installationScope">
): Promise<{ ok: true; removed: boolean } | ShortcutResult> {
  const deleted = await deleteShortcutMapping(
    target.provider,
    target.installationScope,
    target.appId
  );
  if (!deleted.ok) {
    return fail(deleted.errorCode, deleted.errorMessage);
  }
  return { ok: true, removed: deleted.removed };
}
