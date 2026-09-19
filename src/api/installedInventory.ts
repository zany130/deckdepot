import { CatalogAppSummary } from "../types/catalog";
import {
  AppSummary,
  EngineErrorResult,
  FlathubRemoteResult,
  InstallationScope,
  InstalledAppsResult,
  TaskProgress,
  UserUpdate,
  isActivePhase,
} from "../types/flatpak";
import { APPMAN_UPDATE_ALL_APP_ID, SYSTEM_UPDATE_ALL_APP_ID, UPDATE_ALL_APP_ID } from "../constants";

export type CatalogBadge = "installed" | "system" | "update" | null;

export interface AppInstallStatus {
  userInstalled: boolean;
  systemInstalled: boolean;
  userApp: AppSummary | null;
  systemApp: AppSummary | null;
  updates: UserUpdate[];
  userUpdates: UserUpdate[];
  systemUpdates: UserUpdate[];
}

export interface InstalledInventory {
  userApps: AppSummary[];
  systemApps: AppSummary[];
  rows: AppSummary[];
  userError: EngineErrorResult | null;
  systemError: EngineErrorResult | null;
  appmanError: EngineErrorResult | null;
  remote: FlathubRemoteResult | null;
}

function withScope(apps: AppSummary[], scope: InstallationScope): AppSummary[] {
  return apps.map((app) => ({ ...app, installationScope: scope }));
}

function asError(result: InstalledAppsResult): EngineErrorResult | null {
  return result.ok ? null : result;
}

export function mergeInventory(
  userResult: InstalledAppsResult,
  systemResult: InstalledAppsResult,
  remote: FlathubRemoteResult | null,
  appmanResult?: InstalledAppsResult | null
): InstalledInventory {
  // Installed is the host inventory. Keep every Flatpak row, including
  // non-Flathub origins; catalog metadata is not required for existence.
  const userApps = userResult.ok ? withScope(userResult.apps, "user") : [];
  const systemApps = systemResult.ok ? withScope(systemResult.apps, "system") : [];
  const appmanApps =
    appmanResult && appmanResult.ok
      ? appmanResult.apps.map((app) => ({ ...app, installationScope: "user" as const }))
      : [];
  const mergedUser = [...userApps, ...appmanApps];
  return {
    userApps: mergedUser,
    systemApps,
    rows: [...mergedUser, ...systemApps],
    userError: asError(userResult),
    systemError: asError(systemResult),
    appmanError: appmanResult ? asError(appmanResult) : null,
    remote,
  };
}

type AppRef = Pick<CatalogAppSummary, "appId"> & {
  provider?: string;
  sourceId?: string;
};

function sameApp(app: AppSummary, target: AppRef): boolean {
  if (app.appId !== target.appId) {
    return false;
  }
  if (target.provider && app.provider !== target.provider) {
    return false;
  }
  if (target.provider === "appman" && target.sourceId) {
    return (app.sourceId || "am") === target.sourceId;
  }
  return true;
}

export function statusForApp(
  inventory: InstalledInventory,
  target: string | AppRef,
  updates: UserUpdate[] = []
): AppInstallStatus {
  const ref: AppRef = typeof target === "string" ? { appId: target } : target;
  const userApp = inventory.userApps.find((app) => sameApp(app, ref)) ?? null;
  const systemApp =
    ref.provider === "appman"
      ? null
      : inventory.systemApps.find((app) => sameApp(app, ref)) ?? null;
  const userUpdates = updates.filter(
    (item) =>
      item.appId === ref.appId &&
      item.provider !== "appman" &&
      (item.installationScope || "user") === "user"
  );
  const systemUpdates = updates.filter(
    (item) =>
      item.appId === ref.appId &&
      item.provider !== "appman" &&
      item.installationScope === "system"
  );
  return {
    userInstalled: Boolean(userApp),
    systemInstalled: Boolean(systemApp),
    userApp,
    systemApp,
    updates: [...userUpdates, ...systemUpdates],
    userUpdates,
    systemUpdates,
  };
}

export function badgeForApp(
  inventory: InstalledInventory,
  target: string | AppRef,
  updates: UserUpdate[] = []
): CatalogBadge {
  const status = statusForApp(inventory, target, updates);
  if (status.userUpdates.length > 0 || status.systemUpdates.length > 0) {
    return "update";
  }
  if (status.userInstalled) {
    return "installed";
  }
  if (status.systemInstalled) {
    return "system";
  }
  return null;
}

export function friendlyEngineError(result: EngineErrorResult): string {
  return `${result.errorCode}: ${result.errorMessage}`;
}

export function activeTaskForApp(
  task: TaskProgress | null,
  appId: string,
  provider?: string,
  scope?: InstallationScope
): TaskProgress | null {
  if (!task || !isActivePhase(task.phase)) {
    return null;
  }
  if (task.appId === appId && (!provider || task.provider === provider)) {
    if (scope && task.installationScope && task.installationScope !== scope) {
      return null;
    }
    return task;
  }
  if (task.operation === "update_all") {
    if (
      task.appId === UPDATE_ALL_APP_ID &&
      provider !== "appman" &&
      (!scope || scope === "user")
    ) {
      return task;
    }
    if (
      task.appId === SYSTEM_UPDATE_ALL_APP_ID &&
      provider !== "appman" &&
      (!scope || scope === "system")
    ) {
      return task;
    }
    if (task.appId === APPMAN_UPDATE_ALL_APP_ID && provider === "appman") {
      return task;
    }
  }
  return null;
}
