import {
  getFlathubAppDetails,
  listFlathubCategory,
  searchFlathub,
} from "./flathubClient";
import { getAppmanCategory, getAppmanDetails, getAppmanSearch } from "./appmanBridge";
import {
  CatalogDetailsResult,
  CatalogFailure,
  CatalogSearchResult,
} from "../types/catalog";
import { ProviderId } from "../types/provider";

function asCatalogFailure(result: { errorCode: string; errorMessage: string }): CatalogFailure {
  return {
    ok: false,
    errorCode: result.errorCode === "REMOTE_SCHEMA_ERROR" ? "REMOTE_SCHEMA_ERROR" : "NETWORK_ERROR",
    errorMessage: result.errorMessage,
  };
}

export async function searchFlatpakCatalog(
  query: string,
  options: { page?: number; signal?: AbortSignal } = {}
): Promise<CatalogSearchResult> {
  return searchFlathub(query, options);
}

export async function listFlatpakCategory(
  slug: string,
  options: { page?: number; signal?: AbortSignal } = {}
): Promise<CatalogSearchResult> {
  return listFlathubCategory(slug, options);
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
  options: { page?: number; signal?: AbortSignal } = {}
): Promise<CatalogSearchResult> {
  if (provider === "appman") {
    return searchAppmanCatalog(query);
  }
  return searchFlatpakCatalog(query, options);
}

export async function listProviderCategory(
  provider: ProviderId,
  slug: string,
  options: { page?: number; signal?: AbortSignal } = {}
): Promise<CatalogSearchResult> {
  if (provider === "appman") {
    return listAppmanCategory(slug);
  }
  return listFlatpakCategory(slug, options);
}

export async function getCatalogDetails(
  app: { provider: ProviderId; appId: string; sourceId?: string },
  options: { signal?: AbortSignal } = {}
): Promise<CatalogDetailsResult> {
  if (app.provider === "appman") {
    try {
      const result = await getAppmanDetails(app.appId, app.sourceId || "am");
      if (result.ok) {
        return result;
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
  return getFlathubAppDetails(app.appId, options);
}
