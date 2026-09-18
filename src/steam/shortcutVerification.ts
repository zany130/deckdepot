import { sleep } from "../api/inspect";
import { inspectShortcutsVdf } from "../api/shortcutRegistryBridge";
import { getApps, lookupDetails, lookupOverview } from "../api/steamCapabilities";
import { shortcutLaunchOptions } from "./shortcutManager";
import {
  ShortcutResult,
  ShortcutTarget,
} from "../types/steam";

export type ConfirmationFlag =
  | "LIVE_STEAM_STATE_CONFIRMED"
  | "VDF_PERSISTENCE_CONFIRMED"
  | "VISUAL_UI_CONFIRMATION_REQUIRED";

const OVERVIEW_TIMEOUT_MS = 4000;
const VDF_TIMEOUT_MS = 5000;
const POLL_MS = 50;

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
        // best-effort
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

async function waitUntil(
  timeoutMs: number,
  check: () => boolean
): Promise<{ reached: boolean; elapsedMs: number }> {
  const started = Date.now();
  if (check()) {
    return { reached: true, elapsedMs: 0 };
  }
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (reached: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      unsubscribe();
      window.clearInterval(poll);
      window.clearTimeout(timeout);
      resolve({ reached, elapsedMs: Date.now() - started });
    };
    const unsubscribe = subscribeOverviewChanges(() => {
      if (check()) {
        finish(true);
      }
    });
    const poll = window.setInterval(() => {
      if (check()) {
        finish(true);
      }
    }, POLL_MS);
    const timeout = window.setTimeout(() => finish(check()), timeoutMs);
  });
}

function nameFromOverview(steamAppId: number): string | null {
  const row = overviewRow(lookupOverview(steamAppId));
  if (!row) {
    return null;
  }
  if (typeof row.display_name === "string" && row.display_name) {
    return row.display_name;
  }
  if (typeof row.display_name_override === "string" && row.display_name_override) {
    return row.display_name_override;
  }
  return null;
}

function liveLaunchOptions(steamAppId: number): {
  source: string | null;
  value: string | null;
  present: boolean;
} {
  const details = lookupDetails(steamAppId);
  if (
    details.present === true &&
    typeof details.strShortcutLaunchOptions === "string" &&
    details.strShortcutLaunchOptions
  ) {
    return {
      source: "appDetailsStore.GetAppDetails",
      value: details.strShortcutLaunchOptions,
      present: true,
    };
  }
  const row = overviewRow(lookupOverview(steamAppId));
  if (typeof row?.strShortcutLaunchOptions === "string" && row.strShortcutLaunchOptions) {
    return {
      source: "appStore.GetAppOverviewByAppID",
      value: row.strShortcutLaunchOptions,
      present: true,
    };
  }
  const apps = getApps();
  const fn = apps?.GetLaunchOptionsForApp;
  if (typeof fn === "function") {
    try {
      const value = (fn as (id: number) => unknown).call(apps, steamAppId);
      if (typeof value === "string" && value) {
        return { source: "SteamClient.Apps.GetLaunchOptionsForApp", value, present: true };
      }
      return {
        source: "SteamClient.Apps.GetLaunchOptionsForApp",
        value: value == null ? null : String(value),
        present: value != null && String(value) !== "",
      };
    } catch {
      return { source: "SteamClient.Apps.GetLaunchOptionsForApp", value: null, present: false };
    }
  }
  return { source: null, value: null, present: false };
}

async function pollVdf(payload: {
  steamAppId: number;
  name: string;
  exe: string;
  launchOptions: string;
}): Promise<Record<string, unknown>> {
  const started = Date.now();
  let last: Record<string, unknown> | null = null;
  while (Date.now() - started <= VDF_TIMEOUT_MS) {
    const result = await inspectShortcutsVdf(payload);
    last = result;
    if (result.ok && result.vdfPersistenceConfirmed) {
      return { ...result, elapsedMs: Date.now() - started, timedOut: false };
    }
    await sleep(100);
  }
  return {
    ...(last || { ok: false, errorCode: "PROCESS_FAILED", errorMessage: "vdf inspect returned nothing" }),
    elapsedMs: Date.now() - started,
    timedOut: true,
  };
}

export async function verifyCreatedShortcut(
  addResult: ShortcutResult,
  target: ShortcutTarget
): Promise<Record<string, unknown>> {
  const expectedName = target.name;
  const expectedLaunch = shortcutLaunchOptions(target.appId, target.installationScope);
  if (!addResult.ok) {
    return {
      ok: false,
      returnedAppId: null,
      confirmation: {
        LIVE_STEAM_STATE_CONFIRMED: false,
        VDF_PERSISTENCE_CONFIRMED: false,
        VISUAL_UI_CONFIRMATION_REQUIRED: true,
      },
      addResult,
      note: "AddShortcut failed; live and VDF checks were not run.",
    };
  }

  const steamAppId = addResult.steamAppId;
  const overviewWait = await waitUntil(
    OVERVIEW_TIMEOUT_MS,
    () => lookupOverview(steamAppId).present === true
  );
  const nameWait = overviewWait.reached
    ? await waitUntil(
        OVERVIEW_TIMEOUT_MS,
        () => nameFromOverview(steamAppId) === expectedName
      )
    : { reached: false, elapsedMs: 0 };
  const overview = lookupOverview(steamAppId);
  const details = lookupDetails(steamAppId);
  const launch = liveLaunchOptions(steamAppId);
  const liveName = nameFromOverview(steamAppId);
  const liveConfirmed =
    overview.present === true && liveName === expectedName;

  const vdf = await pollVdf({
    steamAppId,
    name: expectedName,
    exe: target.exe,
    launchOptions: expectedLaunch,
  });
  const vdfConfirmed = Boolean(
    vdf && typeof vdf === "object" && (vdf as { vdfPersistenceConfirmed?: boolean }).vdfPersistenceConfirmed
  );

  return {
    ok: true,
    returnedAppId: steamAppId,
    alreadyPresent: addResult.alreadyPresent,
    hydrationTimedOut: addResult.hydrationTimedOut,
    setters: {
      nameSet: addResult.nameSet,
      launchOptionsSet: addResult.launchOptionsSet,
    },
    live: {
      overviewPresent: overview.present === true,
      overviewWaitMs: overviewWait.elapsedMs,
      overviewTimedOut: !overviewWait.reached,
      displayName: liveName,
      nameMatched: liveName === expectedName,
      nameWaitMs: nameWait.elapsedMs,
      details,
      launchOptions: launch,
      launchOptionsMatched: launch.value === expectedLaunch,
      overview,
    },
    vdf,
    confirmation: {
      LIVE_STEAM_STATE_CONFIRMED: liveConfirmed,
      VDF_PERSISTENCE_CONFIRMED: vdfConfirmed,
      VISUAL_UI_CONFIRMATION_REQUIRED: true,
    },
    expected: {
      name: expectedName,
      exe: target.exe,
      startDir: target.startDir,
      launchOptions: expectedLaunch,
    },
    remainingManualCheck:
      "Confirm the shortcut tile is visible in the Gaming Mode library/search grid. Live CEF overview and shortcuts.vdf cannot prove that surface.",
  };
}
