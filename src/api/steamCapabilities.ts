import { describeType } from "./inspect";

function steamRoot(): Record<string, unknown> | null {
  const steam = (window as unknown as { SteamClient?: Record<string, unknown> })
    .SteamClient;
  return steam ?? null;
}

function appsObject(): Record<string, unknown> | null {
  const steam = steamRoot();
  const apps = steam?.Apps;
  if (!apps || (typeof apps !== "object" && typeof apps !== "function")) {
    return null;
  }
  return apps as Record<string, unknown>;
}

export function sanitizeOverview(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (key in row) {
        const item = row[key];
        if (
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean" ||
          item === null
        ) {
          out[key] = item;
        } else {
          out[key] = describeType(item);
        }
      }
    }
    return out;
  };
  return pick(
    "appid",
    "display_name",
    "display_name_override",
    "app_type",
    "canonicalAppType",
    "icon_hash",
    "shortcuted",
    "m_gameid",
    "sort_as",
    "strShortcutExe",
    "strShortcutLaunchOptions",
    "strShortcutStartDir"
  );
}

export function lookupOverview(appId: number): Record<string, unknown> {
  const store = (window as unknown as {
    appStore?: { GetAppOverviewByAppID?: (id: number) => unknown };
  }).appStore;
  if (typeof store?.GetAppOverviewByAppID !== "function") {
    return { present: false, reason: "appStore.GetAppOverviewByAppID missing" };
  }
  try {
    const overview = store.GetAppOverviewByAppID(appId);
    return {
      present: overview != null,
      overview: sanitizeOverview(overview),
    };
  } catch (exc) {
    return { present: false, errorMessage: String(exc) };
  }
}

export function lookupDetails(appId: number): Record<string, unknown> {
  const store = (window as unknown as {
    appDetailsStore?: { GetAppDetails?: (id: number) => unknown };
  }).appDetailsStore;
  if (typeof store?.GetAppDetails !== "function") {
    return { present: false, reason: "appDetailsStore.GetAppDetails missing" };
  }
  try {
    const details = store.GetAppDetails(appId);
    if (!details || typeof details !== "object") {
      return { present: false };
    }
    const row = details as Record<string, unknown>;
    return {
      present: true,
      strDisplayName: row.strDisplayName ?? null,
      strShortcutLaunchOptions: row.strShortcutLaunchOptions ?? null,
      strShortcutExe: row.strShortcutExe ?? null,
      strShortcutStartDir: row.strShortcutStartDir ?? null,
    };
  } catch (exc) {
    return { present: false, errorMessage: String(exc) };
  }
}

export function getApps(): Record<string, unknown> | null {
  return appsObject();
}
