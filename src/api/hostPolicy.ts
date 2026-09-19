import { getFlatpakHostPolicy } from "./flatpakBridge";
import { CatalogAppSummary } from "../types/catalog";

export function filterDeniedCatalogApps(
  apps: CatalogAppSummary[],
  deniedAppIds: Set<string>
): { apps: CatalogAppSummary[]; dropped: number } {
  if (deniedAppIds.size === 0) {
    return { apps, dropped: 0 };
  }
  const kept = apps.filter((app) => !deniedAppIds.has(app.appId));
  return { apps: kept, dropped: apps.length - kept.length };
}

export async function loadHostPolicyDeniedIds(
  refresh = false
): Promise<Set<string>> {
  try {
    const result = await getFlatpakHostPolicy(refresh);
    if (!result.ok) {
      console.warn(
        `[DeckDepot] host policy unavailable ${result.errorCode} ${result.errorMessage}`
      );
      return new Set();
    }
    if (!result.determined) {
      console.warn("[DeckDepot] host policy not determined; catalog stays unfiltered");
      return new Set();
    }
    return new Set(result.deniedAppIds || []);
  } catch (exc) {
    console.warn("[DeckDepot] host policy unavailable", exc);
    return new Set();
  }
}

let cachedDeniedIds = new Set<string>();
let deniedLoaded = false;

export async function ensureHostPolicyDeniedIds(refresh = false): Promise<Set<string>> {
  if (deniedLoaded && !refresh) {
    return cachedDeniedIds;
  }
  cachedDeniedIds = await loadHostPolicyDeniedIds(refresh);
  deniedLoaded = true;
  return cachedDeniedIds;
}
