import {
  DialogButton,
  Focusable,
  GamepadButton,
  Marquee,
  NavEntryPositionPreferences,
} from "@decky/ui";
import { useEffect, useState, type ReactElement } from "react";
import { friendlyEngineError } from "../api/installedInventory";
import { useFlatpakInventory } from "../api/useFlatpakInventory";
import { confirmAction } from "../components/confirmAction";
import SegmentedControl from "../components/SegmentedControl";
import {
  consumeGamepadEvent,
  embeddedPageStyle,
  focusOutline,
} from "../components/storeLayout";
import { AppSummary, TaskProgress, UserUpdate, isActivePhase } from "../types/flatpak";
import { catalogKey, ProviderId } from "../types/provider";

function dedupeAppman(apps: AppSummary[]): AppSummary[] {
  const seen = new Map<string, AppSummary>();
  for (const app of apps) {
    const key = catalogKey(app);
    if (!seen.has(key)) {
      seen.set(key, app);
    }
  }
  return [...seen.values()];
}

export default function UpdatesRoute(): ReactElement {
  const state = useFlatpakInventory();
  const [provider, setProvider] = useState<ProviderId>("flatpak");
  const [flatpakScope, setFlatpakScope] = useState<"user" | "system">("user");
  const [restoreFlatpakId, setRestoreFlatpakId] = useState<string | null>(null);
  const [restoreAppmanId, setRestoreAppmanId] = useState<string | null>(null);
  const showScopeToggle = state.userScopeRelevant && state.systemScopeRelevant;

  useEffect(() => {
    if (showScopeToggle) {
      return;
    }
    setFlatpakScope(state.systemScopeRelevant && !state.userScopeRelevant ? "system" : "user");
  }, [showScopeToggle, state.systemScopeRelevant, state.userScopeRelevant]);

  const degraded = flatpakScope === "system" ? state.systemUpdatesError : state.updatesError;
  const appmanError = state.inventory.appmanError;
  const flatpakUpdates =
    flatpakScope === "system"
      ? state.systemUpdates.filter((item) => item.provider !== "appman")
      : state.updates.filter((item) => item.provider !== "appman");
  const mutationsDisabled =
    flatpakScope === "system" ? state.systemMutationsDisabled : state.userMutationsDisabled;
  const appmanManaged = dedupeAppman(
    state.inventory.userApps.filter((app) => app.provider === "appman" && app.hasUpdater)
  );
  const emptyFlatpak = !degraded && flatpakUpdates.length === 0;
  const flatpakBannerError =
    (state.error && state.task?.provider !== "appman" ? state.error : null) ||
    (degraded ? friendlyEngineError(degraded) : null);
  const appmanBannerError =
    appmanError
      ? friendlyEngineError(appmanError)
      : state.error && state.task?.provider === "appman"
        ? state.error
        : null;

  const requestFlatpakUpdate = async (update: UserUpdate) => {
    const scope = update.installationScope === "system" ? "system" : "user";
    const confirmed = await confirmAction(
      `Update ${update.name}?`,
      `Update the ${scope}-scoped copy of ${update.appId}? Related runtimes may also be pulled.`
    );
    if (!confirmed) {
      return;
    }
    await state.updateFlatpak(update.appId, update.ref, scope);
  };

  const requestAppmanUpdate = async (app: AppSummary) => {
    const confirmed = await confirmAction(
      `Update ${app.name}?`,
      `Ask AppMan to run the updater for ${app.appId}. AppMan does not say in advance whether a newer version exists.`
    );
    if (!confirmed) {
      return;
    }
    await state.updateAppman(app.appId, app.sourceId || "am");
  };

  const requestFlatpakUpdateAll = async () => {
    const confirmed = await confirmAction(
      `Update all ${flatpakScope}-scoped Flatpak apps?`,
      `Update every listed ${flatpakScope}-scoped Flatpak app. Related runtimes may also be pulled. ${
        flatpakScope === "user" ? "System" : "User"
      } installations and AppMan apps are not changed.`
    );
    if (!confirmed) {
      return;
    }
    if (flatpakScope === "system") {
      await state.updateAllSystem();
      return;
    }
    await state.updateAllUser();
  };

  const requestAppmanUpdateAll = async () => {
    const confirmed = await confirmAction(
      "Run all AppMan updaters?",
      "AppMan will check and update every installed app that has an AM-updater (`appman -y -u --apps`). DeckDepot cannot know in advance which apps actually have a newer version. This does not update Flatpaks or AppMan itself."
    );
    if (!confirmed) {
      return;
    }
    await state.updateAllAppman();
  };

  return (
    <Focusable
      flow-children="column"
      onOKActionDescription="Select"
      onCancelActionDescription="Back"
      style={embeddedPageStyle}
    >
      <div>
        <div style={{ fontSize: "28px", fontWeight: 700 }}>Updates</div>
        <div style={{ opacity: 0.75, fontSize: "13px", marginTop: "4px" }}>
          Flatpak and AppMan stay on separate tabs. Their update commands are not mixed.
        </div>
      </div>
      <SegmentedControl
        value={provider}
        options={[
          { id: "flatpak", label: "Flatpak" },
          { id: "appman", label: "AppMan" },
        ]}
        onChange={(id) => setProvider(id as ProviderId)}
      />

      {state.task ? (
        <TaskChrome task={state.task} onCancel={() => void state.cancelCurrent()} />
      ) : null}

      {provider === "flatpak" ? (
        <>
          {showScopeToggle ? (
            <SegmentedControl
              value={flatpakScope}
              options={[
                { id: "user", label: `User (${state.updates.length})` },
                { id: "system", label: `System (${state.systemUpdates.length})` },
              ]}
              onChange={(id) => setFlatpakScope(id as "user" | "system")}
            />
          ) : null}
          {flatpakScope === "system" && !state.systemMutationsAvailable ? (
            <div style={{ opacity: 0.8 }}>
              System update inventory is shown when available, but system management is
              currently unavailable
              {state.scopeUnavailableReason ? `: ${state.scopeUnavailableReason}` : "."}
            </div>
          ) : null}
          <Focusable
            flow-children="row"
            style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}
            actionDescriptionMap={
              showScopeToggle
                ? {
                    [GamepadButton.BUMPER_LEFT]: "Scope",
                    [GamepadButton.BUMPER_RIGHT]: "Scope",
                  }
                : undefined
            }
            onButtonDown={
              showScopeToggle
                ? (evt) => {
                    if (evt.detail.button === GamepadButton.BUMPER_LEFT) {
                      consumeGamepadEvent(evt);
                      setFlatpakScope((current) => (current === "user" ? "system" : "user"));
                    } else if (evt.detail.button === GamepadButton.BUMPER_RIGHT) {
                      consumeGamepadEvent(evt);
                      setFlatpakScope((current) => (current === "system" ? "user" : "system"));
                    }
                  }
                : undefined
            }
          >
            <DialogButton preferredFocus disabled={state.busy} onClick={() => void state.refresh()}>
              Refresh
            </DialogButton>
            {flatpakUpdates.length > 0 ? (
              <DialogButton
                disabled={mutationsDisabled}
                onClick={() => void requestFlatpakUpdateAll()}
              >
                Update All
              </DialogButton>
            ) : null}
          </Focusable>
          {flatpakBannerError ? (
            <div>
              <div style={{ color: "#ff8a8a", fontWeight: 600 }}>{flatpakBannerError}</div>
              {degraded ? (
                <div style={{ opacity: 0.8, marginTop: "8px" }}>
                  Flatpak update discovery failed. This is not the same as an empty update list.
                  AppMan is not affected.
                </div>
              ) : null}
            </div>
          ) : null}
          {emptyFlatpak ? (
            <div style={{ opacity: 0.85 }}>
              All {flatpakScope}-scoped Flatpak apps are up to date.
            </div>
          ) : null}
          {!degraded && flatpakUpdates.length > 0 ? (
            <Focusable
              flow-children="column"
              navEntryPreferPosition={
                restoreFlatpakId
                  ? NavEntryPositionPreferences.PREFERRED_CHILD
                  : NavEntryPositionPreferences.FIRST
              }
              style={{ display: "flex", flexDirection: "column", gap: "8px" }}
            >
              {flatpakUpdates.map((update) => (
                <UpdateRow
                  key={`${update.installationScope || "user"}:${update.ref || update.appId}`}
                  title={update.name}
                  subtitle={`Flatpak · ${update.installationScope || "user"} · ${update.appId}${update.ref ? ` · ${update.ref}` : ""}${
                    update.origin ? ` · ${update.origin}` : ""
                  }`}
                  preferredFocus={restoreFlatpakId === update.appId}
                  disabled={mutationsDisabled}
                  onUpdate={() => void requestFlatpakUpdate(update)}
                  onFocused={() => setRestoreFlatpakId(update.appId)}
                />
              ))}
            </Focusable>
          ) : null}
        </>
      ) : (
        <>
          <Focusable flow-children="row" style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <DialogButton preferredFocus disabled={state.busy} onClick={() => void state.refresh()}>
              Refresh
            </DialogButton>
            {appmanManaged.length > 0 ? (
              <DialogButton
                disabled={state.appmanMutationsDisabled}
                onClick={() => void requestAppmanUpdateAll()}
              >
                Update All
              </DialogButton>
            ) : null}
          </Focusable>
          <div>
            <div style={{ fontSize: "16px", fontWeight: 650 }}>Apps with AppMan updater support</div>
            <div style={{ opacity: 0.8, fontSize: "13px", marginTop: "4px" }}>
              AppMan does not report which of these already have a newer version. Update
              runs that app's AM-updater after you confirm.
            </div>
          </div>
          {appmanBannerError ? (
            <div>
              <div style={{ color: "#ff8a8a", fontWeight: 600 }}>{appmanBannerError}</div>
              <div style={{ opacity: 0.8, marginTop: "8px" }}>
                AppMan updater listing failed. Flatpak updates are not affected.
              </div>
            </div>
          ) : appmanManaged.length === 0 ? (
            <div style={{ opacity: 0.85 }}>No installed apps with AppMan updater support.</div>
          ) : (
            <Focusable
              flow-children="column"
              navEntryPreferPosition={
                restoreAppmanId
                  ? NavEntryPositionPreferences.PREFERRED_CHILD
                  : NavEntryPositionPreferences.FIRST
              }
              style={{ display: "flex", flexDirection: "column", gap: "8px" }}
            >
              {appmanManaged.map((app) => (
                <UpdateRow
                  key={catalogKey(app)}
                  title={app.name}
                  subtitle={`${app.sourceLabel || "AppMan"} · ${app.appId}${
                    app.installedVersion ? ` · ${app.installedVersion}` : ""
                  }`}
                  preferredFocus={restoreAppmanId === catalogKey(app)}
                  disabled={state.appmanMutationsDisabled}
                  onUpdate={() => void requestAppmanUpdate(app)}
                  onFocused={() => setRestoreAppmanId(catalogKey(app))}
                />
              ))}
            </Focusable>
          )}
        </>
      )}
    </Focusable>
  );
}

