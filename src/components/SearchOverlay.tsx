import { Focusable, TextField } from "@decky/ui";
import type { MutableRefObject, ReactElement } from "react";
import {
  emptySearchMessage,
  FLATPAK_SEARCH_EMPTY_HINT,
  FLATPAK_SEARCH_PARTIAL_WARNING,
  FLATPAK_SEARCH_TOTAL_FAILURE_HINT,
  FLATPAK_SEARCH_TOTAL_FAILURE_TITLE,
} from "../api/flatpakSearchState";
import { CatalogBadge } from "../api/installedInventory";
import { CatalogAppSummary, CatalogFailure } from "../types/catalog";
import CatalogGrid from "./CatalogGrid";
import { consumeGamepadEvent, embeddedShellStyle } from "./storeLayout";

export default function SearchOverlay({
  query,
  apps,
  loading,
  loadingMore,
  error,
  partialFailure,
  failedSourceLabels,
  totalHits,
  page,
  totalPages,
  restoreAppId,
  tileRefs,
  onQueryChange,
  onClose,
  onOpen,
  onRetry,
  onLoadMore,
  onFocusApp,
  badgeForApp,
  searchLabel = "Search",
  emptyHint = "Type a name to search.",
  provider = "flatpak",
}: {
  query: string;
  apps: CatalogAppSummary[];
  loading: boolean;
  loadingMore: boolean;
  error: CatalogFailure | null;
  partialFailure?: boolean;
  failedSourceLabels?: string[];
  totalHits: number;
  page: number;
  totalPages: number;
  restoreAppId: string | null;
  tileRefs: MutableRefObject<Map<string, HTMLDivElement>>;
  onQueryChange: (value: string) => void;
  onClose: () => void;
  onOpen: (app: CatalogAppSummary) => void;
  onRetry: () => void;
  onLoadMore: () => void;
  onFocusApp?: (app: CatalogAppSummary) => void;
  badgeForApp?: (app: CatalogAppSummary) => CatalogBadge;
  searchLabel?: string;
  emptyHint?: string;
  provider?: "flatpak" | "appman";
}): ReactElement {
  const trimmed = query.trim();
  const isFlatpak = provider === "flatpak";
  const emptyMessage = trimmed
    ? emptySearchMessage(trimmed)
    : emptyHint;
  const zeroHint = trimmed ? FLATPAK_SEARCH_EMPTY_HINT : undefined;

  return (
    <Focusable
      flow-children="column"
      style={{ ...embeddedShellStyle, background: "rgba(15, 18, 23, 0.97)" }}
      onCancel={(evt) => {
        consumeGamepadEvent(evt);
        onClose();
      }}
      onCancelButton={(evt) => {
        consumeGamepadEvent(evt);
        onClose();
      }}
      onCancelActionDescription="Close"
      onOKActionDescription="Select"
    >
      <div style={{ padding: "12px 18px 0", flexShrink: 0 }}>
        <div
          style={{
            fontSize: "13px",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            opacity: 0.7,
            marginBottom: "8px",
          }}
        >
          Search
        </div>
        <TextField
          label={searchLabel}
          value={query}
          focusOnMount
          onChange={(ev) => onQueryChange(ev.target.value)}
        />
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <CatalogGrid
          apps={apps}
          loading={loading}
          loadingMore={loadingMore}
          error={error}
          warningMessage={
            isFlatpak && partialFailure ? FLATPAK_SEARCH_PARTIAL_WARNING : undefined
          }
          failedSourceLabels={isFlatpak ? failedSourceLabels : undefined}
          emptyMessage={emptyMessage}
          emptyHint={trimmed ? zeroHint : undefined}
          errorTitle={isFlatpak ? FLATPAK_SEARCH_TOTAL_FAILURE_TITLE : undefined}
          errorHint={
            isFlatpak
              ? FLATPAK_SEARCH_TOTAL_FAILURE_HINT
              : "Request failed. This is not an empty result."
          }
          loadingLabel={isFlatpak ? "Searching…" : "Loading catalog…"}
          statusLabel={
            trimmed && !loading && !error && totalHits > 0
              ? `Results · ${totalHits}`
              : undefined
          }
          restoreAppId={restoreAppId}
          canLoadMore={Boolean(trimmed) && page < totalPages}
          onOpen={onOpen}
          onRetry={onRetry}
          onLoadMore={onLoadMore}
          onCancel={onClose}
          onFocusApp={onFocusApp}
          badgeForApp={badgeForApp}
          tileRefs={tileRefs}
        />
      </div>
    </Focusable>
  );
}
