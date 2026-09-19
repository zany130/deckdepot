import { callable } from "@decky/api";
import {
  EngineErrorResult,
  FlathubRemoteResult,
  FlatpakScopeStatus,
  InstalledAppsResult,
  TaskProgress,
  TaskStartResult,
  TaskStatusResult,
  UserUpdatesResult,
} from "../types/flatpak";
import { CatalogDetailsResult, CatalogSearchResult, HostPolicyResult } from "../types/catalog";
import { ContentFilters } from "../types/contentFilters";

export const getInstalledApps = callable<[], InstalledAppsResult>(
  "get_installed_apps"
);

export const getSystemInstalledApps = callable<[], InstalledAppsResult>(
  "get_system_installed_apps"
);

export const getUserUpdates = callable<[], UserUpdatesResult>("get_user_updates");

export const getSystemUpdates = callable<[], UserUpdatesResult>(
  "get_system_updates"
);

export const getFlatpakScopeStatus = callable<[], FlatpakScopeStatus>(
  "get_flatpak_scope_status"
);

export const setFlatpakInstallScope = callable<[scope: string], FlatpakScopeStatus>(
  "set_flatpak_install_scope"
);

export const getFlatpakContentFilters = callable<
  [],
  ({ ok: true } & ContentFilters) | EngineErrorResult
>("get_flatpak_content_filters");

export const setFlatpakContentFilters = callable<
  [updates: Partial<ContentFilters>],
  ({ ok: true } & ContentFilters) | EngineErrorResult
>("set_flatpak_content_filters");

export const checkFlathubRemote = callable<[], FlathubRemoteResult>(
  "check_flathub_remote"
);

export const addFlathubRemote = callable<[], FlathubRemoteResult>(
  "add_flathub_remote"
);

export const getTaskStatus = callable<[taskId: string], TaskStatusResult>(
  "get_task_status"
);

export const getTasks = callable<
  [],
  { ok: true; backendSessionId?: string; tasks: TaskProgress[] }
>("get_tasks");

export const startInstall = callable<
  [appId: string, installationScope?: string, remoteName?: string, ref?: string],
  TaskStartResult
>("start_install");

export const startUpdate = callable<
  [appId: string, ref: string, installationScope?: string],
  TaskStartResult
>("start_update");

export const startUpdateAll = callable<[installationScope?: string], TaskStartResult>(
  "start_update_all"
);

export const startUninstall = callable<
  [appId: string, installationScope?: string],
  TaskStartResult
>("start_uninstall");

export const cancelTask = callable<[taskId: string], TaskStatusResult>(
  "cancel_task"
);

export const getFlatpakCatalogRemotes = callable<
  [],
  {
    ok: true;
    enumeratable: Array<{
      installationScope: "user" | "system";
      name: string;
      title: string;
      url: string;
      isFlathub: boolean;
      filtered?: boolean;
    }>;
  } | EngineErrorResult
>("get_flatpak_catalog_remotes");

export const getFlatpakHostPolicy = callable<
  [refresh?: boolean],
  HostPolicyResult
>("get_flatpak_host_policy");

export const searchFlatpakHostCatalog = callable<
  [query: string, refresh?: boolean],
  CatalogSearchResult
>("search_flatpak_catalog");

export const listFlatpakCategoryExtras = callable<
  [slug: string, refresh?: boolean],
  CatalogSearchResult
>("list_flatpak_category_extras");

export const getFlatpakHostDetails = callable<
  [
    appId: string,
    installationScope?: string,
    remoteName?: string,
    ref?: string,
    branch?: string,
    arch?: string,
    refresh?: boolean,
  ],
  CatalogDetailsResult
>("get_flatpak_host_details");

export const refreshFlatpakCatalog = callable<[], { ok: true } | EngineErrorResult>(
  "refresh_flatpak_catalog"
);
