import type { ProviderId } from "./provider";

export type { ProviderId };

export type InstallationScope = "user" | "system";

export type InstallState =
  | "unknown"
  | "not_installed"
  | "installed"
  | "update_available";

export type TaskPhase =
  | "queued"
  | "starting"
  | "running"
  | "verifying"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskOperation = "install" | "update" | "uninstall" | "update_all";

export interface AppSummary {
  provider: ProviderId;
  appId: string;
  installationScope?: InstallationScope;
  name: string;
  summary?: string | null;
  iconUrl?: string;
  categories: string[];
  nativeCategories?: string[];
  installedState: InstallState;
  installedVersion?: string | null;
  latestVersion?: string | null;
  branch?: string;
  arch?: string;
  origin?: string;
  activeCommit?: string | null;
  ref?: string;
  sourceId?: string;
  sourceLabel?: string;
  amType?: string | null;
  amDb?: string | null;
  hasUpdater?: boolean;
  launchSpec?: AppManLaunchSpec;
}

export type AppManLaunchSpec =
  | {
      ok: true;
      appId: string;
      exe: string;
      args?: string[];
      launchOptions: string;
      startDir: string;
      displayName?: string;
      desktopPath?: string | null;
      iconPath?: string | null;
      source?: string;
    }
  | {
      ok: false;
      appId?: string;
      errorCode: string;
      errorMessage: string;
    };

export interface TaskProgress {
  taskId: string;
  provider: ProviderId;
  appId: string;
  sourceId?: string | null;
  installationScope?: InstallationScope;
  remoteName?: string | null;
  ref?: string | null;
  operation: TaskOperation;
  phase: TaskPhase;
  progressKind: "indeterminate" | "fraction";
  progressPercent?: number;
  statusText?: string;
  errorMessage?: string;
  errorCode?: string;
  exitCode?: number;
  backendSessionId?: string;
  interruptedByUnload?: boolean;
  createdAtMs?: number;
  updatedAtMs?: number;
  installedAfter?: {
    appId: string;
    present: boolean;
    appCount: number;
  } | null;
}

export interface EngineErrorResult {
  ok: false;
  errorCode: string;
  errorMessage: string;
  details?: Record<string, unknown>;
}

export type InstalledAppsResult =
  | {
      ok: true;
      apps: AppSummary[];
      malformedCount: number;
      malformed?: unknown[];
      flatpakPath?: string;
    }
  | EngineErrorResult;

export type FlathubRemoteResult =
  | {
      ok: true;
      present: boolean;
      remoteName: string;
      remotes: Array<{ name: string; title: string; url: string }>;
      flatpakPath?: string;
      alreadyPresent?: boolean;
      added?: boolean;
    }
  | EngineErrorResult;

export type UserUpdatesResult =
  | {
      ok: true;
      updates: UserUpdate[];
      malformedCount: number;
      droppedRelatedCount?: number;
      droppedRelated?: unknown[];
      flatpakPath?: string;
    }
  | EngineErrorResult;

export interface UserUpdate {
  provider: ProviderId;
  installationScope?: InstallationScope;
  appId: string;
  name: string;
  branch: string;
  arch: string;
  origin: string;
  commit: string;
  ref: string;
  remoteVersion?: string | null;
  installedState: InstallState;
}

export type TaskStartResult =
  | { ok: true; taskId: string; task: TaskProgress; alreadyFinished?: boolean }
  | EngineErrorResult;

export type TaskStatusResult =
  | { ok: true; task: TaskProgress; alreadyFinished?: boolean }
  | EngineErrorResult;

export type FlatpakInstallScopePreference = "automatic" | "user" | "system";

export interface SessionBridgeCapability {
  ok: true;
  available: boolean;
  reachable?: boolean;
  authorized?: boolean;
  reason?: string;
  errorCode?: string | null;
  exitCode?: number | null;
  elapsedMs?: number;
}

export type FlatpakScopeStatus =
  | {
      ok: true;
      installScopePreference: FlatpakInstallScopePreference;
      resolvedInstallScope: InstallationScope | null;
      unavailableReason: string | null;
      userRemotePresent: boolean;
      systemRemotePresent: boolean;
      userConfigured: boolean;
      systemConfigured: boolean;
      userUsable: boolean;
      systemUsable: boolean;
      systemMutationsAvailable: boolean;
      userRemoteName?: string | null;
      systemRemoteName?: string | null;
      userRemotes?: Array<{ name: string; title: string; url: string }>;
      systemRemotes?: Array<{ name: string; title: string; url: string }>;
      userRemoteError?: EngineErrorResult | null;
      systemRemoteError?: EngineErrorResult | null;
      bridge?: SessionBridgeCapability;
    }
  | EngineErrorResult;

export function isActivePhase(phase: TaskPhase | undefined): boolean {
  return (
    phase === "queued" ||
    phase === "starting" ||
    phase === "running" ||
    phase === "verifying" ||
    phase === "cancelling"
  );
}
