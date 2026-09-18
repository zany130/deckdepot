import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getFlatpakExecutableSpec,
  listShortcutRegistry,
  resetShortcutRegistry,
} from "./shortcutRegistryBridge";
import { lookupOverview } from "./steamCapabilities";
import { probeShortcutCapabilities } from "../steam/capabilityProbe";
import {
  addFlatpakShortcut,
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
import { EngineErrorResult } from "../types/flatpak";

export interface SteamShortcutStatus {
  state: SteamShortcutState;
  mapping: ShortcutMapping | null;
  overviewPresent: boolean;
  steamAppId?: number;
}

function mappingKey(scope: SteamShortcutScope, appId: string): string {
  return `${scope}:${appId}`;
}

export function useSteamShortcuts() {
  const [capabilities, setCapabilities] = useState(() => probeShortcutCapabilities());
  const [mappings, setMappings] = useState<ShortcutMapping[]>([]);
  const [exe, setExe] = useState<{ path: string; startDir: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(`${spec.errorCode}: ${spec.errorMessage}`);
    }
    if (list.ok) {
      const repaired: ShortcutMapping[] = [];
      for (const mapping of list.mappings) {
        repaired.push(await repairOwnedShortcut(mapping));
      }
      setMappings(repaired);
      if (spec.ok) {
        setError(null);
      }
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
      map.set(mappingKey(mapping.installationScope, mapping.appId), mapping);
    }
    return map;
  }, [mappings]);

  const statusOf = useCallback(
    (appId: string, scope: SteamShortcutScope): SteamShortcutStatus => {
      if (!capabilities.supported) {
        return { state: "unsupported", mapping: null, overviewPresent: false };
      }
      const mapping = byKey.get(mappingKey(scope, appId)) ?? null;
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

  const run = async (
    work: () => Promise<ShortcutResult | EngineErrorResult | { ok: true }>
  ) => {
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
      setBusy(false);
    }
  };

  const addToSteam = (
    app: { appId: string; name: string },
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
    if (!exe) {
      return Promise.resolve({
        ok: false as const,
        state: "error" as const,
        errorCode: "FLATPAK_NOT_FOUND",
        errorMessage: "Flatpak executable path is unavailable.",
      });
    }
    return run(() =>
      addFlatpakShortcut({
        provider: "flatpak",
        appId: app.appId,
        name: app.name,
        installationScope: scope,
        exe: exe.path,
        startDir: exe.startDir,
      })
    );
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
    unsupported: !capabilities.supported,
    readbackUnavailable: capabilities.supported && !capabilities.overviewLookup,
    staleCount,
    refresh,
    statusOf,
    addToSteam,
    removeFromSteam: (app: { appId: string }, scope: SteamShortcutScope) =>
      run(() =>
        removeFlatpakShortcut({
          provider: "flatpak",
          appId: app.appId,
          installationScope: scope,
        })
      ),
    forgetMapping: (app: { appId: string }, scope: SteamShortcutScope) =>
      run(() =>
        forgetShortcutMapping({
          provider: "flatpak",
          appId: app.appId,
          installationScope: scope,
        })
      ),
    resetRegistry: () => run(() => resetShortcutRegistry()),
  };
}
