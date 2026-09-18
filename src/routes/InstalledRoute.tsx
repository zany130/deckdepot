import {
  DialogButton,
  Focusable,
  GamepadButton,
  Marquee,
  NavEntryPositionPreferences,
} from "@decky/ui";
import { useEffect, useState, type ReactElement } from "react";
import { useFlatpakInventory } from "../api/useFlatpakInventory";
import { useSteamShortcuts } from "../api/useSteamShortcuts";
import SegmentedControl from "../components/SegmentedControl";
import SteamActions from "../components/SteamActions";
import { confirmAction } from "../components/confirmAction";
import {
  browsePaneStyle,
  consumeGamepadEvent,
  embeddedShellStyle,
  focusOutline,
} from "../components/storeLayout";
import { AppSummary, TaskProgress, isActivePhase } from "../types/flatpak";
import { catalogKey, ProviderId } from "../types/provider";
import { activeTaskForApp } from "../api/installedInventory";
import { viewFromTask } from "../api/operationState";
import OperationProgress from "../components/OperationProgress";

function versionLabel(app: AppSummary): string {
  return app.installedVersion || "Version unavailable";
}

export default function InstalledRoute(): ReactElement {
  const state = useFlatpakInventory();
  const steam = useSteamShortcuts();
  const [provider, setProvider] = useState<ProviderId>("flatpak");
  const [flatpakScope, setFlatpakScope] = useState<"user" | "system">("user");
  const [restoreUserId, setRestoreUserId] = useState<string | null>(null);
  const [restoreSystemId, setRestoreSystemId] = useState<string | null>(null);
  const [restoreAppmanId, setRestoreAppmanId] = useState<string | null>(null);

  const cycleScope = (direction: -1 | 1) => {
    setFlatpakScope((current) => (direction < 0
      ? current === "user" ? "system" : "user"
      : current === "system" ? "user" : "system"));
  };

  const showScopeToggle = state.userScopeRelevant && state.systemScopeRelevant;

  useEffect(() => {
    if (showScopeToggle) {
      return;
    }
    setFlatpakScope(state.systemScopeRelevant && !state.userScopeRelevant ? "system" : "user");
  }, [showScopeToggle, state.systemScopeRelevant, state.userScopeRelevant]);

  const uninstall = async (app: AppSummary) => {
    if (app.provider === "appman") {
      if (state.appmanMutationsDisabled) {
        return;
      }
      const confirmed = await confirmAction(
        `Uninstall ${app.name}?`,
        `Remove the AppMan-managed copy of ${app.appId}? This uses AppMan's no-prompt remove after you confirm here.`
      );
      if (!confirmed) {
        return;
      }
      state.rememberAppName(app.appId, app.name);
      await state.uninstallAppman(app.appId, app.sourceId || "am");
      return;
    }
    const scope = app.installationScope === "system" ? "system" : "user";
    if (scope === "system" ? state.systemMutationsDisabled : state.userMutationsDisabled) {
      return;
    }
    const confirmed = await confirmAction(
      `Uninstall ${app.name}?`,
      `Uninstall the ${scope}-scoped copy of ${app.appId}? This does not remove application data or any ${
        scope === "user" ? "system" : "user"
      }-scoped install.`
    );
    if (!confirmed) {
      return;
    }
    state.rememberAppName(app.appId, app.name);
    await state.uninstallFlatpak(app.appId, scope);
  };

  const updateApp = async (app: AppSummary) => {
    if (app.provider === "appman") {
      if (state.appmanMutationsDisabled) {
        return;
      }
      const confirmed = await confirmAction(
        `Update ${app.name}?`,
        `Ask AppMan to run the updater for ${app.appId}. AppMan does not say in advance whether a newer version exists.`
      );
      if (!confirmed) {
        return;
      }
      state.rememberAppName(app.appId, app.name);
      await state.updateAppman(app.appId, app.sourceId || "am");
      return;
    }
    const scope = app.installationScope === "system" ? "system" : "user";
    if (scope === "system" ? state.systemMutationsDisabled : state.userMutationsDisabled) {
      return;
    }
    const update = (
      scope === "system" ? state.systemUpdates : state.updates
    ).find((item) => item.appId === app.appId);
    if (!update) {
      return;
    }
    const confirmed = await confirmAction(
      `Update ${app.name}?`,
      `Update the ${scope}-scoped copy of ${app.appId}? Related runtimes may also be pulled.`
    );
    if (!confirmed) {
      return;
    }
    state.rememberAppName(app.appId, app.name);
    await state.updateFlatpak(app.appId, update.ref, scope);
  };

  const flatpakUserApps = state.inventory.userApps.filter((app) => app.provider !== "appman");
  const appmanApps = state.inventory.userApps.filter((app) => app.provider === "appman");
  const flatpakCount = flatpakUserApps.length + state.inventory.systemApps.length;

  return (
    <Focusable
      flow-children="column"
      style={{
        ...embeddedShellStyle,
        padding: "12px 18px 0",
        gap: "12px",
        boxSizing: "border-box",
      }}
      onOKActionDescription="Select"
      onCancelActionDescription="Back"
    >
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: "28px", fontWeight: 700 }}>Installed</div>
        <div style={{ opacity: 0.75, fontSize: "13px", marginTop: "4px" }}>
          Flatpak and AppMan stay separate. User / System applies only to Flatpak.
        </div>
      </div>
      <SegmentedControl
        value={provider}
        options={[
          { id: "flatpak", label: `Flatpak (${flatpakCount})` },
          { id: "appman", label: `AppMan (${appmanApps.length})` },
        ]}
        onChange={(id) => setProvider(id as ProviderId)}
      />
      {provider === "flatpak" && showScopeToggle ? (
        <SegmentedControl
          value={flatpakScope}
          options={[
            { id: "user", label: `User (${flatpakUserApps.length})` },
            { id: "system", label: `System (${state.inventory.systemApps.length})` },
          ]}
          onChange={(id) => setFlatpakScope(id as "user" | "system")}
        />
      ) : null}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {provider === "appman" ? (
          <InstalledPane
            scope="user"
            error={state.error}
            empty="No AppMan apps found."
            apps={appmanApps}
            restoreAppId={restoreAppmanId}
            mutationsDisabled={state.appmanMutationsDisabled}
            busy={state.busy}
            task={state.task}
            operationView={state.operationView}
            onRefresh={() => void state.refresh()}
            onCancelTask={() => void state.cancelCurrent()}
            onUninstall={uninstall}
            onUpdate={updateApp}
            steam={steam}
            showSteamChrome={false}
            onFocusApp={setRestoreAppmanId}
          />
        ) : flatpakScope === "user" ? (
          <InstalledPane
            scope="user"
            error={state.error}
            empty="No user-scoped Flatpak apps found."
            apps={flatpakUserApps}
            restoreAppId={restoreUserId}
            flathubMissing={!state.userRemotePresent}
            mutationsDisabled={state.userMutationsDisabled}
            busy={state.busy}
            task={state.task}
            operationView={state.operationView}
            onEnableFlathub={() => void state.enableFlathub()}
            onRefresh={() => void state.refresh()}
            onCancelTask={() => void state.cancelCurrent()}
            onUninstall={uninstall}
            onUpdate={updateApp}
            updateAppIds={new Set(state.updates.map((item) => item.appId))}
            steam={steam}
            onFocusApp={setRestoreUserId}
            onBumper={showScopeToggle ? cycleScope : undefined}
          />
        ) : (
          <InstalledPane
            scope="system"
            error={
              state.inventory.systemError
                ? `${state.inventory.systemError.errorCode}: ${state.inventory.systemError.errorMessage}`
                : null
            }
            empty={
              state.inventory.systemError
                ? "Could not read system-scoped Flatpaks."
                : "No system-scoped Flatpak apps found."
            }
            apps={state.inventory.systemApps}
            restoreAppId={restoreSystemId}
            notice={
              state.systemMutationsAvailable
                ? undefined
                : `System-wide Flatpaks stay visible. System install/update/remove is unavailable${
                    state.scopeUnavailableReason ? `: ${state.scopeUnavailableReason}` : "."
                  }`
            }
            onRefresh={() => void state.refresh()}
            onCancelTask={() => void state.cancelCurrent()}
            onUninstall={uninstall}
            onUpdate={updateApp}
            updateAppIds={new Set(state.systemUpdates.map((item) => item.appId))}
            mutationsDisabled={state.systemMutationsDisabled}
            busy={state.busy}
            task={state.task}
            operationView={state.operationView}
            steam={steam}
            onFocusApp={setRestoreSystemId}
            onBumper={showScopeToggle ? cycleScope : undefined}
          />
        )}
      </div>
    </Focusable>
  );
}

