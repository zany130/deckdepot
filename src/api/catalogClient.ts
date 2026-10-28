import { destinationById } from "../browse/destinations";
import {
  getFlathubAppDetails,
  listFlathubCategory,
  listFlathubCollection,
  searchFlathub,
} from "./flathubClient";
import { getAppmanCategory, getAppmanDetails, getAppmanSearch } from "./appmanBridge";
import {
  getFlatpakHostDetails,
  listFlatpakCategoryExtras,
  searchFlatpakHostCatalog,
} from "./flatpakBridge";
import {
  CatalogAppDetails,
  CatalogAppSummary,
  CatalogDetailsResult,
  CatalogFailure,
  CatalogRemoteWarning,
  CatalogSearchResult,
  mergeAppmanCatalogDetails,
} from "../types/catalog";
import { isFlathubSource, ProviderId } from "../types/provider";
import { mergeBrowseApps } from "./catalogMerge";
import { presentFlatpakSearch } from "./flatpakSearchState";

function asCatalogFailure(result: { errorCode: string; errorMessage: string }): CatalogFailure {
  return {
    ok: false,
    errorCode: result.errorCode === "REMOTE_SCHEMA_ERROR" ? "REMOTE_SCHEMA_ERROR" : "NETWORK_ERROR",
    errorMessage: result.errorMessage,
  };
}

function emptySearch(query: string, warnings: CatalogRemoteWarning[] = []): CatalogSearchResult {
  return {
    ok: true,
    query,
    apps: [],
    totalHits: 0,
    page: 1,
    totalPages: 1,
    droppedHitCount: 0,
    warnings,
  };
}

function mergeWarnings(
  ...groups: Array<CatalogRemoteWarning[] | undefined>
): CatalogRemoteWarning[] {
  const out: CatalogRemoteWarning[] = [];
  for (const group of groups) {
    for (const item of group || []) {
      if (!item?.errorMessage) {
        continue;
      }
      out.push(item);
    }
  }
  return out;
}

function asHostSearch(result: CatalogSearchResult | { ok: false; errorCode: string; errorMessage: string }): CatalogSearchResult {
  if (result.ok) {
    return result;
  }
  return asCatalogFailure(result);
}

export async function searchFlatpakCatalog(
  query: string,
  options: { page?: number; signal?: AbortSignal; refresh?: boolean } = {}
): Promise<CatalogSearchResult> {
  const page = options.page ?? 1;
  const hostPromise = searchFlatpakHostCatalog(query, Boolean(options.refresh)).then(
    asHostSearch,
    (exc) =>
      ({
        ok: false,
        errorCode: "NETWORK_ERROR",
        errorMessage: String(exc),
      }) as CatalogFailure
  );
  const httpPromise = searchFlathub(query, options);
  const [host, http] = await Promise.all([hostPromise, httpPromise]);
  if (page > 1) {
    if (http.ok) {
      return { ...http, apps: mergeBrowseApps(http.apps) };
    }
    return host.ok ? host : http;
  }
  const hostApps = host.ok ? host.apps : [];
  const thirdParty = hostApps.filter((app) => !isFlathubSource(app));
  const hostFlathub = hostApps.filter((app) => isFlathubSource(app));
  const httpApps = http.ok ? http.apps : [];
  const apps = mergeBrowseApps([...thirdParty, ...hostFlathub, ...httpApps]);
  return presentFlatpakSearch({
    query,
    host,
    http,
    apps,
    droppedHitCount:
      (host.ok ? host.droppedHitCount : 0) + (http.ok ? http.droppedHitCount : 0),
  });
}

export async function listFlatpakCategory(
  slug: string,
  options: { page?: number; signal?: AbortSignal; refresh?: boolean } = {}
): Promise<CatalogSearchResult> {
  const page = options.page ?? 1;
  const destination = destinationById(slug);
  if (destination?.kind === "collection" && destination.flathubCollection) {
    const http = await listFlathubCollection(destination.flathubCollection, options);
    if (!http.ok) {
      return http;
    }
    return {
      ...http,
      query: slug,
      apps: mergeBrowseApps(http.apps),
    };
  }
  const includeFlathub = slug !== "other";
  const extrasPromise =
    page === 1
      ? listFlatpakCategoryExtras(slug, Boolean(options.refresh)).then(
          asHostSearch,
          (exc) =>
            ({
              ok: false,
              errorCode: "NETWORK_ERROR",
              errorMessage: String(exc),
            }) as CatalogFailure
        )
      : Promise.resolve(emptySearch(slug));
  const httpPromise = includeFlathub
    ? listFlathubCategory(slug, options)
    : Promise.resolve(emptySearch(slug));
  const [http, extras] = await Promise.all([httpPromise, extrasPromise]);
  const extraApps = extras.ok ? extras.apps : [];
  const warnings = mergeWarnings(
    extras.ok ? extras.warnings : [{ remoteName: "remotes", errorMessage: extras.errorMessage }],
    includeFlathub && !http.ok
      ? [{ remoteName: "flathub", errorMessage: http.errorMessage }]
      : undefined
  );
  if (!includeFlathub) {
    const apps = mergeBrowseApps(extraApps);
    return {
      ok: true,
      query: slug,
      apps,
      totalHits: apps.length,
      page: 1,
      totalPages: 1,
      droppedHitCount: 0,
      warnings,
    };
  }
  if (http.ok) {
    const merged = mergeBrowseApps(page === 1 ? [...extraApps, ...http.apps] : http.apps);
    return {
      ...http,
      query: slug,
      apps: merged,
      warnings,
    };
  }
  if (extraApps.length > 0) {
    return {
      ok: true,
      query: slug,
      apps: mergeBrowseApps(extraApps),
      totalHits: extraApps.length,
      page: 1,
      totalPages: 1,
      droppedHitCount: 0,
      warnings,
    };
  }
  return http;
}

