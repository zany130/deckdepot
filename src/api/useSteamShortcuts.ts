import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAppmanLaunchSpec } from "./appmanBridge";
import { notifyOperation } from "./notifications";
import { failureToast, steamOperationView, successToast } from "./operationState";
import { OperationView } from "../types/operation";
import { AppManLaunchSpec, EngineErrorResult } from "../types/flatpak";
import { ProviderId } from "../types/provider";
import {
  getFlatpakExecutableSpec,
  listShortcutRegistry,
  resetShortcutRegistry,
} from "./shortcutRegistryBridge";
import { lookupOverview } from "./steamCapabilities";
import { probeShortcutCapabilities } from "../steam/capabilityProbe";
import {
  addOwnedShortcut,
  forgetShortcutMapping,
  removeFlatpakShortcut,
  repairOwnedShortcut,
} from "../steam/shortcutManager";
import {
  ShortcutMapping,
  ShortcutResult,
  SteamShortcutScope,
  SteamShortcutState,
} from "../types/steam";

export interface SteamShortcutStatus {
  state: SteamShortcutState;
  mapping: ShortcutMapping | null;
  overviewPresent: boolean;
  steamAppId?: number;
}

function mappingKey(provider: ProviderId, scope: SteamShortcutScope, appId: string): string {
  return `${provider}:${scope}:${appId}`;
}

