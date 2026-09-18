import { collectedNames } from "../api/inspect";
import { getApps } from "../api/steamCapabilities";
import { ShortcutCapabilities } from "../types/steam";

function methodPresent(apps: Record<string, unknown> | null, name: string): boolean {
  return Boolean(apps && typeof apps[name] === "function");
}

function overviewLookupAvailable(): boolean {
  const store = (
    window as unknown as { appStore?: { GetAppOverviewByAppID?: unknown } }
  ).appStore;
  return typeof store?.GetAppOverviewByAppID === "function";
}

export function probeShortcutCapabilities(): ShortcutCapabilities {
  const apps = getApps();
  const addShortcut = methodPresent(apps, "AddShortcut");
  const removeShortcut = methodPresent(apps, "RemoveShortcut");
  const setShortcutName = methodPresent(apps, "SetShortcutName");
  const setShortcutLaunchOptions = methodPresent(apps, "SetShortcutLaunchOptions");
  const setShortcutStartDir = methodPresent(apps, "SetShortcutStartDir");
  const registerForOverviewChanges = methodPresent(apps, "RegisterForAppOverviewChanges");
  const overviewLookup = overviewLookupAvailable();
  const getShortcutsPresent = Boolean(apps && collectedNames(apps).includes("GetShortcuts"));
  return {
    addShortcut,
    removeShortcut,
    setShortcutName,
    setShortcutLaunchOptions,
    setShortcutStartDir,
    overviewLookup,
    registerForOverviewChanges,
    getShortcutsPresent,
    supported: addShortcut && removeShortcut,
  };
}
