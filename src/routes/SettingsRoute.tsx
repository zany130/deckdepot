import { useCallback, useEffect, useState, type ReactElement } from "react";
import { DialogButton, Focusable, TextField } from "@decky/ui";
import SettingsDropdown from "../components/SettingsDropdown";
import {
  getAppmanStatus,
  setAppmanSearchScope,
  type AppManStatusResult,
} from "../api/appmanBridge";
import {
  getFlatpakScopeStatus,
  setFlatpakInstallScope,
} from "../api/flatpakBridge";
import {
  clearSteamGridDbApiKey,
  getSteamGridDbStatus,
  setSteamGridDbApiKey,
} from "../api/steamGridDbBridge";
import { confirmAction } from "../components/confirmAction";
import { embeddedPageStyle } from "../components/storeLayout";
import { APPMAN_SEARCH_SCOPE_OPTIONS, AppManSearchScope } from "../types/provider";
import { FlatpakInstallScopePreference, FlatpakScopeStatus } from "../types/flatpak";
import { SteamGridDbStatus } from "../types/steamgriddb";

const FLATPAK_SCOPE_OPTIONS: Array<{
  value: FlatpakInstallScopePreference;
  label: string;
}> = [
  { value: "automatic", label: "Automatic (recommended)" },
  { value: "user", label: "User" },
  { value: "system", label: "System" },
];

function statusLine(status: SteamGridDbStatus | null): string {
  if (!status) {
    return "Loading SteamGridDB settings…";
  }
  if (!status.ok) {
    return `${status.errorCode}: ${status.errorMessage}`;
  }
  if (!status.tlsAvailable) {
    return "Backend HTTPS is unavailable, so SteamGridDB stays disabled. Add to Steam still works.";
  }
  if (status.configured) {
    return "API key saved. Add to Steam will try the first SteamGridDB match for Capsule, Wide Capsule, Hero, Logo, and Icon.";
  }
  return "No API key saved. Add to Steam still works; library artwork is skipped.";
}