export function useSteamShortcuts() {
  const [capabilities, setCapabilities] = useState(() => probeShortcutCapabilities());
  const [mappings, setMappings] = useState<ShortcutMapping[]>([]);
  const [exe, setExe] = useState<{ path: string; startDir: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operation, setOperation] = useState<OperationView | null>(null);
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    setCapabilities(probeShortcutCapabilities());
    const [spec, list] = await Promise.all([
      getFlatpakExecutableSpec(),
      listShortcutRegistry(),
    ]);
    if (spec.ok) {
      setExe({ path: spec.path, startDir: spec.startDir });
    } else {
      setExe(null);
    }
    if (list.ok) {
      const repaired: ShortcutMapping[] = [];
      for (const mapping of list.mappings) {
        repaired.push(await repairOwnedShortcut(mapping));
      }
      setMappings(repaired);
      setError(null);
    } else {
      setError(`${list.errorCode}: ${list.errorMessage}`);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
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
    };
  }, [refresh]);

  const byKey = useMemo(() => {
    const map = new Map<string, ShortcutMapping>();
    for (const mapping of mappings) {
      map.set(
        mappingKey(
          mapping.provider || "flatpak",
          mapping.installationScope,
          mapping.appId
        ),
        mapping
      );
    }
    return map;
  }, [mappings]);

  const statusOf = useCallback(
    (
      appId: string,
      scope: SteamShortcutScope,
      provider: ProviderId = "flatpak"
    ): SteamShortcutStatus => {
      if (!capabilities.supported) {
        return { state: "unsupported", mapping: null, overviewPresent: false };
      }
      const mapping = byKey.get(mappingKey(provider, scope, appId)) ?? null;
      if (!mapping) {
        return { state: "not_added", mapping: null, overviewPresent: false };
      }
      const overviewPresent =
        capabilities.overviewLookup &&
        lookupOverview(mapping.steamAppId).present === true;
      return {
        state: overviewPresent ? "added_live" : "known_from_plugin_registry",
        mapping,
        overviewPresent,
        steamAppId: mapping.steamAppId,
      };
    },
    [byKey, capabilities.overviewLookup, capabilities.supported]
  );

  const runOp = async (
    kind: "add_to_steam" | "remove_from_steam",
    name: string,
    appId: string,
    work: () => Promise<ShortcutResult | EngineErrorResult | { ok: true }>
  ) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setOperation(steamOperationView(kind, kind === "remove_from_steam" ? "removing" : "installing", name, appId));
    try {
      const result = await work();
      if ("ok" in result && result.ok === false) {
        setError(`${result.errorCode}: ${result.errorMessage}`);
        notifyOperation(failureToast(kind, name));
        setOperation(null);
        return result;
      }
      if (kind === "add_to_steam") {
        setOperation(steamOperationView(kind, "updating", name, appId));
        await refresh();
        setOperation(steamOperationView(kind, "verifying", name, appId));
      } else {
        setOperation(steamOperationView(kind, "verifying", name, appId));
        await refresh();
      }
      notifyOperation(successToast(kind, name));
      setOperation(null);
      return result;
    } catch (exc) {
      const message = String(exc);
      setError(message);
      notifyOperation(failureToast(kind, name));
      setOperation(null);
      return {
        ok: false as const,
        state: "error" as const,
        errorCode: "STEAM_OPERATION_FAILED",
        errorMessage: message,
      };
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const addToSteam = (
    app: {
      appId: string;
      name: string;
      provider?: ProviderId;
      launchSpec?: AppManLaunchSpec;
    },
    scope: SteamShortcutScope
  ) => {
    if (!capabilities.supported) {
      return Promise.resolve({
        ok: false as const,
        state: "unsupported" as const,
        errorCode: "STEAM_API_UNAVAILABLE",
        errorMessage: "Steam AddShortcut/RemoveShortcut is not available.",
      });
    }
    const provider = app.provider || "flatpak";
    return runOp("add_to_steam", app.name, app.appId, async () => {
      if (provider === "appman") {
        const spec =
          app.launchSpec && app.launchSpec.ok
            ? app.launchSpec
            : await getAppmanLaunchSpec(app.appId);
        if (!spec.ok) {
          return {
            ok: false as const,
            state: "error" as const,
            errorCode: spec.errorCode,
            errorMessage: spec.errorMessage,
          };
        }
        return addOwnedShortcut({
          provider: "appman",
          appId: app.appId,
          name: spec.displayName || app.name,
          installationScope: "user",
          exe: spec.exe,
          startDir: spec.startDir,
          launchOptions: spec.launchOptions,
        });
      }
      if (!exe) {
        return {
          ok: false as const,
          state: "error" as const,
          errorCode: "FLATPAK_NOT_FOUND",
          errorMessage: "Flatpak executable path is unavailable.",
        };
      }
      return addOwnedShortcut({
        provider: "flatpak",
        appId: app.appId,
        name: app.name,
        installationScope: scope,
        exe: exe.path,
        startDir: exe.startDir,
      });
    });
  };

  const runQuiet = async (
    work: () => Promise<ShortcutResult | EngineErrorResult | { ok: true }>
  ) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await work();
      if ("ok" in result && result.ok === false) {
        setError(`${result.errorCode}: ${result.errorMessage}`);
        return result;
      }
      await refresh();
      return result;
    } catch (exc) {
      const message = String(exc);
      setError(message);
      return {
        ok: false as const,
        state: "error" as const,
        errorCode: "STEAM_OPERATION_FAILED",
        errorMessage: message,
      };
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const staleCount = mappings.filter((mapping) => {
    if (!capabilities.overviewLookup) {
      return true;
    }
    return lookupOverview(mapping.steamAppId).present !== true;
  }).length;

  return {
    capabilities,
    mappings,
    exe,
    busy,
    error,
    operation,
    unsupported: !capabilities.supported,
    readbackUnavailable: capabilities.supported && !capabilities.overviewLookup,
    staleCount,
    refresh,
    statusOf,
    addToSteam,
    removeFromSteam: (
      app: { appId: string; name?: string; provider?: ProviderId },
      scope: SteamShortcutScope
    ) =>
      runOp("remove_from_steam", app.name || app.appId, app.appId, () =>
        removeFlatpakShortcut({
          provider: app.provider || "flatpak",
          appId: app.appId,
          installationScope: app.provider === "appman" ? "user" : scope,
        })
      ),
    forgetMapping: (
      app: { appId: string; provider?: ProviderId },
      scope: SteamShortcutScope
    ) =>
      runQuiet(() =>
        forgetShortcutMapping({
          provider: app.provider || "flatpak",
          appId: app.appId,
          installationScope: app.provider === "appman" ? "user" : scope,
        })
      ),
    resetRegistry: () => runQuiet(() => resetShortcutRegistry()),
  };
}
