import {
  DialogButton,
  Focusable,
  Marquee,
  SteamSpinner,
} from "@decky/ui";
import { useEffect, useState, type ReactElement } from "react";
import { catalogErrorText } from "../api/flathubClient";
import { AppInstallStatus, activeTaskForApp } from "../api/installedInventory";
import { useSteamShortcuts } from "../api/useSteamShortcuts";
import SteamActions from "./SteamActions";
import { CatalogAppDetails, CatalogFailure } from "../types/catalog";
import { TaskProgress } from "../types/flatpak";
import { consumeGamepadEvent, embeddedPageStyle, focusOutline, screenshotRowStyle } from "./storeLayout";

export default function AppDetailsView({
  app,
  loading,
  error,
  onBack,
  onRetry,
  installStatus,
  flathubMissing,
  mutationsDisabled,
  task,
  actionError,
  onInstall,
  onUninstall,
  onUpdate,
  onEnableFlathub,
  onCancelTask,
  steam,
}: {
  app: CatalogAppDetails | null;
  loading: boolean;
  error: CatalogFailure | null;
  onBack: () => void;
  onRetry: () => void;
  installStatus?: AppInstallStatus;
  flathubMissing?: boolean;
  mutationsDisabled?: boolean;
  task?: TaskProgress | null;
  actionError?: string | null;
  onInstall?: () => void;
  onUninstall?: () => void;
  onUpdate?: () => void;
  onEnableFlathub?: () => void;
  onCancelTask?: () => void;
  steam?: ReturnType<typeof useSteamShortcuts>;
}): ReactElement {
  const appTask = app
    ? activeTaskForApp(task ?? null, app.appId, app.provider)
    : null;

  return (
    <Focusable
      flow-children="column"
      onCancel={(evt) => {
        consumeGamepadEvent(evt);
        onBack();
      }}
      onCancelButton={(evt) => {
        consumeGamepadEvent(evt);
        onBack();
      }}
      onCancelActionDescription="Back"
      onOKActionDescription="Select"
      style={embeddedPageStyle}
    >
      <DialogButton preferredFocus onClick={() => onBack()} style={{ width: "220px" }}>
        Back to results
      </DialogButton>

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: "12px", opacity: 0.9 }}>
          <SteamSpinner background="transparent" width={28} height={28} />
          Loading details…
        </div>
      ) : null}

      {error ? (
        <div>
          <div style={{ color: "#ff8a8a", fontWeight: 600 }}>{catalogErrorText(error)}</div>
          <div style={{ opacity: 0.8, marginTop: "8px", marginBottom: "12px" }}>
            Request failed. This is not an empty catalog.
          </div>
          <DialogButton onClick={() => onRetry()} style={{ width: "180px" }}>
            Retry
          </DialogButton>
        </div>
      ) : null}

      {app ? (
        <DetailsBody
          app={app}
          installStatus={installStatus}
          flathubMissing={flathubMissing}
          mutationsDisabled={mutationsDisabled}
          appTask={appTask}
          actionError={actionError}
          onInstall={onInstall}
          onUninstall={onUninstall}
          onUpdate={onUpdate}
          onEnableFlathub={onEnableFlathub}
          onCancelTask={onCancelTask}
          steam={steam}
        />
      ) : null}
    </Focusable>
  );
}

