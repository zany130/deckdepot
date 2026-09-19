import { useCallback, useEffect, useRef, useState } from "react";
import { notifyOperation } from "./notifications";
import { viewFromTask } from "./operationState";
import {
  addFlathubRemote,
  cancelTask,
  checkFlathubRemote,
  getFlatpakScopeStatus,
  getInstalledApps,
  getSystemInstalledApps,
  getSystemUpdates,
  getTasks,
  getUserUpdates,
  startInstall,
  startUninstall,
  startUpdate,
  startUpdateAll,
} from "./flatpakBridge";
import {
  getAppmanInstalled,
  startAppmanInstall,
  startAppmanUninstall,
  startAppmanUpdate,
  startAppmanUpdateAll,
} from "./appmanBridge";
import {
  InstalledInventory,
  friendlyEngineError,
  mergeInventory,
} from "./installedInventory";
import { subscribeTaskEvents } from "./taskEvents";
import {
  EngineErrorResult,
  FlathubRemoteResult,
  FlatpakScopeStatus,
  InstallationScope,
  TaskProgress,
  TaskStartResult,
  TaskStatusResult,
  UserUpdate,
  isActivePhase,
} from "../types/flatpak";

const emptyInventory: InstalledInventory = {
  userApps: [],
  systemApps: [],
  rows: [],
  userError: null,
  systemError: null,
  appmanError: null,
  remote: null,
};