function TaskChrome({
  task,
  onCancel,
}: {
  task: TaskProgress;
  onCancel: () => void;
}): ReactElement {
  const taskActive = isActivePhase(task.phase);
  return (
    <div>
      <div style={{ opacity: 0.85, fontSize: "13px", marginBottom: taskActive ? "8px" : 0 }}>
        {task.provider} · {task.operation} {task.appId} · {task.phase}
        {task.statusText ? ` · ${task.statusText}` : ""}
        {" · progress is phase-only, not a percentage"}
      </div>
      {task.errorMessage ? (
        <div style={{ color: "#ff8a8a", marginBottom: "8px" }}>{task.errorMessage}</div>
      ) : null}
      {taskActive ? (
        <DialogButton
          disabled={task.phase === "cancelling"}
          onClick={onCancel}
          style={{ width: "220px" }}
        >
          Cancel
        </DialogButton>
      ) : null}
    </div>
  );
}

function UpdateRow({
  title,
  subtitle,
  preferredFocus,
  disabled,
  onUpdate,
  onFocused,
}: {
  title: string;
  subtitle: string;
  preferredFocus?: boolean;
  disabled?: boolean;
  onUpdate: () => void;
  onFocused: () => void;
}): ReactElement {
  const [focused, setFocused] = useState(false);
  return (
    <Focusable
      preferredFocus={preferredFocus}
      onOKActionDescription="Update"
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
          <Marquee play={focused}>{title}</Marquee>
        </div>
        <div style={{ opacity: 0.75, fontSize: "13px" }}>{subtitle}</div>
      </div>
      <DialogButton
        disabled={disabled}
        onClick={onUpdate}
        style={{ width: "140px", flexShrink: 0 }}
      >
        Update
      </DialogButton>
    </Focusable>
  );
}