function InstalledPane({
  scope,
  error,
  empty,
  apps,
  restoreAppId,
  notice,
  flathubMissing,
  mutationsDisabled,
  busy,
  task,
  operationView,
  onEnableFlathub,
  onRefresh,
  onCancelTask,
  onUninstall,
  onUpdate,
  updateAppIds,
  steam,
  showSteamChrome = true,
  onFocusApp,
  onBumper,
}: {
  scope: "user" | "system";
  error: string | null;
  empty: string;
  apps: AppSummary[];
  restoreAppId: string | null;
  notice?: string;
  flathubMissing?: boolean;
  mutationsDisabled?: boolean;
  busy?: boolean;
  task?: TaskProgress | null;
  operationView?: ReturnType<typeof viewFromTask> | null;
  onEnableFlathub?: () => void;
  onRefresh?: () => void;
  onCancelTask?: () => void;
  onUninstall?: (app: AppSummary) => void;
  onUpdate?: (app: AppSummary) => void;
  updateAppIds?: Set<string>;
  steam: ReturnType<typeof useSteamShortcuts>;
  showSteamChrome?: boolean;
  onFocusApp: (appId: string) => void;
  onBumper?: (direction: -1 | 1) => void;
}): ReactElement {
  const taskActive = isActivePhase(task?.phase);
  const taskForScope =
    task &&
    (task.provider === "appman"
      ? scope === "user"
      : (task.installationScope || "user") === scope)
      ? task
      : null;
  const scopeView =
    taskForScope && isActivePhase(taskForScope.phase)
      ? operationView && operationView.appId === taskForScope.appId
        ? operationView
        : viewFromTask(taskForScope, taskForScope.appId)
      : null;
  const showUserChrome = scope === "user";

  return (
    <Focusable
      flow-children="column"
      style={{ ...browsePaneStyle, padding: "8px 0 28px" }}
      onOKActionDescription="Select"
      onCancelActionDescription="Back"
      actionDescriptionMap={
        onBumper
          ? {
              [GamepadButton.BUMPER_LEFT]: "Scope",
              [GamepadButton.BUMPER_RIGHT]: "Scope",
            }
          : undefined
      }
      onButtonDown={
        onBumper
          ? (evt) => {
              if (evt.detail.button === GamepadButton.BUMPER_LEFT) {
                consumeGamepadEvent(evt);
                onBumper(-1);
              } else if (evt.detail.button === GamepadButton.BUMPER_RIGHT) {
                consumeGamepadEvent(evt);
                onBumper(1);
              }
            }
          : undefined
      }
    >
      {error ? (
        <div style={{ color: "#ff8a8a", marginBottom: "10px" }}>{error}</div>
      ) : null}

      {notice ? (
        <div style={{ opacity: 0.72, fontSize: "13px", marginBottom: "12px" }}>{notice}</div>
      ) : null}

      {showSteamChrome && steam.unsupported ? (
        <div style={{ opacity: 0.75, fontSize: "13px", marginBottom: "12px" }}>
          Steam shortcuts are unavailable on this client.
        </div>
      ) : showSteamChrome && (steam.readbackUnavailable || steam.staleCount > 0 || steam.error) ? (
        <div style={{ marginBottom: "12px" }}>
          {steam.error ? (
            <div style={{ color: "#ff8a8a", marginBottom: "8px" }}>{steam.error}</div>
          ) : null}
          <div style={{ opacity: 0.75, fontSize: "13px", marginBottom: "8px" }}>
            {steam.readbackUnavailable
              ? "Steam library readback is unavailable. Duplicate protection uses DeckDepot's mapping registry."
              : `${steam.staleCount} Steam mapping(s) could not be confirmed live.`}
          </div>
          <DialogButton
            disabled={steam.busy}
            onClick={() => void (async () => {
              const confirmed = await confirmAction(
                "Reset Steam mappings?",
                "Forget all DeckDepot Steam mappings. This does not call RemoveShortcut; shortcuts stay in Steam until removed individually."
              );
              if (!confirmed) {
                return;
              }
              await steam.resetRegistry();
            })()}
            style={{ width: "220px" }}
          >
            Reset registry
          </DialogButton>
        </div>
      ) : null}

      {onRefresh && (showUserChrome || scope === "system") ? (
        <div style={{ marginBottom: "12px" }}>
          {showUserChrome && flathubMissing ? (
            <div style={{ opacity: 0.8, fontSize: "13px", marginBottom: "8px" }}>
              A user-scoped Flathub remote is required before installing.
            </div>
          ) : null}
          <Focusable flow-children="row" style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {showUserChrome && flathubMissing && onEnableFlathub ? (
              <DialogButton disabled={mutationsDisabled} onClick={onEnableFlathub}>
                Enable Flathub
              </DialogButton>
            ) : null}
            <DialogButton disabled={busy} onClick={onRefresh}>
              Refresh
            </DialogButton>
          </Focusable>
        </div>
      ) : null}

      {taskForScope && scopeView?.active ? (
        <div style={{ marginBottom: "12px" }}>
          <Focusable flow-children="row" style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
            <OperationProgress view={scopeView} />
            {taskActive && onCancelTask && taskForScope.phase !== "verifying" ? (
              <DialogButton
                disabled={taskForScope.phase === "cancelling"}
                onClick={onCancelTask}
                style={{ width: "220px" }}
              >
                Cancel
              </DialogButton>
            ) : null}
          </Focusable>
        </div>
      ) : taskForScope?.errorMessage && !taskActive ? (
        <div style={{ color: "#ff8a8a", marginBottom: "12px" }}>{taskForScope.errorMessage}</div>
      ) : null}

      {apps.length === 0 ? (
        <div style={{ opacity: 0.8 }}>{empty}</div>
      ) : (
        <Focusable
          flow-children="column"
          navEntryPreferPosition={
            restoreAppId && apps.some((app) => catalogKey(app) === restoreAppId)
              ? NavEntryPositionPreferences.PREFERRED_CHILD
              : NavEntryPositionPreferences.FIRST
          }
          style={{ display: "flex", flexDirection: "column", gap: "8px" }}
        >
          {apps.map((app) => (
            <InstalledRow
              key={catalogKey(app)}
              app={app}
              system={scope === "system"}
              mutationsDisabled={Boolean(mutationsDisabled)}
              preferredFocus={restoreAppId === catalogKey(app)}
              task={task}
              onUninstall={onUninstall}
              onUpdate={
                (app.provider === "appman" && app.hasUpdater) ||
                (app.provider !== "appman" && updateAppIds?.has(app.appId))
                  ? onUpdate
                  : undefined
              }
              steam={steam}
              onFocused={() => onFocusApp(catalogKey(app))}
            />
          ))}
        </Focusable>
      )}
    </Focusable>
  );
}

