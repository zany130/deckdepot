import { DialogButton, Focusable } from "@decky/ui";
import type { ReactElement } from "react";
import { confirmAction } from "./confirmAction";
import OperationProgress from "./OperationProgress";
import { AppManLaunchSpec } from "../types/flatpak";
import { ProviderId } from "../types/provider";
import { SteamShortcutScope, SteamShortcutState } from "../types/steam";
import { SteamShortcutStatus, useSteamShortcuts } from "../api/useSteamShortcuts";

function statusLabel(
  state: SteamShortcutState,
  scope: SteamShortcutScope,
  provider: ProviderId
): string {
  if (state === "added_live") {
    return scope === "system" && provider !== "appman"
      ? "On Steam · system launch"
      : "On Steam";
  }
  if (state === "known_from_plugin_registry") {
    return "Mapped in DeckDepot registry; Steam readback missed this ID";
  }
  if (state === "unsupported") {
    return "Steam shortcuts are unavailable on this client.";
  }
  if (state === "error") {
    return "Steam shortcut action failed.";
  }
  if (provider === "appman") {
    return "Not on Steam.";
  }
  return scope === "system"
    ? "Not on Steam. Add uses --system launch options only."
    : "Not on Steam.";
}

function addConfirmBody(appId: string, scope: SteamShortcutScope, provider: ProviderId): string {
  if (provider === "appman") {
    return `Create a Steam shortcut that launches the installed AppMan copy of ${appId}. Steam, not DeckDepot, runs the app.`;
  }
  return scope === "system"
    ? `Create a Steam shortcut that launches the system-wide copy of ${appId}. DeckDepot will not install, update, or uninstall system Flatpaks. Steam, not DeckDepot, runs the app.`
    : `Create a Steam shortcut that launches the user-scoped copy of ${appId}. Steam, not DeckDepot, runs the app.`;
}

export default function SteamActions({
  appId,
  name,
  scope,
  installed,
  steam,
  compact,
  provider = "flatpak",
  launchSpec,
}: {
  appId: string;
  name: string;
  scope: SteamShortcutScope;
  installed: boolean;
  steam: ReturnType<typeof useSteamShortcuts>;
  compact?: boolean;
  provider?: ProviderId;
  launchSpec?: AppManLaunchSpec;
}): ReactElement | null {
  if (!installed) {
    return null;
  }

  const status: SteamShortcutStatus = steam.statusOf(appId, scope, provider);
  if (status.state === "unsupported") {
    return compact ? null : (
      <div style={{ opacity: 0.75, fontSize: "13px" }}>{statusLabel(status.state, scope, provider)}</div>
    );
  }

  const added =
    status.state === "added_live" || status.state === "known_from_plugin_registry";
  const thisOperation =
    steam.operation && steam.operation.appId === appId && steam.operation.active
      ? steam.operation
      : null;
  const launchReady = provider !== "appman" || Boolean(launchSpec && launchSpec.ok);
  const launchReason =
    provider === "appman" && launchSpec && !launchSpec.ok
      ? launchSpec.errorMessage
      : provider === "appman" && !launchSpec
        ? "AppMan did not provide a usable installed launch target."
        : null;
  const canCreate = provider === "appman" ? launchReady : Boolean(steam.exe);
  const disabled = steam.busy || (!added && !canCreate);

  const add = async () => {
    if (!canCreate || steam.busy) {
      return;
    }
    const confirmed = await confirmAction(
      `Add ${name} to Steam?`,
      addConfirmBody(appId, scope, provider)
    );
    if (!confirmed) {
      return;
    }
    await steam.addToSteam({ appId, name, provider, launchSpec }, scope);
  };

  const remove = async () => {
    if (steam.busy) {
      return;
    }
    const confirmed = await confirmAction(
      `Remove ${name} from Steam?`,
      provider === "appman"
        ? `Remove the DeckDepot-mapped Steam shortcut for ${appId}? The AppMan app stays installed.`
        : `Remove the DeckDepot-mapped Steam shortcut for ${appId}? The Flatpak stays installed.`
    );
    if (!confirmed) {
      return;
    }
    await steam.removeFromSteam({ appId, name, provider }, scope);
  };

  const forget = async () => {
    if (steam.busy) {
      return;
    }
    const confirmed = await confirmAction(
      `Forget Steam mapping for ${name}?`,
      "This only clears DeckDepot's registry entry. The Steam shortcut is not removed."
    );
    if (!confirmed) {
      return;
    }
    await steam.forgetMapping({ appId, provider }, scope);
  };

  if (!added && !canCreate && compact) {
    return null;
  }

  return (
    <div>
      {compact ? null : (
        <div style={{ opacity: 0.85, fontSize: "13px", marginBottom: "8px" }}>
          {statusLabel(status.state, scope, provider)}
          {!added && launchReason ? ` ${launchReason}` : ""}
        </div>
      )}
      <Focusable flow-children="row" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {thisOperation ? (
          <OperationProgress view={thisOperation} compact={compact} />
        ) : added ? (
          <DialogButton disabled={steam.busy} onClick={() => void remove()} style={{ width: compact ? "150px" : undefined }}>
            Remove from Steam
          </DialogButton>
        ) : canCreate ? (
          <DialogButton disabled={disabled} onClick={() => void add()} style={{ width: compact ? "150px" : undefined }}>
            Add to Steam
          </DialogButton>
        ) : null}
        {status.state === "known_from_plugin_registry" ? (
          <DialogButton disabled={steam.busy} onClick={() => void forget()} style={{ width: compact ? "140px" : undefined }}>
            Forget mapping
          </DialogButton>
        ) : null}
      </Focusable>
    </div>
  );
}
