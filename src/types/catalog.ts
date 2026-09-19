import type { AppManLaunchSpec } from "./flatpak";
import type { AppManSourceId, ProviderId } from "./provider";

export type { AppManSourceId, ProviderId };
export { catalogKey } from "./provider";

export type CatalogErrorCode = "NETWORK_ERROR" | "REMOTE_SCHEMA_ERROR";

export interface CatalogFailure {
  ok: false;
  errorCode: CatalogErrorCode;
  errorMessage: string;
  httpStatus?: number;
}

export interface CatalogAppSummary {
  provider: ProviderId;
  appId: string;
  name: string;
  summary?: string;
  iconUrl?: string;
  categories: string[];
  nativeCategories?: string[];
  developerName?: string;
  installedState: "unknown" | "not_installed" | "installed" | "update_available";
  sourceId?: AppManSourceId | string;
  sourceLabel?: string;
  amType?: string | null;
  amDb?: string | null;
  launchSpec?: AppManLaunchSpec;
  origin?: string;
}

export interface CatalogScreenshot {
  url: string;
  width?: number;
  height?: number;
  caption?: string;
}

export interface CatalogAppDetails extends CatalogAppSummary {
  descriptionText?: string;
  projectLicense?: string;
  homepageUrl?: string;
  screenshots: CatalogScreenshot[];
  launchableDesktopId?: string;
  bundleRef?: string;
  latestVersion?: string | null;
}

export interface CatalogSearchSuccess {
  ok: true;
  query: string;
  apps: CatalogAppSummary[];
  totalHits: number;
  page: number;
  totalPages: number;
  droppedHitCount: number;
}

export interface CatalogDetailsSuccess {
  ok: true;
  app: CatalogAppDetails;
}

export type CatalogSearchResult = CatalogSearchSuccess | CatalogFailure;
export type CatalogDetailsResult = CatalogDetailsSuccess | CatalogFailure;

export function isCatalogFailure(
  result: { ok: boolean }
): result is CatalogFailure {
  return result.ok === false;
}

function firstPresentText(
  ...values: Array<string | null | undefined>
): string | undefined {
  for (const value of values) {
    const text = value?.trim();
    if (text) {
      return text;
    }
  }
  return undefined;
}

export function mergeAppmanCatalogDetails(
  catalog: Partial<CatalogAppSummary> & Pick<CatalogAppSummary, "appId" | "provider">,
  details: CatalogAppDetails
): CatalogAppDetails {
  const summary = firstPresentText(details.summary, catalog.summary);
  return {
    ...catalog,
    ...details,
    summary,
    descriptionText: firstPresentText(
      details.descriptionText,
      catalog.summary,
      details.summary
    ),
    iconUrl: details.iconUrl || catalog.iconUrl,
    sourceId: details.sourceId || catalog.sourceId,
    sourceLabel: details.sourceLabel || catalog.sourceLabel,
    categories: details.categories?.length
      ? details.categories
      : catalog.categories || [],
    nativeCategories: details.nativeCategories?.length
      ? details.nativeCategories
      : catalog.nativeCategories,
    screenshots: details.screenshots || [],
  };
}
