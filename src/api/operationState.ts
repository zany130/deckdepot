import { TaskProgress } from "../types/flatpak";
import {
  OperationKind,
  OperationStage,
  OperationView,
  isLiveStage,
  kindFromTask,
  stageFromTask,
} from "../types/operation";

export function operationLabel(
  kind: OperationKind,
  stage: OperationStage,
  name: string,
  batchCount?: number
): string {
  const batch =
    kind === "update_all"
      ? batchCount && batchCount > 0
        ? `${batchCount} ${name}`
        : name
      : name;
  if (kind === "add_to_steam") {
    if (stage === "verifying") {
      return "Verifying…";
    }
    if (stage === "starting" || stage === "installing" || stage === "updating") {
      return `Adding ${name} to Steam`;
    }
  }
  switch (stage) {
    case "starting":
      return "Starting…";
    case "downloading":
      return `Downloading ${name}`;
    case "installing":
      return `Installing ${name}`;
    case "updating":
      return kind === "update_all" ? `Updating ${batch}` : `Updating ${name}`;
    case "removing":
      return kind === "remove_from_steam" ? `Removing ${name} from Steam` : `Removing ${name}`;
    case "verifying":
      return "Verifying…";
    case "success":
      return successToast(kind, name, batchCount);
    case "failed":
      return failureToast(kind, name);
    case "cancelled":
      return "Cancelled";
    default:
      return "";
  }
}

export function successToast(kind: OperationKind, name: string, batchCount?: number): string {
  if (kind === "install") {
    return `Installed ${name}`;
  }
  if (kind === "uninstall") {
    return `Removed ${name}`;
  }
  if (kind === "add_to_steam") {
    return `Added ${name} to Steam`;
  }
  if (kind === "remove_from_steam") {
    return `Removed ${name} from Steam`;
  }
  if (kind === "update_all") {
    if (batchCount && batchCount > 0) {
      return `Updated ${batchCount} ${name}`;
    }
    return `Updated ${name}`;
  }
  return `Updated ${name}`;
}

export function failureToast(kind: OperationKind, name: string): string {
  if (kind === "install") {
    return `Failed to install ${name}`;
  }
  if (kind === "uninstall" || kind === "remove_from_steam") {
    return `Could not remove ${name}`;
  }
  if (kind === "add_to_steam") {
    return `Could not add ${name} to Steam`;
  }
  if (kind === "update_all") {
    return `${name} update failed`;
  }
  return `${name} update failed`;
}

export function viewFromTask(
  task: TaskProgress,
  name: string,
  batchCount?: number
): OperationView {
  const kind = kindFromTask(task.operation);
  const stage = stageFromTask(task);
  const batchName =
    kind === "update_all"
      ? task.provider === "appman"
        ? "AppMan apps"
        : "Flatpak apps"
      : name;
  const label = operationLabel(kind, stage, batchName, batchCount);
  return {
    kind,
    stage,
    label,
    toast: stage === "failed" ? failureToast(kind, batchName) : successToast(kind, batchName, batchCount),
    progressKind: task.progressKind === "fraction" && typeof task.progressPercent === "number"
      ? "fraction"
      : "indeterminate",
    progressPercent: task.progressPercent,
    appId: task.appId,
    appName: name,
    provider: task.provider,
    scope: task.installationScope,
    active: isLiveStage(stage),
    failed: stage === "failed",
  };
}

export function steamOperationView(
  kind: "add_to_steam" | "remove_from_steam",
  stage: OperationStage,
  name: string,
  appId: string
): OperationView {
  const label = operationLabel(kind, stage, name);
  return {
    kind,
    stage,
    label,
    toast: stage === "failed" ? failureToast(kind, name) : successToast(kind, name),
    progressKind: "indeterminate",
    appId,
    appName: name,
    active: isLiveStage(stage),
    failed: stage === "failed",
  };
}