export async function searchAppmanCatalog(
  query: string
): Promise<CatalogSearchResult> {
  try {
    const result = await getAppmanSearch(query, "");
    if (!result.ok) {
      return asCatalogFailure(result);
    }
    return {
      ok: true,
      query,
      apps: result.apps,
      totalHits: result.totalHits,
      page: 1,
      totalPages: 1,
      droppedHitCount: 0,
    };
  } catch (exc) {
    return {
      ok: false,
      errorCode: "NETWORK_ERROR",
      errorMessage: String(exc),
    };
  }
}

export async function listAppmanCategory(slug: string): Promise<CatalogSearchResult> {
  try {
    const result = await getAppmanCategory(slug);
    if (!result.ok) {
      return asCatalogFailure(result);
    }
    return {
      ok: true,
      query: slug,
      apps: result.apps,
      totalHits: result.totalHits,
      page: 1,
      totalPages: 1,
      droppedHitCount: 0,
    };
  } catch (exc) {
    return {
      ok: false,
      errorCode: "NETWORK_ERROR",
      errorMessage: String(exc),
    };
  }
}

export async function searchProviderCatalog(
  provider: ProviderId,
  query: string,
  options: { page?: number; signal?: AbortSignal; refresh?: boolean } = {}
): Promise<CatalogSearchResult> {
  if (provider === "appman") {
    return searchAppmanCatalog(query);
  }
  return searchFlatpakCatalog(query, options);
}

export async function listProviderCategory(
  provider: ProviderId,
  slug: string,
  options: { page?: number; signal?: AbortSignal; refresh?: boolean } = {}
): Promise<CatalogSearchResult> {
  if (provider === "appman") {
    return listAppmanCategory(slug);
  }
  return listFlatpakCategory(slug, options);
}

function mergeHostCatalogDetails(
  catalog: CatalogAppSummary,
  details: CatalogAppDetails
): CatalogAppDetails {
  return {
    ...catalog,
    ...details,
    name: details.name || catalog.name,
    summary: details.summary || catalog.summary,
    iconUrl: details.iconUrl || catalog.iconUrl,
    sourceLabel: details.sourceLabel || catalog.sourceLabel,
    remoteName: details.remoteName || catalog.remoteName,
    origin: details.origin || catalog.origin,
    installationScope: details.installationScope || catalog.installationScope,
    branch: details.branch || catalog.branch,
    arch: details.arch || catalog.arch,
    ref: details.ref || catalog.ref,
    categories: details.categories?.length ? details.categories : catalog.categories || [],
    screenshots: details.screenshots?.length ? details.screenshots : [],
  };
}

export async function getCatalogDetails(
  app: CatalogAppSummary | { provider: ProviderId; appId: string; sourceId?: string },
  options: { signal?: AbortSignal } = {}
): Promise<CatalogDetailsResult> {
  if (app.provider === "appman") {
    try {
      const result = await getAppmanDetails(app.appId, app.sourceId || "am");
      if (result.ok) {
        return {
          ok: true,
          app: mergeAppmanCatalogDetails(app, result.app),
        };
      }
      return asCatalogFailure(result);
    } catch (exc) {
      return {
        ok: false,
        errorCode: "NETWORK_ERROR",
        errorMessage: String(exc),
      };
    }
  }
  const catalogApp = app as CatalogAppSummary;
  if (!isFlathubSource(catalogApp)) {
    try {
      const result = await getFlatpakHostDetails(
        catalogApp.appId,
        catalogApp.installationScope || "",
        catalogApp.remoteName || "",
        catalogApp.ref || "",
        catalogApp.branch || "",
        catalogApp.arch || ""
      );
      if (result.ok) {
        return { ok: true, app: mergeHostCatalogDetails(catalogApp, result.app) };
      }
      return {
        ok: true,
        app: {
          ...catalogApp,
          screenshots: [],
          descriptionText: catalogApp.summary,
        },
      };
    } catch {
      return {
        ok: true,
        app: {
          ...catalogApp,
          screenshots: [],
          descriptionText: catalogApp.summary,
        },
      };
    }
  }
  const http = await getFlathubAppDetails(catalogApp.appId, options);
  if (!http.ok) {
    try {
      const fallback = await getFlatpakHostDetails(
        catalogApp.appId,
        catalogApp.installationScope || "",
        catalogApp.remoteName || "flathub",
        catalogApp.ref || "",
        catalogApp.branch || "",
        catalogApp.arch || ""
      );
      if (fallback.ok) {
        return { ok: true, app: mergeHostCatalogDetails(catalogApp, fallback.app) };
      }
    } catch {
      // Keep the HTTP failure below.
    }
    return http;
  }
  return { ok: true, app: mergeHostCatalogDetails(catalogApp, http.app) };
}
