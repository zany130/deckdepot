import type { InstallationScope, ProviderId, TaskOperation, TaskProgress } from "./flatpak";

export type OperationKind =
  | "install"
  | "update"
  | "update_all"
  | "uninstall"
  | "add_to_steam"
  | "remove_from_steam";

export type OperationStage =
  | "idle"
  | "starting"
  | "downloading"
  | "installing"
  | "updating"
  | "removing"
  | "verifying"
  | "success"
  | "failed"
  | "cancelled";

export interface OperationView {
  kind: OperationKind;
  stage: OperationStage;
  label: string;
  toast: string;
  progressKind: "indeterminate" | "fraction";
  progressPercent?: number;
  appId?: string;
  appName: string;
  provider?: ProviderId;
  scope?: InstallationScope | null;
  active: boolean;
  failed: boolean;
}

export function isLiveStage(stage: OperationStage): boolean {
  return (
    stage === "starting" ||
    stage === "downloading" ||
    stage === "installing" ||
    stage === "updating" ||
    stage === "removing" ||
    stage === "verifying"
  );
}

export function kindFromTask(operation: TaskOperation): OperationKind {
  if (operation === "update_all") {
    return "update_all";
  }
  if (operation === "uninstall") {
    return "uninstall";
  }
  if (operation === "install") {
    return "install";
  }
  return "update";
}

export function stageFromTask(task: TaskProgress): OperationStage {
  switch (task.phase) {
    case "queued":
    case "starting":
      return "starting";
    case "verifying":
      return "verifying";
    case "completed":
      return "success";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "running":
    case "cancelling":
      if (task.operation === "install") {
        return "installing";
      }
      if (task.operation === "uninstall") {
        return "removing";
      }
      return "updating";
    default:
      return "idle";
  }
}