function InstalledRow({
  app,
  system,
  mutationsDisabled,
  preferredFocus,
  task,
  onUninstall,
  onUpdate,
  steam,
  onFocused,
}: {
  app: AppSummary;
  system?: boolean;
  mutationsDisabled?: boolean;
  preferredFocus?: boolean;
  task?: TaskProgress | null;
  onUninstall?: (app: AppSummary) => void;
  onUpdate?: (app: AppSummary) => void;
  steam: ReturnType<typeof useSteamShortcuts>;
  onFocused: () => void;
}): ReactElement {
  const [focused, setFocused] = useState(false);
  const scope = system ? "system" : "user";
  const canMutate = Boolean(onUninstall || onUpdate) && !mutationsDisabled;
  const appTask = activeTaskForApp(task ?? null, app.appId, app.provider, scope);
  const rowView =
    appTask && appTask.operation !== "update_all" ? viewFromTask(appTask, app.name) : null;
  return (
    <Focusable
      preferredFocus={preferredFocus}
      onOKActionDescription={
        canMutate ? (onUpdate ? "Update" : onUninstall ? "Uninstall" : "Select") : "Select"
      }
      onGamepadFocus={() => {
        setFocused(true);
        onFocused();
      }}
      onGamepadBlur={() => setFocused(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        padding: "12px 14px",
        borderRadius: "10px",
        ...focusOutline(focused),
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 650, fontSize: "16px" }}>
          <Marquee play={focused}>{app.name}</Marquee>
        </div>
        <div style={{ opacity: 0.75, fontSize: "13px" }}>
          {app.provider === "appman" ? app.sourceLabel || "AppMan" : app.appId}
          {" · "}
          {versionLabel(app)}
          {app.origin ? ` · ${app.origin}` : ""}
          {app.provider !== "appman" && onUpdate ? " · update available" : ""}
          {app.provider !== "appman" &&
          steam.statusOf(app.appId, scope).state === "added_live"
            ? " · on Steam"
            : ""}
          {app.provider !== "appman" &&
          steam.statusOf(app.appId, scope).state === "known_from_plugin_registry"
            ? " · Steam mapping"
            : ""}
        </div>
      </div>
      <Focusable flow-children="row" style={{ display: "flex", gap: "8px", flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
        {rowView?.active ? (
          <OperationProgress view={rowView} compact />
        ) : (
          <>
        {app.provider === "appman" ? null : (
          <SteamActions
            appId={app.appId}
            name={app.name}
            scope={scope}
            installed
            steam={steam}
            compact
          />
        )}
        {system && mutationsDisabled ? (
          <div style={{ opacity: 0.7, fontSize: "12px", alignSelf: "center" }}>Read-only</div>
        ) : (
          <>
            {onUpdate ? (
              <DialogButton
                disabled={mutationsDisabled}
                onClick={() => onUpdate(app)}
                style={{ width: "120px" }}
              >
                Update
              </DialogButton>
            ) : null}
            {onUninstall ? (
              <DialogButton
                disabled={mutationsDisabled}
                onClick={() => onUninstall(app)}
                style={{ width: "140px" }}
              >
                Uninstall
              </DialogButton>
            ) : null}
          </>
        )}
          </>
        )}
      </Focusable>
    </Focusable>
  );
}