export default function SettingsRoute(): ReactElement {
  const [status, setStatus] = useState<SteamGridDbStatus | null>(null);
  const [appman, setAppman] = useState<AppManStatusResult | null>(null);
  const [flatpakScope, setFlatpakScope] = useState<FlatpakScopeStatus | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [next, appmanNext, scopeNext] = await Promise.all([
      getSteamGridDbStatus(),
      getAppmanStatus(),
      getFlatpakScopeStatus(),
    ]);
    setStatus(next);
    setAppman(appmanNext);
    setFlatpakScope(scopeNext);
    if (!next.ok) {
      setError(`${next.errorCode}: ${next.errorMessage}`);
    } else if (appmanNext && "ok" in appmanNext && appmanNext.ok === false) {
      setError(`${appmanNext.errorCode}: ${appmanNext.errorMessage}`);
    } else if (scopeNext && "ok" in scopeNext && scopeNext.ok === false) {
      setError(`${scopeNext.errorCode}: ${scopeNext.errorMessage}`);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await refresh();
      } catch (exc) {
        setError(String(exc));
      }
    })();
  }, [refresh]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await setSteamGridDbApiKey(draft);
      setStatus(next);
      if (next.ok) {
        setDraft("");
      } else {
        setError(`${next.errorCode}: ${next.errorMessage}`);
      }
    } catch (exc) {
      setError(String(exc));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    const confirmed = await confirmAction(
      "Remove SteamGridDB API key?",
      "DeckDepot will stop requesting SteamGridDB art. Existing Steam shortcuts keep whatever art they already have. Add to Steam still works."
    );
    if (!confirmed) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await clearSteamGridDbApiKey();
      setStatus(next);
      setDraft("");
      if (!next.ok) {
        setError(`${next.errorCode}: ${next.errorMessage}`);
      }
    } catch (exc) {
      setError(String(exc));
    } finally {
      setBusy(false);
    }
  };

  const configured = Boolean(status && status.ok && status.configured);
  const appmanOk = Boolean(appman && "ok" in appman && appman.ok);
  const appmanStatus = appmanOk && appman && appman.ok ? appman : null;
  const searchScope: AppManSearchScope = appmanStatus?.searchScope ?? "default";

  const changeScope = async (scope: AppManSearchScope) => {
    setBusy(true);
    setError(null);
    try {
      const next = await setAppmanSearchScope(scope);
      setAppman(next);
      if (!next.ok) {
        setError(`${next.errorCode}: ${next.errorMessage}`);
      }
    } catch (exc) {
      setError(String(exc));
    } finally {
      setBusy(false);
    }
  };

  const changeFlatpakInstallScope = async (scope: FlatpakInstallScopePreference) => {
    setBusy(true);
    setError(null);
    try {
      const next = await setFlatpakInstallScope(scope);
      setFlatpakScope(next);
      if (!next.ok) {
        setError(`${next.errorCode}: ${next.errorMessage}`);
      }
    } catch (exc) {
      setError(String(exc));
    } finally {
      setBusy(false);
    }
  };

  const installPreference: FlatpakInstallScopePreference =
    flatpakScope && flatpakScope.ok ? flatpakScope.installScopePreference : "automatic";
  const resolvedLabel =
    flatpakScope && flatpakScope.ok
      ? flatpakScope.resolvedInstallScope
        ? `New installs use ${flatpakScope.resolvedInstallScope} scope.`
        : flatpakScope.unavailableReason || "No Flatpak install scope is available."
      : "Loading Flatpak install scope…";

  return (
    <Focusable
      flow-children="column"
      onOKActionDescription="Select"
      onCancelActionDescription="Back"
      style={embeddedPageStyle}
    >
      <div>
        <div style={{ fontSize: "28px", fontWeight: 700 }}>Settings</div>
        <div style={{ opacity: 0.75, fontSize: "13px", marginTop: "4px" }}>
          Provider settings stay on this page. SteamGridDB is optional Add to Steam
          artwork. AppMan search scope is separate and does not change Flatpak.
        </div>
      </div>

      <div>
        <div style={{ fontSize: "22px", fontWeight: 700 }}>Flatpak</div>
        <div style={{ opacity: 0.75, fontSize: "13px", marginTop: "4px" }}>
          This setting applies only to new Flatpak installs. Already-installed apps keep
          their real user or system identity. DeckDepot does not create missing remotes.
        </div>
      </div>
      <div style={{ opacity: 0.9 }}>{resolvedLabel}</div>
      {flatpakScope && flatpakScope.ok && !flatpakScope.systemMutationsAvailable ? (
        <div style={{ opacity: 0.8, fontSize: "13px" }}>
          System management is currently unavailable
          {flatpakScope.bridge?.reason ? `: ${flatpakScope.bridge.reason}` : "."}
        </div>
      ) : null}
      <SettingsDropdown
        label="Default Flatpak install scope"
        description="Automatic follows the host: user-only → user, system-only → system, both → system."
        rgOptions={FLATPAK_SCOPE_OPTIONS.map((item) => ({
          data: item.value,
          label: item.label,
        }))}
        selectedOption={installPreference}
        disabled={busy || !(flatpakScope && flatpakScope.ok)}
        onChange={(option) => {
          const value = option.data as FlatpakInstallScopePreference;
          if (value && value !== installPreference) {
            void changeFlatpakInstallScope(value);
          }
        }}
      />

      <div>
        <div style={{ fontSize: "22px", fontWeight: 700 }}>Flatpak / SteamGridDB</div>
        <div style={{ opacity: 0.75, fontSize: "13px", marginTop: "4px" }}>
          SteamGridDB is optional. DeckDepot takes the first matching game and the first
          image in each supported category (Capsule, Wide Capsule, Hero, Logo, Icon).
          For browsing or manual picks, use the dedicated SteamGridDB plugin.
        </div>
      </div>

      <div style={{ opacity: 0.9 }}>{statusLine(status)}</div>
      {error ? <div style={{ color: "#ff8a8a" }}>{error}</div> : null}

      <TextField
        label="SteamGridDB API key"
        bIsPassword
        value={draft}
        disabled={busy}
        onChange={(evt) => setDraft(evt.target.value)}
      />

      <Focusable flow-children="row" style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <DialogButton preferredFocus disabled={busy || !draft.trim()} onClick={() => void save()}>
          Save key
        </DialogButton>
        {configured ? (
          <DialogButton disabled={busy} onClick={() => void clear()}>
            Delete key
          </DialogButton>
        ) : null}
      </Focusable>

      <div>
        <div style={{ fontSize: "22px", fontWeight: 700 }}>AppMan</div>
        <div style={{ opacity: 0.75, fontSize: "13px", marginTop: "4px" }}>
          Portable apps use the same Games, Utilities, Audio & Video, Graphics,
          Network, Office, and Development tabs. AppMan is labeled as a separate
          source. Uncategorized AppMan apps stay in search and installed, not a new
          tab. DeckDepot does not launch AppMan apps.
        </div>
      </div>
      <div style={{ opacity: 0.9 }}>
        {appmanStatus
          ? appmanStatus.available
            ? `Detected ${appmanStatus.version || "AppMan"}${
                appmanStatus.config?.location
                  ? ` · apps in ${appmanStatus.config.location}`
                  : ""
              }`
            : "AppMan is not installed for this user. DeckDepot does not vendor it."
          : "Loading AppMan settings…"}
      </div>
      <SettingsDropdown
        label="AppMan search scope"
        description="Default uses appman -q. All includes third-party databases. This is not a --pkg query."
        rgOptions={APPMAN_SEARCH_SCOPE_OPTIONS.map((item) => ({
          data: item.value,
          label: item.label,
        }))}
        selectedOption={searchScope}
        disabled={busy || !appmanStatus?.available}
        onChange={(option) => {
          const value = option.data as AppManSearchScope;
          if (value && value !== searchScope) {
            void changeScope(value);
          }
        }}
      />
    </Focusable>
  );
}