export function useFlatpakInventory() {
  const [inventory, setInventory] = useState<InstalledInventory>(emptyInventory);
  const [updates, setUpdates] = useState<UserUpdate[]>([]);
  const [updatesError, setUpdatesError] = useState<EngineErrorResult | null>(null);
  const [systemUpdates, setSystemUpdates] = useState<UserUpdate[]>([]);
  const [systemUpdatesError, setSystemUpdatesError] = useState<EngineErrorResult | null>(
    null
  );
  const [scopeStatus, setScopeStatus] = useState<FlatpakScopeStatus | null>(null);
  const [task, setTask] = useState<TaskProgress | null>(null);
  const [backendSessionId, setBackendSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const toastedRef = useRef<string | null>(null);
  const seenActiveRef = useRef<string | null>(null);
  const namesRef = useRef<Record<string, string>>({});
  const batchCountRef = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    const [
      userResult,
      systemResult,
      remotes,
      tasks,
      updateResult,
      systemUpdateResult,
      appmanResult,
      scopeResult,
    ] = await Promise.all([
      getInstalledApps(),
      getSystemInstalledApps(),
      checkFlathubRemote(),
      getTasks(),
      getUserUpdates(),
      getSystemUpdates(),
      getAppmanInstalled(),
      getFlatpakScopeStatus(),
    ]);
    setInventory(mergeInventory(userResult, systemResult, remotes, appmanResult));
    setScopeStatus(scopeResult);
    if (updateResult.ok) {
      const names = new Map(
        (userResult.ok ? userResult.apps : []).map((app) => [app.appId, app.name])
      );
      setUpdates(
        updateResult.updates.map((item) => ({
          ...item,
          installationScope: item.installationScope || "user",
          name: names.get(item.appId) || item.name || item.appId,
        }))
      );
      setUpdatesError(null);
    } else {
      setUpdates([]);
      setUpdatesError(updateResult);
    }
    if (systemUpdateResult.ok) {
      const names = new Map(
        (systemResult.ok ? systemResult.apps : []).map((app) => [app.appId, app.name])
      );
      setSystemUpdates(
        systemUpdateResult.updates.map((item) => ({
          ...item,
          installationScope: "system",
          name: names.get(item.appId) || item.name || item.appId,
        }))
      );
      setSystemUpdatesError(null);
    } else {
      setSystemUpdates([]);
      setSystemUpdatesError(systemUpdateResult);
    }
    if (tasks.ok) {
      if (tasks.backendSessionId) {
        setBackendSessionId(tasks.backendSessionId);
      }
      const active = tasks.tasks.find((item) => isActivePhase(item.phase));
      if (active) {
        setTask(active);
      } else {
        setTask((current) => {
          if (current && isActivePhase(current.phase)) {
            const same = tasks.tasks.find((item) => item.taskId === current.taskId);
            return (
              same ?? {
                ...current,
                phase: "cancelled",
                errorCode: "PROCESS_CANCELLED",
                statusText: "interrupted by plugin reload",
                interruptedByUnload: true,
              }
            );
          }
          const interrupted = tasks.tasks.find((item) => item.interruptedByUnload);
          if (interrupted) {
            return interrupted;
          }
          return tasks.tasks.length > 0
            ? tasks.tasks[tasks.tasks.length - 1]
            : current;
        });
      }
    }
    if (!userResult.ok) {
      setError(friendlyEngineError(userResult));
      return;
    }
    if (!remotes.ok) {
      setError(friendlyEngineError(remotes));
      return;
    }
    setError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribeTaskEvents((payload) => {
      if (
        payload.backendSessionId &&
        backendSessionId &&
        payload.backendSessionId !== backendSessionId
      ) {
        return;
      }
      setTask(payload);
      if (!isActivePhase(payload.phase)) {
        void refresh();
      }
    });
    void (async () => {
      try {
        await refresh();
      } catch (exc) {
        if (!cancelled) {
          setError(String(exc));
        }
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [refresh, backendSessionId]);

  useEffect(() => {
    for (const app of inventory.rows) {
      namesRef.current[app.appId] = app.name;
    }
    for (const item of updates) {
      namesRef.current[item.appId] = item.name;
    }
    for (const item of systemUpdates) {
      namesRef.current[item.appId] = item.name;
    }
  }, [inventory.rows, updates, systemUpdates]);

  useEffect(() => {
    if (!task) {
      return;
    }
    if (isActivePhase(task.phase)) {
      seenActiveRef.current = task.taskId;
      return;
    }
    if (seenActiveRef.current !== task.taskId) {
      return;
    }
    const key = `${task.taskId}:${task.phase}`;
    if (toastedRef.current === key) {
      return;
    }
    toastedRef.current = key;
    if (task.phase !== "completed" && task.phase !== "failed") {
      return;
    }
    const name = namesRef.current[task.appId] || task.appId;
    const view = viewFromTask(task, name, batchCountRef.current);
    notifyOperation(view.toast);
    if (task.operation === "update_all") {
      batchCountRef.current = undefined;
    }
  }, [task]);

  const rememberAppName = (appId: string, name: string) => {
    namesRef.current[appId] = name;
  };

  const rememberBatchCount = (count: number) => {
    batchCountRef.current = count;
  };

  const taskActive = isActivePhase(task?.phase);
  const operationView = task
    ? viewFromTask(
        task,
        namesRef.current[task.appId] || task.appId,
        batchCountRef.current
      )
    : null;

  const run = async (
    work: () => Promise<TaskStartResult | TaskStatusResult | FlathubRemoteResult | void>,
    options?: { ignoreActive?: boolean }
  ) => {
    if (!options?.ignoreActive && (busyRef.current || taskActive)) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await work();
      if (result && "ok" in result && result.ok === false) {
        setError(friendlyEngineError(result));
        notifyOperation(
          result.errorMessage.length <= 80 ? result.errorMessage : "Action failed"
        );
        return result;
      }
      if (result && "ok" in result && result.ok && "task" in result && result.task) {
        setTask(result.task);
      }
      if (result && "ok" in result && result.ok && "present" in result) {
        setInventory((current) => ({ ...current, remote: result }));
      }
      return result;
    } catch (exc) {
      setError(String(exc));
      notifyOperation("Action failed");
      return undefined;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const remote = inventory.remote;
  const scopeOk = Boolean(scopeStatus && scopeStatus.ok);
  const resolvedInstallScope =
    scopeOk && scopeStatus && scopeStatus.ok ? scopeStatus.resolvedInstallScope : null;
  const systemMutationsAvailable =
    scopeOk && scopeStatus && scopeStatus.ok
      ? scopeStatus.systemMutationsAvailable
      : false;
  const userRemotePresent =
    scopeOk && scopeStatus && scopeStatus.ok
      ? scopeStatus.userRemotePresent
      : remote?.ok === true && remote.present === true;
  const systemRemotePresent =
    scopeOk && scopeStatus && scopeStatus.ok ? scopeStatus.systemRemotePresent : false;
  const scopeUnavailableReason =
    scopeOk && scopeStatus && scopeStatus.ok ? scopeStatus.unavailableReason : null;
  const flathubMissing = resolvedInstallScope === "user" && userRemotePresent === false;
  const capabilityBlocked =
    remote?.ok === false &&
    (remote.errorCode === "FLATPAK_NOT_FOUND" ||
      remote.errorCode === "CAPABILITY_UNAVAILABLE");
  const userMutationsDisabled = busy || taskActive || capabilityBlocked;
  const systemMutationsDisabled =
    busy || taskActive || capabilityBlocked || !systemMutationsAvailable;
  const mutationsDisabled = userMutationsDisabled;
  const appmanMutationsDisabled = busy || taskActive;
  const userScopeRelevant = userRemotePresent || inventory.userApps.some(
    (app) => app.provider !== "appman"
  );
  const systemScopeRelevant = systemRemotePresent || inventory.systemApps.length > 0;

  return {
    inventory,
    updates,
    updatesError,
    systemUpdates,
    systemUpdatesError,
    scopeStatus,
    resolvedInstallScope,
    systemMutationsAvailable,
    userRemotePresent,
    systemRemotePresent,
    scopeUnavailableReason,
    userScopeRelevant,
    systemScopeRelevant,
    task,
    operationView,
    error,
    busy,
    refresh,
    run,
    rememberAppName,
    rememberBatchCount,
    taskActive,
    flathubMissing,
    mutationsDisabled,
    userMutationsDisabled,
    systemMutationsDisabled,
    appmanMutationsDisabled,
    installFlatpak: (
      appId: string,
      scope?: InstallationScope,
      remoteName?: string,
      ref?: string
    ) => run(() => startInstall(appId, scope, remoteName, ref)),
    uninstallFlatpak: (appId: string, scope: InstallationScope) =>
      run(() => startUninstall(appId, scope)),
    updateFlatpak: (appId: string, ref: string, scope: InstallationScope) =>
      run(() => startUpdate(appId, ref, scope)),
    installUser: (appId: string) => run(() => startInstall(appId, "user")),
    uninstallUser: (appId: string) => run(() => startUninstall(appId, "user")),
    updateUser: (appId: string, ref: string) => run(() => startUpdate(appId, ref, "user")),
    installAppman: (appId: string, sourceId: string) =>
      run(() => startAppmanInstall(appId, sourceId)),
    uninstallAppman: (appId: string, sourceId: string) =>
      run(() => startAppmanUninstall(appId, sourceId)),
    updateAppman: (appId: string, sourceId: string) =>
      run(() => startAppmanUpdate(appId, sourceId)),
    updateAllAppman: () => run(() => startAppmanUpdateAll()),
    updateAllUser: () => run(() => startUpdateAll("user")),
    updateAllSystem: () => run(() => startUpdateAll("system")),
    enableFlathub: () => run(() => addFlathubRemote()),
    cancelCurrent: () =>
      task ? run(() => cancelTask(task.taskId), { ignoreActive: true }) : Promise.resolve(),
  };
}
