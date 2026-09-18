import { useEffect, useRef, useState, type ReactElement } from "react";
import { type Tab } from "@decky/ui";
import { CURATED_CATEGORIES } from "../api/flathubClient";
import { getCatalogDetails, listProviderCategory, searchProviderCatalog } from "../api/catalogClient";
import {
  badgeForApp,
  statusForApp,
} from "../api/installedInventory";
import { useFlatpakInventory } from "../api/useFlatpakInventory";
import { useSteamShortcuts } from "../api/useSteamShortcuts";
import AppDetailsView from "../components/AppDetailsView";
import CatalogGrid from "../components/CatalogGrid";
import CategoryTabs from "../components/CategoryTabs";
import SearchOverlay from "../components/SearchOverlay";
import { confirmAction } from "../components/confirmAction";
import { embeddedShellStyle } from "../components/storeLayout";
import {
  CatalogAppDetails,
  CatalogAppSummary,
  CatalogFailure,
} from "../types/catalog";
import { catalogKey, ProviderId } from "../types/provider";

const SEARCH_DEBOUNCE_MS = 300;
const DEFAULT_CATEGORY = CURATED_CATEGORIES[0].slug;

type CachedCategory = {
  apps: CatalogAppSummary[];
  page: number;
  totalPages: number;
  totalHits: number;
};

