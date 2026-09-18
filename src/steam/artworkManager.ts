import { getApps } from "../api/steamCapabilities";
import { fetchSteamGridDbCapsule, getSteamGridDbAsset } from "../api/steamGridDbBridge";

function setCustomArtworkAvailable(): boolean {
  const apps = getApps();
  return Boolean(apps && typeof apps.SetCustomArtworkForApp === "function");
}

function pinShortcutLogo(steamAppId: number): void {
  try {
    const store = (
      window as unknown as {
        appStore?: { GetAppOverviewByAppID?: (id: number) => unknown };
        appDetailsStore?: {
          SaveCustomLogoPosition?: (
            overview: unknown,
            position: {
              pinnedPosition: string;
              nWidthPct: number;
              nHeightPct: number;
            }
          ) => unknown;
        };
      }
    );
    const overview = store.appStore?.GetAppOverviewByAppID?.(steamAppId);
    const save = store.appDetailsStore?.SaveCustomLogoPosition;
    if (!overview || typeof save !== "function") {
      return;
    }
    void save.call(store.appDetailsStore, overview, {
      pinnedPosition: "BottomLeft",
      nWidthPct: 50,
      nHeightPct: 50,
    });
  } catch {
    // Logo position is best-effort; artwork apply already succeeded.
  }
}

async function setArtwork(
  steamAppId: number,
  imageType: "png" | "jpg",
  base64: string,
  assetType: number
): Promise<boolean> {
  const apps = getApps();
  const fn = apps?.SetCustomArtworkForApp;
  if (typeof fn !== "function") {
    return false;
  }
  await (
    fn as (
      appId: number,
      data: string,
      format: "png" | "jpg",
      assetType: number
    ) => Promise<void>
  ).call(apps, steamAppId >>> 0, base64, imageType, assetType);
  return true;
}

/** Best-effort library art. Never throws; never fails Add-to-Steam. */
export async function applyArtworkBestEffort(
  steamAppId: number,
  displayName: string
): Promise<boolean> {
  if (!setCustomArtworkAvailable()) {
    return false;
  }
  try {
    const fetched = await fetchSteamGridDbCapsule(displayName);
    if (!fetched.ok || fetched.skipped) {
      return false;
    }
    let applied = false;
    for (const category of fetched.categories) {
      const one = await getSteamGridDbAsset(category);
      if (!one.ok || one.skipped) {
        continue;
      }
      const asset = one.asset;
      if (!asset?.base64 || (asset.imageType !== "png" && asset.imageType !== "jpg")) {
        continue;
      }
      await setArtwork(steamAppId, asset.imageType, asset.base64, asset.assetType);
      if (asset.assetType === 2) {
        pinShortcutLogo(steamAppId);
      }
      applied = true;
    }
    return applied;
  } catch {
    return false;
  }
}
