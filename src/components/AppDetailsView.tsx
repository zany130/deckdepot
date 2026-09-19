import {
  DialogButton,
  Focusable,
  Marquee,
  SteamSpinner,
} from "@decky/ui";
import { useEffect, useState, type ReactElement } from "react";
import { catalogErrorText } from "../api/flathubClient";
import { AppInstallStatus, activeTaskForApp } from "../api/installedInventory";
import { viewFromTask } from "../api/operationState";
import { useSteamShortcuts } from "../api/useSteamShortcuts";
import OperationProgress from "./OperationProgress";
import SteamActions from "./SteamActions";
import { CatalogAppDetails, CatalogFailure } from "../types/catalog";
import { InstallationScope, TaskProgress } from "../types/flatpak";
import { consumeGamepadEvent, embeddedPageStyle, focusOutline, screenshotRowStyle } from "./storeLayout";

export default function AppDetailsView({
  app,
  loading,
  error,
  onBack,
  onRetry,
  installStatus,
  flathubMissing,
  resolvedInstallScope,
  scopeUnavailableReason,
  systemMutationsAvailable,
  userMutationsDisabled,
  systemMutationsDisabled,
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
  resolvedInstallScope?: InstallationScope | null;
  scopeUnavailableReason?: string | null;
  systemMutationsAvailable?: boolean;
  userMutationsDisabled?: boolean;
  systemMutationsDisabled?: boolean;
  mutationsDisabled?: boolean;
  task?: TaskProgress | null;
  actionError?: string | null;
  onInstall?: () => void;
  onUninstall?: (scope: InstallationScope) => void;
  onUpdate?: (scope: InstallationScope) => void;
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
          resolvedInstallScope={resolvedInstallScope}
          scopeUnavailableReason={scopeUnavailableReason}
          systemMutationsAvailable={systemMutationsAvailable}
          userMutationsDisabled={userMutationsDisabled ?? mutationsDisabled}
          systemMutationsDisabled={systemMutationsDisabled ?? true}
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
  resolvedInstallScope,
  scopeUnavailableReason,
  systemMutationsAvailable,
  userMutationsDisabled,
  systemMutationsDisabled,
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
  resolvedInstallScope?: InstallationScope | null;
  scopeUnavailableReason?: string | null;
  systemMutationsAvailable?: boolean;
  userMutationsDisabled?: boolean;
  systemMutationsDisabled?: boolean;
  appTask?: TaskProgress | null;
  actionError?: string | null;
  onInstall?: () => void;
  onUninstall?: (scope: InstallationScope) => void;
  onUpdate?: (scope: InstallationScope) => void;
  onEnableFlathub?: () => void;
  onCancelTask?: () => void;
  steam?: ReturnType<typeof useSteamShortcuts>;
}): ReactElement {
  const userInstalled = Boolean(installStatus?.userInstalled);
  const systemInstalled = Boolean(installStatus?.systemInstalled);
  const userVersion = installStatus?.userApp?.installedVersion;
  const systemVersion = installStatus?.systemApp?.installedVersion;
  const userUpdateAvailable = Boolean(installStatus?.userUpdates.length);
  const systemUpdateAvailable = Boolean(installStatus?.systemUpdates.length);
  const alreadyInResolvedScope =
    resolvedInstallScope === "user"
      ? userInstalled
      : resolvedInstallScope === "system"
        ? systemInstalled
        : true;

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
              : `Flatpak${flatpakOriginLabel(app, installStatus)}`}
            {app.provider !== "appman" && app.installationScope && !userInstalled && !systemInstalled
              ? ` · ${app.installationScope}`
              : ""}
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
        systemVersion={systemVersion}
        userUpdateAvailable={app.provider === "appman" ? false : userUpdateAvailable}
        systemUpdateAvailable={app.provider === "appman" ? false : systemUpdateAvailable}
        updaterSupported={
          app.provider === "appman"
            ? Boolean(installStatus?.userApp?.hasUpdater)
            : false
        }
        alreadyInResolvedScope={alreadyInResolvedScope}
        resolvedInstallScope={app.provider === "appman" ? null : resolvedInstallScope}
        scopeUnavailableReason={app.provider === "appman" ? null : scopeUnavailableReason}
        flathubMissing={app.provider === "appman" ? false : flathubMissing}
        systemMutationsAvailable={systemMutationsAvailable}
        userMutationsDisabled={userMutationsDisabled}
        systemMutationsDisabled={systemMutationsDisabled ?? true}
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
              provider={app.provider}
              launchSpec={installStatus?.userApp?.launchSpec || app.launchSpec}
            />
          ) : null}
          {systemInstalled && app.provider !== "appman" ? (
            <div style={{ marginTop: userInstalled ? "12px" : 0 }}>
              <SteamActions
                appId={app.appId}
                name={app.name}
                scope="system"
                installed={systemInstalled}
                steam={steam}
                provider={app.provider}
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
          {aboutText(app)}
        </div>
      </section>

      <section>
        <h2 style={sectionTitle}>Metadata</h2>
        <div style={{ opacity: 0.85, lineHeight: 1.5 }}>
          {[
            app.sourceLabel ? `Source: ${app.sourceLabel}` : null,
            app.provider !== "appman"
              ? `Origin: ${installedOrigin(app, installStatus) || app.sourceLabel || app.remoteName || "Flathub"}`
              : null,
            app.installationScope && !userInstalled && !systemInstalled
              ? `Scope: ${app.installationScope}`
              : null,
            userInstalled ? "Scope: user" : null,
            systemInstalled ? "Scope: system" : null,
            app.amType ? `Format: ${app.amType}` : null,
            app.projectLicense ? `License: ${app.projectLicense}` : null,
            userVersion ? `User version: ${userVersion}` : null,
            systemVersion ? `System version: ${systemVersion}` : null,
            app.latestVersion ? `Release: ${app.latestVersion}` : null,
            app.launchableDesktopId ? `Launchable: ${app.launchableDesktopId}` : null,
            app.bundleRef ? `Bundle: ${app.bundleRef}` : null,
            app.homepageUrl ? `Homepage: ${app.homepageUrl}` : null,
          ]
            .filter(Boolean)
            .join("\n") || "No extra metadata."}
        </div>
      </section>

      {app.screenshots && app.screenshots.length > 0 ? (
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
  systemVersion,
  userUpdateAvailable,
  systemUpdateAvailable,
  updaterSupported,
  alreadyInResolvedScope,
  resolvedInstallScope,
  scopeUnavailableReason,
  flathubMissing,
  systemMutationsAvailable,
  userMutationsDisabled,
  systemMutationsDisabled,
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
  systemVersion?: string | null;
  userUpdateAvailable?: boolean;
  systemUpdateAvailable?: boolean;
  updaterSupported?: boolean;
  alreadyInResolvedScope?: boolean;
  resolvedInstallScope?: InstallationScope | null;
  scopeUnavailableReason?: string | null;
  flathubMissing?: boolean;
  systemMutationsAvailable?: boolean;
  userMutationsDisabled?: boolean;
  systemMutationsDisabled?: boolean;
  appTask?: TaskProgress | null;
  actionError?: string | null;
  onInstall?: () => void;
  onUninstall?: (scope: InstallationScope) => void;
  onUpdate?: (scope: InstallationScope) => void;
  onEnableFlathub?: () => void;
  onCancelTask?: () => void;
}): ReactElement {
  const showInstall =
    provider !== "appman"
      ? Boolean(onInstall) && Boolean(resolvedInstallScope) && !alreadyInResolvedScope && !flathubMissing
      : Boolean(onInstall) && !userInstalled;
  const view = appTask ? viewFromTask(appTask, name) : null;
  return (
    <section>
      <h2 style={sectionTitle}>Install</h2>
      {systemInstalled ? (
        <div style={{ opacity: 0.85, marginBottom: "10px" }}>
          Installed system-wide
          {systemVersion ? ` · ${systemVersion}` : " · Version unavailable"}
          {systemUpdateAvailable ? " · update available" : ""}.
          {!systemMutationsAvailable
            ? " System management is currently unavailable."
            : ""}
        </div>
      ) : null}
      {userInstalled ? (
        <div style={{ opacity: 0.85, marginBottom: "10px" }}>
          Installed for this user
          {userVersion ? ` · ${userVersion}` : " · Version unavailable"}
          {userUpdateAvailable ? " · update available" : updaterSupported ? " · updater supported" : ""}.
        </div>
      ) : null}
      {provider !== "appman" && !resolvedInstallScope && scopeUnavailableReason ? (
        <div style={{ opacity: 0.85, marginBottom: "10px" }}>{scopeUnavailableReason}</div>
      ) : null}
      {flathubMissing && provider !== "appman" ? (
        <div style={{ opacity: 0.85, marginBottom: "10px" }}>
          A user-scoped Flathub remote is required before installing. DeckDepot will
          not create a missing remote unless you enable it here.
        </div>
      ) : null}
      {actionError ? (
        <div style={{ color: "#ff8a8a", marginBottom: "10px" }}>{actionError}</div>
      ) : null}
      <Focusable flow-children="row" style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
        {view?.active ? (
          <>
            <OperationProgress view={view} />
            {onCancelTask && appTask && appTask.phase !== "verifying" ? (
              <DialogButton disabled={appTask.phase === "cancelling"} onClick={onCancelTask}>
                Cancel
              </DialogButton>
            ) : null}
          </>
        ) : (
          <>
        {flathubMissing && onEnableFlathub ? (
          <DialogButton disabled={userMutationsDisabled} onClick={onEnableFlathub}>
            Enable Flathub
          </DialogButton>
        ) : null}
        {showInstall ? (
          <DialogButton
            disabled={
              resolvedInstallScope === "system" ? systemMutationsDisabled : userMutationsDisabled
            }
            onClick={onInstall}
          >
            {resolvedInstallScope ? `Install (${resolvedInstallScope})` : "Install"}
          </DialogButton>
        ) : null}
        {userInstalled && (userUpdateAvailable || updaterSupported) && onUpdate ? (
          <DialogButton
            disabled={userMutationsDisabled}
            onClick={() => onUpdate("user")}
          >
            Update user
          </DialogButton>
        ) : null}
        {systemInstalled && systemUpdateAvailable && onUpdate ? (
          <DialogButton
            disabled={systemMutationsDisabled}
            onClick={() => onUpdate("system")}
          >
            Update system
          </DialogButton>
        ) : null}
        {userInstalled && onUninstall ? (
          <DialogButton
            disabled={userMutationsDisabled}
            onClick={() => onUninstall("user")}
          >
            Uninstall {name}
          </DialogButton>
        ) : null}
        {systemInstalled && onUninstall ? (
          <DialogButton
            disabled={systemMutationsDisabled}
            onClick={() => onUninstall("system")}
          >
            Uninstall system
          </DialogButton>
        ) : null}
          </>
        )}
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

function installedOrigin(
  app: CatalogAppDetails,
  installStatus?: AppInstallStatus
): string | undefined {
  const local =
    app.origin?.trim() ||
    installStatus?.userApp?.origin?.trim() ||
    installStatus?.systemApp?.origin?.trim() ||
    "";
  if (local) {
    return local;
  }
  if (installStatus?.userInstalled || installStatus?.systemInstalled) {
    return "unknown remote";
  }
  return undefined;
}

function flatpakOriginLabel(
  app: CatalogAppDetails,
  installStatus?: AppInstallStatus
): string {
  const origin = installedOrigin(app, installStatus) || app.sourceLabel || app.remoteName || "Flathub";
  return ` · ${origin}`;
}

function aboutText(app: CatalogAppDetails): string {
  if (app.provider === "appman") {
    return (
      app.descriptionText?.trim() ||
      app.summary?.trim() ||
      "No description available."
    );
  }
  return app.descriptionText || "No description available.";
}

const sectionTitle = {
  fontSize: "13px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  opacity: 0.7,
  margin: "0 0 8px",
};