export default function StoreRoute({
  provider,
}: {
  provider: ProviderId;
}): ReactElement {
  const inventoryState = useFlatpakInventory();
  const steam = useSteamShortcuts();
  const [activeCategory, setActiveCategory] = useState<string>(DEFAULT_CATEGORY);
  const [browseApps, setBrowseApps] = useState<CatalogAppSummary[]>([]);
  const [browseTotalHits, setBrowseTotalHits] = useState(0);
  const [browsePage, setBrowsePage] = useState(1);
  const [browseTotalPages, setBrowseTotalPages] = useState(1);
  const [browseLoading, setBrowseLoading] = useState(true);
  const [browseLoadingMore, setBrowseLoadingMore] = useState(false);
  const [browseError, setBrowseError] = useState<CatalogFailure | null>(null);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchApps, setSearchApps] = useState<CatalogAppSummary[]>([]);
  const [searchTotalHits, setSearchTotalHits] = useState(0);
  const [searchPage, setSearchPage] = useState(1);
  const [searchTotalPages, setSearchTotalPages] = useState(1);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchLoadingMore, setSearchLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState<CatalogFailure | null>(null);

  const [selected, setSelected] = useState<CatalogAppDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<CatalogFailure | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<CatalogAppSummary | null>(null);
  const [restoreBrowseAppId, setRestoreBrowseAppId] = useState<string | null>(null);
  const [restoreSearchAppId, setRestoreSearchAppId] = useState<string | null>(null);

  const browseAbortRef = useRef<AbortController | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const detailsAbortRef = useRef<AbortController | null>(null);
  const categoryCache = useRef(new Map<string, CachedCategory>());
  const browseTileRefs = useRef(new Map<string, HTMLDivElement>());
  const searchTileRefs = useRef(new Map<string, HTMLDivElement>());
  const searchOpenRef = useRef(false);

  useEffect(() => {
    searchOpenRef.current = searchOpen;
  }, [searchOpen]);

  useEffect(() => {
    return () => {
      browseAbortRef.current?.abort();
      searchAbortRef.current?.abort();
      detailsAbortRef.current?.abort();
    };
  }, []);

  const applyCategory = (slug: string, cached: CachedCategory) => {
    setActiveCategory(slug);
    setBrowseApps(cached.apps);
    setBrowsePage(cached.page);
    setBrowseTotalPages(cached.totalPages);
    setBrowseTotalHits(cached.totalHits);
    setBrowseError(null);
    setBrowseLoading(false);
  };

  const openCategory = (slug: string, force = false) => {
    const cached = categoryCache.current.get(slug);
    if (cached && !force) {
      applyCategory(slug, cached);
      return;
    }
    browseAbortRef.current?.abort();
    const controller = new AbortController();
    browseAbortRef.current = controller;
    setActiveCategory(slug);
    setBrowseError(null);
    setBrowseLoading(true);
    if (!cached) {
      setBrowseApps([]);
      setBrowsePage(1);
      setBrowseTotalHits(0);
      setBrowseTotalPages(1);
    }
    void (async () => {
      try {
        const result = await listProviderCategory(provider, slug, { page: 1, signal: controller.signal });
        if (controller.signal.aborted) {
          return;
        }
        if (!result.ok) {
          setBrowseError(result);
          setBrowseApps([]);
          return;
        }
        const next: CachedCategory = {
          apps: result.apps,
          page: result.page,
          totalPages: result.totalPages,
          totalHits: result.totalHits,
        };
        categoryCache.current.set(slug, next);
        applyCategory(slug, next);
      } catch (exc) {
        if (exc instanceof DOMException && exc.name === "AbortError") {
          return;
        }
        setBrowseError({
          ok: false,
          errorCode: "NETWORK_ERROR",
          errorMessage: String(exc),
        });
      } finally {
        if (!controller.signal.aborted) {
          setBrowseLoading(false);
        }
      }
    })();
  };

  useEffect(() => {
    categoryCache.current.clear();
    openCategory(DEFAULT_CATEGORY, true);
  }, [provider]);

  const cycleCategory = (direction: -1 | 1) => {
    const index = CURATED_CATEGORIES.findIndex((item) => item.slug === activeCategory);
    const next =
      (index + direction + CURATED_CATEGORIES.length) % CURATED_CATEGORIES.length;
    openCategory(CURATED_CATEGORIES[next].slug);
  };

  const runSearch = (trimmed: string) => {
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setSearchError(null);
    setSearchLoading(true);
    setSearchApps([]);
    setSearchPage(1);
    setSearchTotalHits(0);
    setSearchTotalPages(1);
    void (async () => {
      try {
        const result = await searchProviderCatalog(provider, trimmed, { page: 1, signal: controller.signal });
        if (controller.signal.aborted) {
          return;
        }
        if (!result.ok) {
          setSearchError(result);
          setSearchApps([]);
          return;
        }
        setSearchApps(result.apps);
        setSearchTotalHits(result.totalHits);
        setSearchPage(result.page);
        setSearchTotalPages(result.totalPages);
      } catch (exc) {
        if (exc instanceof DOMException && exc.name === "AbortError") {
          return;
        }
        setSearchError({
          ok: false,
          errorCode: "NETWORK_ERROR",
          errorMessage: String(exc),
        });
      } finally {
        if (!controller.signal.aborted) {
          setSearchLoading(false);
        }
      }
    })();
  };

  useEffect(() => {
    if (!searchOpen) {
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) {
      searchAbortRef.current?.abort();
      setSearchApps([]);
      setSearchError(null);
      setSearchLoading(false);
      setSearchTotalHits(0);
      setSearchTotalPages(1);
      return;
    }
    const handle = window.setTimeout(() => runSearch(trimmed), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query, searchOpen]);

  const loadMoreBrowse = () => {
    if (browseLoading || browseLoadingMore || browsePage >= browseTotalPages) {
      return;
    }
    const nextPage = browsePage + 1;
    const controller = browseAbortRef.current ?? new AbortController();
    browseAbortRef.current = controller;
    setBrowseLoadingMore(true);
    void (async () => {
      try {
        const result = await listProviderCategory(provider, activeCategory, {
          page: nextPage,
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          return;
        }
        if (!result.ok) {
          setBrowseError(result);
          return;
        }
        setBrowseApps((current) => {
          const apps = [...current, ...result.apps];
          categoryCache.current.set(activeCategory, {
            apps,
            page: result.page,
            totalPages: result.totalPages,
            totalHits: result.totalHits,
          });
          return apps;
        });
        setBrowseTotalHits(result.totalHits);
        setBrowsePage(result.page);
        setBrowseTotalPages(result.totalPages);
      } catch (exc) {
        if (exc instanceof DOMException && exc.name === "AbortError") {
          return;
        }
        setBrowseError({
          ok: false,
          errorCode: "NETWORK_ERROR",
          errorMessage: String(exc),
        });
      } finally {
        if (!controller.signal.aborted) {
          setBrowseLoadingMore(false);
        }
      }
    })();
  };

  const loadMoreSearch = () => {
    if (searchLoading || searchLoadingMore || searchPage >= searchTotalPages) {
      return;
    }
    const nextPage = searchPage + 1;
    const controller = searchAbortRef.current ?? new AbortController();
    searchAbortRef.current = controller;
    setSearchLoadingMore(true);
    void (async () => {
      try {
        const result = await searchProviderCatalog(provider, query.trim(), {
          page: nextPage,
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          return;
        }
        if (!result.ok) {
          setSearchError(result);
          return;
        }
        setSearchApps((current) => [...current, ...result.apps]);
        setSearchTotalHits(result.totalHits);
        setSearchPage(result.page);
        setSearchTotalPages(result.totalPages);
      } catch (exc) {
        if (exc instanceof DOMException && exc.name === "AbortError") {
          return;
        }
        setSearchError({
          ok: false,
          errorCode: "NETWORK_ERROR",
          errorMessage: String(exc),
        });
      } finally {
        if (!controller.signal.aborted) {
          setSearchLoadingMore(false);
        }
      }
    })();
  };

  const openDetails = (app: CatalogAppSummary, fromSearch: boolean) => {
    detailsAbortRef.current?.abort();
    const controller = new AbortController();
    detailsAbortRef.current = controller;
    const key = catalogKey(app);
    if (fromSearch) {
      setRestoreSearchAppId(key);
    } else {
      setRestoreBrowseAppId(key);
    }
    setDetailsTarget(app);
    setDetailsLoading(true);
    setDetailsError(null);
    setSelected(null);
    void (async () => {
      try {
        const result = await getCatalogDetails(app, { signal: controller.signal });
        if (controller.signal.aborted) {
          return;
        }
        if (!result.ok) {
          setDetailsError(result);
          return;
        }
        setSelected(result.app);
      } catch (exc) {
        if (exc instanceof DOMException && exc.name === "AbortError") {
          return;
        }
        setDetailsError({
          ok: false,
          errorCode: "NETWORK_ERROR",
          errorMessage: String(exc),
        });
      } finally {
        if (!controller.signal.aborted) {
          setDetailsLoading(false);
        }
      }
    })();
  };

  const closeDetails = () => {
    detailsAbortRef.current?.abort();
    setDetailsLoading(false);
    setDetailsError(null);
    setSelected(null);
    setDetailsTarget(null);
    const fromSearch = searchOpenRef.current;
    const appId = fromSearch ? restoreSearchAppId : restoreBrowseAppId;
    window.requestAnimationFrame(() => {
      if (!appId) {
        return;
      }
      const refs = fromSearch ? searchTileRefs : browseTileRefs;
      refs.current.get(appId)?.focus();
    });
  };

  const openSearch = () => {
    setSearchOpen(true);
  };

  const closeSearch = () => {
    searchAbortRef.current?.abort();
    setSearchOpen(false);
    setSearchLoading(false);
    window.requestAnimationFrame(() => {
      if (restoreBrowseAppId) {
        browseTileRefs.current.get(restoreBrowseAppId)?.focus();
      }
    });
  };

  const showingDetails = Boolean(detailsTarget || selected || detailsLoading || detailsError);
  const selectedStatus = selected
    ? statusForApp(inventoryState.inventory, selected, [
        ...inventoryState.updates,
        ...inventoryState.systemUpdates,
      ])
    : undefined;
  const catalogBadge = (app: CatalogAppSummary) =>
    badgeForApp(inventoryState.inventory, app, [
      ...inventoryState.updates,
      ...inventoryState.systemUpdates,
    ]);
  const isAppman = selected?.provider === "appman";

  const requestInstall = async (app: CatalogAppSummary) => {
    if (app.provider === "appman") {
      const confirmed = await confirmAction(
        `Install ${app.name}?`,
        `Install ${app.appId} with AppMan (${app.sourceLabel || "AM"}). This downloads an installation script from the GitHub AM database. It is not a Flathub sandbox.`
      );
      if (!confirmed) {
        return;
      }
      inventoryState.rememberAppName(app.appId, app.name);
      await inventoryState.installAppman(app.appId, app.sourceId || "am");
      return;
    }
    const scope = inventoryState.resolvedInstallScope;
    if (!scope) {
      return;
    }
    const confirmed = await confirmAction(
      `Install ${app.name}?`,
      `Install ${app.appId} as a ${scope}-scoped Flatpak from Flathub.`
    );
    if (!confirmed) {
      return;
    }
    inventoryState.rememberAppName(app.appId, app.name);
    await inventoryState.installFlatpak(app.appId, scope);
  };

  const requestUninstall = async (
    app: CatalogAppSummary,
    scope: "user" | "system" = "user"
  ) => {
    if (app.provider === "appman") {
      const confirmed = await confirmAction(
        `Uninstall ${app.name}?`,
        `Remove the AppMan-managed copy of ${app.appId}? This uses AppMan's no-prompt remove after you confirm here.`
      );
      if (!confirmed) {
        return;
      }
      inventoryState.rememberAppName(app.appId, app.name);
      await inventoryState.uninstallAppman(app.appId, app.sourceId || "am");
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
    inventoryState.rememberAppName(app.appId, app.name);
    await inventoryState.uninstallFlatpak(app.appId, scope);
  };

  const requestUpdate = async (
    app: CatalogAppSummary,
    scope: "user" | "system" = "user"
  ) => {
    if (app.provider === "appman") {
      const confirmed = await confirmAction(
        `Update ${app.name}?`,
        `Ask AppMan to run the updater for ${app.appId}. AppMan does not say in advance whether a newer version exists.`
      );
      if (!confirmed) {
        return;
      }
      inventoryState.rememberAppName(app.appId, app.name);
      await inventoryState.updateAppman(app.appId, app.sourceId || "am");
      return;
    }
    const update = (
      scope === "system" ? inventoryState.systemUpdates : inventoryState.updates
    ).find((item) => item.appId === app.appId);
    const confirmed = await confirmAction(
      `Update ${app.name}?`,
      `Update the ${scope}-scoped copy of ${app.appId}? Related runtimes may also be pulled.`
    );
    if (!confirmed) {
      return;
    }
    inventoryState.rememberAppName(app.appId, app.name);
    await inventoryState.updateFlatpak(app.appId, update?.ref || "", scope);
  };

  if (showingDetails) {
    return (
      <AppDetailsView
        app={selected}
        loading={detailsLoading}
        error={detailsError}
        onBack={closeDetails}
        onRetry={() => {
          if (detailsTarget) {
            openDetails(detailsTarget, searchOpenRef.current);
          }
        }}
        installStatus={selectedStatus}
        flathubMissing={isAppman ? false : inventoryState.flathubMissing}
        resolvedInstallScope={isAppman ? null : inventoryState.resolvedInstallScope}
        scopeUnavailableReason={isAppman ? null : inventoryState.scopeUnavailableReason}
        systemMutationsAvailable={inventoryState.systemMutationsAvailable}
        userMutationsDisabled={
          isAppman
            ? inventoryState.appmanMutationsDisabled
            : inventoryState.userMutationsDisabled
        }
        systemMutationsDisabled={inventoryState.systemMutationsDisabled}
        mutationsDisabled={
          isAppman
            ? inventoryState.appmanMutationsDisabled
            : inventoryState.userMutationsDisabled
        }
        task={inventoryState.task}
        actionError={inventoryState.error}
        onInstall={selected ? () => void requestInstall(selected) : undefined}
        onUninstall={
          selected
            ? (scope) => void requestUninstall(selected, scope)
            : undefined
        }
        onUpdate={
          selected ? (scope) => void requestUpdate(selected, scope) : undefined
        }
        onEnableFlathub={
          isAppman ? undefined : () => void inventoryState.enableFlathub()
        }
        onCancelTask={() => void inventoryState.cancelCurrent()}
        steam={steam}
      />
    );
  }

  if (searchOpen) {
    return (
      <SearchOverlay
        query={query}
        apps={searchApps}
        loading={searchLoading}
        loadingMore={searchLoadingMore}
        error={searchError}
        totalHits={searchTotalHits}
        page={searchPage}
        totalPages={searchTotalPages}
        restoreAppId={restoreSearchAppId}
        tileRefs={searchTileRefs}
        searchLabel={provider === "appman" ? "Search AppMan" : "Search Flathub"}
        emptyHint={
          provider === "appman"
            ? "Type a name to search AppMan."
            : "Type a name to search Flathub."
        }
        onQueryChange={setQuery}
        onClose={closeSearch}
        onOpen={(app) => openDetails(app, true)}
        onRetry={() => {
          const trimmed = query.trim();
          if (trimmed) {
            runSearch(trimmed);
          }
        }}
        onLoadMore={loadMoreSearch}
        onFocusApp={(app) => setRestoreSearchAppId(catalogKey(app))}
        badgeForApp={catalogBadge}
      />
    );
  }

  const activeLabel =
    CURATED_CATEGORIES.find((item) => item.slug === activeCategory)?.label ?? activeCategory;

  const browsePane = (
    <CatalogGrid
      apps={browseApps}
      loading={browseLoading}
      loadingMore={browseLoadingMore}
      error={browseError}
      emptyMessage="No matching applications. This is an empty successful query."
      statusLabel={browseLoading ? activeLabel : `${activeLabel} · ${browseTotalHits}`}
      restoreAppId={restoreBrowseAppId}
      canLoadMore={browsePage < browseTotalPages}
      onOpen={(app) => openDetails(app, false)}
      onSearch={openSearch}
      onRetry={() => openCategory(activeCategory, true)}
      onLoadMore={loadMoreBrowse}
      onBumper={cycleCategory}
      onFocusApp={(app) => setRestoreBrowseAppId(catalogKey(app))}
      badgeForApp={catalogBadge}
      tileRefs={browseTileRefs}
    />
  );

  const tabs: Tab[] = CURATED_CATEGORIES.map((category) => ({
    id: category.slug,
    title: category.label,
    content: category.slug === activeCategory ? browsePane : <div />,
  }));

  return (
    <div style={embeddedShellStyle}>
      <CategoryTabs
        activeTab={activeCategory}
        onShowTab={(id) => openCategory(id)}
        onSearch={openSearch}
        tabs={tabs}
      />
    </div>
  );
}
