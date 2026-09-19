import { getFlathubAppDetails } from "./flathubClient";
import { CatalogAppDetails } from "../types/catalog";
import { AppSummary } from "../types/flatpak";

export function fallbackInstalledDetails(app: AppSummary): CatalogAppDetails {
  return {
    provider: app.provider,
    appId: app.appId,
    name: app.name,
    summary: app.summary?.trim() || undefined,
    iconUrl: app.iconUrl,
    categories: Array.isArray(app.categories) ? app.categories : [],
    nativeCategories: app.nativeCategories,
    installedState: app.installedState,
    sourceId: app.sourceId,
    sourceLabel: app.sourceLabel,
    amType: app.amType,
    amDb: app.amDb,
    launchSpec: app.launchSpec,
    origin: app.origin,
    screenshots: [],
    latestVersion: app.latestVersion ?? null,
  };
}

export function mergeInstalledCatalogDetails(
  installed: AppSummary,
  catalog: CatalogAppDetails
): CatalogAppDetails {
  return {
    ...catalog,
    provider: installed.provider,
    appId: installed.appId,
    name: catalog.name?.trim() || installed.name,
    origin: installed.origin,
    installedState: installed.installedState,
    sourceId: installed.sourceId || catalog.sourceId,
    sourceLabel: installed.sourceLabel || catalog.sourceLabel,
    launchSpec: installed.launchSpec || catalog.launchSpec,
    categories: catalog.categories?.length
      ? catalog.categories
      : installed.categories || [],
    iconUrl: catalog.iconUrl || installed.iconUrl,
    summary: catalog.summary?.trim() || installed.summary?.trim() || undefined,
    screenshots: catalog.screenshots || [],
  };
}

export async function detailsForInstalledFlatpak(
  app: AppSummary,
  options: { signal?: AbortSignal } = {}
): Promise<{ app: CatalogAppDetails; catalogMatched: boolean }> {
  const fallback = fallbackInstalledDetails(app);
  try {
    const result = await getFlathubAppDetails(app.appId, options);
    if (!result.ok) {
      return { app: fallback, catalogMatched: false };
    }
    return {
      app: mergeInstalledCatalogDetails(app, result.app),
      catalogMatched: true,
    };
  } catch (exc) {
    if (exc instanceof DOMException && exc.name === "AbortError") {
      throw exc;
    }
    return { app: fallback, catalogMatched: false };
  }
}