function DetailsBody({
  app,
  installStatus,
  flathubMissing,
  mutationsDisabled,
  appTask,
  actionError,
  onInstall,
  onUninstall,
  onUpdate,
  onEnableFlathub,
  onCancelTask,
  steam,
}: {
  app: CatalogAppDetails;
  installStatus?: AppInstallStatus;
  flathubMissing?: boolean;
  mutationsDisabled?: boolean;
  appTask?: TaskProgress | null;
  actionError?: string | null;
  onInstall?: () => void;
  onUninstall?: () => void;
  onUpdate?: () => void;
  onEnableFlathub?: () => void;
  onCancelTask?: () => void;
  steam?: ReturnType<typeof useSteamShortcuts>;
}): ReactElement {
  const userInstalled = Boolean(installStatus?.userInstalled);
  const systemInstalled = Boolean(installStatus?.systemInstalled);
  const userVersion = installStatus?.userApp?.installedVersion;
  const updateAvailable = Boolean(installStatus?.updates.length);

  return (
    <>
      <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
        <DetailsIcon url={app.iconUrl} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "28px", fontWeight: 700 }}>
            <Marquee>{app.name}</Marquee>
          </div>
          <div style={{ opacity: 0.8 }}>{app.appId}</div>
          <div style={{ opacity: 0.7, marginTop: "4px", fontSize: "13px" }}>
            {app.provider === "appman"
              ? app.sourceLabel || "AppMan"
              : "Flatpak · Flathub"}
            {userInstalled ? " · User install" : ""}
            {systemInstalled ? " · Installed system-wide" : ""}
          </div>
        </div>
      </div>

      {app.summary ? <div style={{ opacity: 0.92, fontSize: "16px" }}>{app.summary}</div> : null}

      <InstallActions
        name={app.name}
        provider={app.provider}
        userInstalled={userInstalled}
        systemInstalled={systemInstalled}
        userVersion={userVersion}
        updateAvailable={app.provider === "appman" ? false : updateAvailable}
        updaterSupported={
          app.provider === "appman"
            ? Boolean(installStatus?.userApp?.hasUpdater)
            : false
        }
        flathubMissing={app.provider === "appman" ? false : flathubMissing}
        mutationsDisabled={mutationsDisabled}
        appTask={appTask}
        actionError={actionError}
        onInstall={onInstall}
        onUninstall={onUninstall}
        onUpdate={onUpdate}
        onEnableFlathub={app.provider === "appman" ? undefined : onEnableFlathub}
        onCancelTask={onCancelTask}
      />

      {app.provider === "appman" ? (
        <div style={{ opacity: 0.8, fontSize: "13px" }}>
          AppMan downloads installation scripts from GitHub. This is not a Flathub
          sandbox. DeckDepot does not launch AppMan apps.
        </div>
      ) : null}

      {steam ? (
        <section>
          <h2 style={sectionTitle}>Steam</h2>
          {steam.error ? (
            <div style={{ color: "#ff8a8a", marginBottom: "10px" }}>{steam.error}</div>
          ) : null}
          {userInstalled ? (
            <SteamActions
              appId={app.appId}
              name={app.name}
              scope="user"
              installed={userInstalled}
              steam={steam}
            />
          ) : null}
          {systemInstalled ? (
            <div style={{ marginTop: userInstalled ? "12px" : 0 }}>
              <SteamActions
                appId={app.appId}
                name={app.name}
                scope="system"
                installed={systemInstalled}
                steam={steam}
              />
            </div>
          ) : null}
          {!userInstalled && !systemInstalled ? (
            <div style={{ opacity: 0.75, fontSize: "13px" }}>
              Install the app before adding it to Steam.
            </div>
          ) : null}
        </section>
      ) : null}

      <section>
        <h2 style={sectionTitle}>About</h2>
        <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.45, opacity: 0.92 }}>
          {app.descriptionText || "No description available."}
        </div>
      </section>

      <section>
        <h2 style={sectionTitle}>Metadata</h2>
        <div style={{ opacity: 0.85, lineHeight: 1.5 }}>
          {[
            app.sourceLabel ? `Source: ${app.sourceLabel}` : null,
            app.amType ? `Format: ${app.amType}` : null,
            app.projectLicense ? `License: ${app.projectLicense}` : null,
            userVersion ? `Installed version: ${userVersion}` : null,
            app.latestVersion ? `Release: ${app.latestVersion}` : null,
            app.launchableDesktopId ? `Launchable: ${app.launchableDesktopId}` : null,
            app.bundleRef ? `Bundle: ${app.bundleRef}` : null,
            app.homepageUrl ? `Homepage: ${app.homepageUrl}` : null,
          ]
            .filter(Boolean)
            .join("\n") || "No extra metadata."}
        </div>
      </section>

      {app.screenshots.length > 0 ? (
        <section>
          <h2 style={sectionTitle}>Screenshots</h2>
          <Focusable flow-children="row" style={screenshotRowStyle}>
            {app.screenshots.slice(0, 6).map((shot) => (
              <ScreenshotTile key={shot.url} url={shot.url} caption={shot.caption} />
            ))}
          </Focusable>
        </section>
      ) : null}

      <div style={{ opacity: 0.7, fontSize: "13px" }}>
        DeckDepot does not launch applications.
      </div>
    </>
  );
}

