import { callable } from "@decky/api";
import { CatalogAppDetails, CatalogAppSummary } from "../types/catalog";
import { AppManSearchScope } from "../types/provider";
import { EngineErrorResult, InstalledAppsResult, TaskStartResult } from "../types/flatpak";

export interface AppManStatus {
  ok: true;
  available: boolean;
  binary?: string | null;
  version?: string | null;
  searchScope: AppManSearchScope;
  trustLabel?: string;
  config?: {
    present: boolean;
    path: string;
    location?: string | null;
    locationIsOpt?: boolean;
    locationWritable?: boolean;
  };
}

export type AppManStatusResult = AppManStatus | EngineErrorResult;

export type AppManSearchResult =
  | {
      ok: true;
      query: string;
      apps: CatalogAppSummary[];
      totalHits: number;
      available: boolean;
      searchScope?: AppManSearchScope;
      timedOut?: boolean;
    }
  | EngineErrorResult;

export type AppManCategoryResult =
  | {
      ok: true;
      slug: string;
      apps: CatalogAppSummary[];
      totalHits: number;
      truncated?: boolean;
      available: boolean;
    }
  | EngineErrorResult;

export type AppManDetailsResult =
  | { ok: true; app: CatalogAppDetails }
  | EngineErrorResult;

export const getAppmanStatus = callable<[], AppManStatusResult>("get_appman_status");

export const getAppmanSearch = callable<
  [query: string, scope: string],
  AppManSearchResult
>("get_appman_search");

export const getAppmanCategory = callable<[slug: string], AppManCategoryResult>(
  "get_appman_category"
);

export const getAppmanDetails = callable<
  [appId: string, sourceId: string],
  AppManDetailsResult
>("get_appman_details");

export const getAppmanInstalled = callable<[], InstalledAppsResult>(
  "get_appman_installed"
);

export const setAppmanSearchScope = callable<[scope: string], AppManStatusResult>(
  "set_appman_search_scope"
);

export const startAppmanInstall = callable<
  [appId: string, sourceId: string],
  TaskStartResult
>("start_appman_install");

export const startAppmanUpdate = callable<
  [appId: string, sourceId: string],
  TaskStartResult
>("start_appman_update");

export const startAppmanUpdateAll = callable<[], TaskStartResult>(
  "start_appman_update_all"
);

export const startAppmanUninstall = callable<
  [appId: string, sourceId: string],
  TaskStartResult
>("start_appman_uninstall");
