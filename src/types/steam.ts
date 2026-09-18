import type { ProviderId } from "./provider";

export type SteamShortcutState =
  | "unsupported"
  | "not_added"
  | "adding"
  | "added_live"
  | "known_from_plugin_registry"
  | "error";

export type SteamShortcutScope = "user" | "system";

export interface ShortcutMapping {
  provider: ProviderId;
  appId: string;
  installationScope: SteamShortcutScope;
  steamAppId: number;
  gameId?: string | null;
  name: string;
  exe: string;
  startDir: string;
  launchOptions: string;
  createdAtMs: number;
  updatedAtMs: number;
  artworkAppliedAtMs?: number;
  artworkGeneration?: number;
}

export interface ShortcutRegistryList {
  ok: true;
  path: string;
  count: number;
  mappings: ShortcutMapping[];
}

export type ShortcutRegistryLookup =
  | { ok: true; found: true; mapping: ShortcutMapping; key: string }
  | { ok: true; found: false; mapping: null; key: string };

export interface ShortcutCapabilities {
  addShortcut: boolean;
  removeShortcut: boolean;
  setShortcutName: boolean;
  setShortcutLaunchOptions: boolean;
  setShortcutStartDir: boolean;
  overviewLookup: boolean;
  registerForOverviewChanges: boolean;
  getShortcutsPresent: boolean;
  supported: boolean;
}

export interface ShortcutTarget {
  provider: ProviderId;
  appId: string;
  name: string;
  installationScope: SteamShortcutScope;
  exe: string;
  startDir: string;
  launchOptions?: string;
}

export type ShortcutResult =
  | {
      ok: true;
      state: Exclude<SteamShortcutState, "unsupported" | "error">;
      steamAppId: number;
      gameId?: string | null;
      alreadyPresent: boolean;
      hydrationTimedOut: boolean;
      nameSet: boolean;
      launchOptionsSet: boolean;
      mapping: ShortcutMapping;
      overviewPresent: boolean;
    }
  | {
      ok: false;
      state: "unsupported" | "error";
      errorCode: string;
      errorMessage: string;
      details?: Record<string, unknown>;
    };

export type ShortcutStatusResult =
  | {
      ok: true;
      state: SteamShortcutState;
      mapping: ShortcutMapping | null;
      overviewPresent: boolean;
      gameId?: string | null;
      steamAppId?: number;
    }
  | {
      ok: false;
      state: "unsupported" | "error";
      errorCode: string;
      errorMessage: string;
    };
