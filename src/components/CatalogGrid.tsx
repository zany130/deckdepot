import {
  DialogButton,
  Focusable,
  GamepadButton,
  NavEntryPositionPreferences,
  SteamSpinner,
} from "@decky/ui";
import type { MutableRefObject, ReactElement } from "react";
import { catalogErrorText } from "../api/flathubClient";
import { CatalogBadge } from "../api/installedInventory";
import { CatalogAppSummary, CatalogFailure } from "../types/catalog";
import { catalogKey } from "../types/provider";
import AppTile from "./AppTile";
import { appGridStyle, browsePaneStyle, consumeGamepadEvent } from "./storeLayout";

export default function CatalogGrid({
  apps,
  loading,
  loadingMore,
  error,
  emptyMessage,
  statusLabel,
  restoreAppId,
  canLoadMore,
  onOpen,
  onSearch,
  onRetry,
  onLoadMore,
  onBumper,
  onCancel,
  onFocusApp,
  badgeForApp,
  tileRefs,
}: {
  apps: CatalogAppSummary[];
  loading: boolean;
  loadingMore?: boolean;
  error: CatalogFailure | null;
  emptyMessage?: string;
  statusLabel?: string;
  restoreAppId: string | null;
  canLoadMore: boolean;
  onOpen: (app: CatalogAppSummary) => void;
  onSearch?: () => void;
  onRetry?: () => void;
  onLoadMore?: () => void;
  onBumper?: (direction: -1 | 1) => void;
  onCancel?: () => void;
  onFocusApp?: (app: CatalogAppSummary) => void;
  badgeForApp?: (app: CatalogAppSummary) => CatalogBadge;
  tileRefs: MutableRefObject<Map<string, HTMLDivElement>>;
}): ReactElement {
  return (
    <Focusable
      flow-children="column"
      style={browsePaneStyle}
      onOKActionDescription="Select"
      onCancelActionDescription="Back"
      onOptionsActionDescription={onSearch ? "Search" : undefined}
      onCancelButton={
        onCancel
          ? (evt) => {
              consumeGamepadEvent(evt);
              onCancel();
            }
          : undefined
      }
      onCancel={
        onCancel
          ? (evt) => {
              consumeGamepadEvent(evt);
              onCancel();
            }
          : undefined
      }
      onOptionsButton={
        onSearch
          ? (evt) => {
              consumeGamepadEvent(evt);
              onSearch();
            }
          : undefined
      }
      actionDescriptionMap={
        onBumper
          ? {
              [GamepadButton.BUMPER_LEFT]: "Category",
              [GamepadButton.BUMPER_RIGHT]: "Category",
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
      {statusLabel ? (
        <div
          style={{
            fontSize: "13px",
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            opacity: 0.7,
            marginBottom: "10px",
          }}
        >
          {statusLabel}
        </div>
      ) : null}

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: "12px", opacity: 0.9 }}>
          <SteamSpinner background="transparent" width={28} height={28} />
          Loading catalog…
        </div>
      ) : null}

      {error ? (
        <div>
          <div style={{ color: "#ff8a8a" }}>{catalogErrorText(error)}</div>
          <div style={{ opacity: 0.8, marginTop: "8px", marginBottom: "12px" }}>
            Request failed. This is not an empty result.
          </div>
          {onRetry ? (
            <DialogButton onClick={onRetry} style={{ width: "160px" }}>
              Retry
            </DialogButton>
          ) : null}
        </div>
      ) : null}

      {!loading && !error && apps.length === 0 && emptyMessage ? (
        <div style={{ opacity: 0.85 }}>{emptyMessage}</div>
      ) : null}

      {!loading && !error && apps.length > 0 ? (
        <>
          <Focusable
            flow-children="grid"
            navEntryPreferPosition={
              restoreAppId && apps.some((app) => catalogKey(app) === restoreAppId)
                ? NavEntryPositionPreferences.PREFERRED_CHILD
                : NavEntryPositionPreferences.FIRST
            }
            style={appGridStyle}
          >
            {apps.map((app) => (
              <AppTile
                key={catalogKey(app)}
                app={app}
                preferredFocus={restoreAppId === catalogKey(app)}
                onOpen={() => onOpen(app)}
                onSearch={onSearch}
                onFocused={() => onFocusApp?.(app)}
                badge={badgeForApp?.(app)}
                focusRef={(node) => {
                  const key = catalogKey(app);
                  if (node) {
                    tileRefs.current.set(key, node);
                  } else {
                    tileRefs.current.delete(key);
                  }
                }}
              />
            ))}
          </Focusable>
          {canLoadMore && onLoadMore ? (
            <div style={{ marginTop: "16px", width: "min(100%, 240px)" }}>
              <DialogButton disabled={loadingMore} onClick={onLoadMore}>
                {loadingMore ? "Loading more…" : "Load more"}
              </DialogButton>
            </div>
          ) : null}
        </>
      ) : null}
    </Focusable>
  );
}