function InstallActions({
  name,
  provider,
  userInstalled,
  systemInstalled,
  userVersion,
  updateAvailable,
  updaterSupported,
  flathubMissing,
  mutationsDisabled,
  appTask,
  actionError,
  onInstall,
  onUninstall,
  onUpdate,
  onEnableFlathub,
  onCancelTask,
}: {
  name: string;
  provider?: string;
  userInstalled: boolean;
  systemInstalled: boolean;
  userVersion?: string | null;
  updateAvailable?: boolean;
  updaterSupported?: boolean;
  flathubMissing?: boolean;
  mutationsDisabled?: boolean;
  appTask?: TaskProgress | null;
  actionError?: string | null;
  onInstall?: () => void;
  onUninstall?: () => void;
  onUpdate?: () => void;
  onEnableFlathub?: () => void;
  onCancelTask?: () => void;
}): ReactElement {
  return (
    <section>
      <h2 style={sectionTitle}>Install</h2>
      {systemInstalled ? (
        <div style={{ opacity: 0.85, marginBottom: "10px" }}>
          Installed system-wide. DeckDepot v1.0 does not manage system installations.
          {userInstalled
            ? " A separate user-scoped copy is also installed."
            : " You can still install a user-scoped copy."}
        </div>
      ) : null}
      {userInstalled ? (
        <div style={{ opacity: 0.85, marginBottom: "10px" }}>
          Installed for this user
          {userVersion ? ` · ${userVersion}` : " · Version unavailable"}
          {updateAvailable ? " · update available" : updaterSupported ? " · updater supported" : ""}.
        </div>
      ) : null}
      {flathubMissing && provider !== "appman" ? (
        <div style={{ opacity: 0.85, marginBottom: "10px" }}>
          A user-scoped Flathub remote is required before installing.
        </div>
      ) : null}
      {appTask ? (
        <div style={{ opacity: 0.9, marginBottom: "10px" }}>
          {appTask.operation} · {appTask.phase}
          {appTask.statusText ? ` · ${appTask.statusText}` : ""}
          {" · progress is phase-only, not a percentage"}
        </div>
      ) : null}
      {actionError ? (
        <div style={{ color: "#ff8a8a", marginBottom: "10px" }}>{actionError}</div>
      ) : null}
      <Focusable flow-children="row" style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        {flathubMissing && onEnableFlathub ? (
          <DialogButton disabled={mutationsDisabled} onClick={onEnableFlathub}>
            Enable Flathub
          </DialogButton>
        ) : null}
        {!userInstalled && !flathubMissing && onInstall ? (
          <DialogButton disabled={mutationsDisabled} onClick={onInstall}>
            Install
          </DialogButton>
        ) : null}
        {userInstalled && (updateAvailable || updaterSupported) && onUpdate ? (
          <DialogButton disabled={mutationsDisabled} onClick={onUpdate}>
            Update
          </DialogButton>
        ) : null}
        {userInstalled && onUninstall ? (
          <DialogButton disabled={mutationsDisabled} onClick={onUninstall}>
            Uninstall {name}
          </DialogButton>
        ) : null}
        {appTask && onCancelTask ? (
          <DialogButton disabled={appTask.phase === "cancelling"} onClick={onCancelTask}>
            Cancel
          </DialogButton>
        ) : null}
      </Focusable>
    </section>
  );
}

function DetailsIcon({ url }: { url?: string }): ReactElement | null {
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [url]);
  if (!url || broken) {
    return null;
  }
  return (
    <img
      src={url}
      alt=""
      width={80}
      height={80}
      onError={() => setBroken(true)}
      style={{ borderRadius: "14px", objectFit: "cover", flexShrink: 0 }}
    />
  );
}

function ScreenshotTile({
  url,
  caption,
}: {
  url: string;
  caption?: string;
}): ReactElement {
  const [focused, setFocused] = useState(false);
  return (
    <Focusable
      onActivate={() => undefined}
      onOKActionDescription="View"
      onGamepadFocus={() => setFocused(true)}
      onGamepadBlur={() => setFocused(false)}
      style={{
        flexShrink: 0,
        width: "min(72vw, 520px)",
        borderRadius: "10px",
        ...focusOutline(focused),
      }}
    >
      <img
        src={url}
        alt={caption || ""}
        style={{
          width: "100%",
          height: "auto",
          maxHeight: "42vh",
          objectFit: "contain",
          borderRadius: "8px",
          display: "block",
        }}
      />
      {caption ? (
        <div style={{ opacity: 0.75, fontSize: "12px", marginTop: "6px" }}>
          <Marquee play={focused}>{caption}</Marquee>
        </div>
      ) : null}
    </Focusable>
  );
}

const sectionTitle = {
  fontSize: "13px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  opacity: 0.7,
  margin: "0 0 8px",
};
