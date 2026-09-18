import { callable } from "@decky/api";
import {
  FlathubRemoteResult,
  InstalledAppsResult,
  TaskProgress,
  TaskStartResult,
  TaskStatusResult,
  UserUpdatesResult,
} from "../types/flatpak";

export const getInstalledApps = callable<[], InstalledAppsResult>(
  "get_installed_apps"
);

export const getSystemInstalledApps = callable<[], InstalledAppsResult>(
  "get_system_installed_apps"
);

export const getUserUpdates = callable<[], UserUpdatesResult>("get_user_updates");

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

export const startInstall = callable<[appId: string], TaskStartResult>(
  "start_install"
);

export const startUpdate = callable<[appId: string, ref: string], TaskStartResult>(
  "start_update"
);

export const startUpdateAll = callable<[], TaskStartResult>("start_update_all");

export const startUninstall = callable<[appId: string], TaskStartResult>(
  "start_uninstall"
);

export const cancelTask = callable<[taskId: string], TaskStatusResult>(
  "cancel_task"
);
