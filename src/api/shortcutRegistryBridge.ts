import { callable } from "@decky/api";
import { EngineErrorResult } from "../types/flatpak";
import {
  ShortcutMapping,
  ShortcutRegistryList,
  ShortcutRegistryLookup,
} from "../types/steam";

export const getFlatpakExecutableSpec = callable<
  [],
  | { ok: true; path: string; startDir: string }
  | EngineErrorResult
>("get_flatpak_executable_spec");

export const listShortcutRegistry = callable<[], ShortcutRegistryList | EngineErrorResult>(
  "list_shortcut_registry"
);

export const getShortcutMapping = callable<
  [provider: string, installationScope: string, appId: string],
  ShortcutRegistryLookup | EngineErrorResult
>("get_shortcut_mapping");

export const upsertShortcutMapping = callable<
  [payload: ShortcutMapping],
  { ok: true; mapping: ShortcutMapping; replaced: boolean } | EngineErrorResult
>("upsert_shortcut_mapping");

export const deleteShortcutMapping = callable<
  [provider: string, installationScope: string, appId: string],
  | { ok: true; removed: boolean; mapping: ShortcutMapping | null; key: string }
  | EngineErrorResult
>("delete_shortcut_mapping");

export const resetShortcutRegistry = callable<
  [],
  | {
      ok: true;
      clearedCount: number;
      steamShortcutsRemoved: false;
      note: string;
    }
  | EngineErrorResult
>("reset_shortcut_registry");
