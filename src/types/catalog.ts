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
