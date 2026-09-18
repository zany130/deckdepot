import { DialogButton, Focusable } from "@decky/ui";
import type { ReactElement } from "react";
import { confirmAction } from "./confirmAction";
import OperationProgress from "./OperationProgress";
import { SteamShortcutScope, SteamShortcutState } from "../types/steam";
import { SteamShortcutStatus, useSteamShortcuts } from "../api/useSteamShortcuts";

function statusLabel(state: SteamShortcutState, scope: SteamShortcutScope): string {
  if (state === "added_live") {
    return scope === "system" ? "On Steam · system launch" : "On Steam";
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
  return scope === "system"
    ? "Not on Steam. Add uses --system launch options only."
    : "Not on Steam.";
}

export default function SteamActions({
  appId,
  name,
  scope,
  installed,
  steam,
  compact,
}: {
  appId: string;
  name: string;
  scope: SteamShortcutScope;
  installed: boolean;
  steam: ReturnType<typeof useSteamShortcuts>;
  compact?: boolean;
}): ReactElement | null {
  if (!installed) {
    return null;
  }

  const status: SteamShortcutStatus = steam.statusOf(appId, scope);
  if (status.state === "unsupported") {
    return compact ? null : (
      <div style={{ opacity: 0.75, fontSize: "13px" }}>{statusLabel(status.state, scope)}</div>
    );
  }

  const added =
    status.state === "added_live" || status.state === "known_from_plugin_registry";
  const thisOperation =
    steam.operation && steam.operation.appId === appId && steam.operation.active
      ? steam.operation
      : null;
  const disabled = steam.busy || !steam.exe;

  const add = async () => {
    const confirmed = await confirmAction(
      `Add ${name} to Steam?`,
      scope === "system"
        ? `Create a Steam shortcut that launches the system-wide copy of ${appId}. DeckDepot will not install, update, or uninstall system Flatpaks. Steam, not DeckDepot, runs the app.`
        : `Create a Steam shortcut that launches the user-scoped copy of ${appId}. Steam, not DeckDepot, runs the app.`
    );
    if (!confirmed) {
      return;
    }
    await steam.addToSteam({ appId, name }, scope);
  };

  const remove = async () => {
    const confirmed = await confirmAction(
      `Remove ${name} from Steam?`,
      `Remove the DeckDepot-mapped Steam shortcut for ${appId}? The Flatpak stays installed.`
    );
    if (!confirmed) {
      return;
    }
    await steam.removeFromSteam({ appId, name }, scope);
  };

  const forget = async () => {
    const confirmed = await confirmAction(
      `Forget Steam mapping for ${name}?`,
      "This only clears DeckDepot's registry entry. The Steam shortcut is not removed."
    );
    if (!confirmed) {
      return;
    }
    await steam.forgetMapping({ appId }, scope);
  };

  return (
    <div>
      {compact ? null : (
        <div style={{ opacity: 0.85, fontSize: "13px", marginBottom: "8px" }}>
          {statusLabel(status.state, scope)}
        </div>
      )}
      <Focusable flow-children="row" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {thisOperation ? (
          <OperationProgress view={thisOperation} compact={compact} />
        ) : added ? (
          <DialogButton disabled={disabled} onClick={() => void remove()} style={{ width: compact ? "150px" : undefined }}>
            Remove from Steam
          </DialogButton>
        ) : (
          <DialogButton disabled={disabled} onClick={() => void add()} style={{ width: compact ? "150px" : undefined }}>
            Add to Steam
          </DialogButton>
        )}
        {status.state === "known_from_plugin_registry" ? (
          <DialogButton disabled={disabled} onClick={() => void forget()} style={{ width: compact ? "140px" : undefined }}>
            Forget mapping
          </DialogButton>
        ) : null}
      </Focusable>
    </div>
  );
}
