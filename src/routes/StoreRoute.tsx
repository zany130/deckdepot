import { useEffect, useRef, useState, type ReactElement } from "react";
import { Focusable, type Tab } from "@decky/ui";
import { getAppmanStatus } from "../api/appmanBridge";
import { getCatalogDetails, listProviderCategory, searchProviderCatalog } from "../api/catalogClient";
import { mergeBrowseApps } from "../api/catalogMerge";
import {
  APPMAN_EVERYTHING_ID,
  browseEntryLabel,
  cycleDestination,
  defaultDestination,
  destinationById,
  destinationsFor,
  isBrowseCacheFresh,
  resolveDestination,
} from "../browse/destinations";
import {
  applyContentFilters,
  ensureContentFiltersLoaded,
  getContentFilters,
  subscribeContentFilters,
  type ContentFilters,
} from "../api/contentFilters";
import { ensureHostPolicyDeniedIds } from "../api/hostPolicy";
import {
  badgeForApp,
  statusForApp,
} from "../api/installedInventory";
import { useFlatpakInventory } from "../api/useFlatpakInventory";
import { useSteamShortcuts } from "../api/useSteamShortcuts";
import AppDetailsView from "../components/AppDetailsView";
import AppmanBrowseFilters from "../components/AppmanBrowseFilters";
import AppmanCategoryIndex from "../components/AppmanCategoryIndex";
import FlatpakCategoryIndex from "../components/FlatpakCategoryIndex";
import CatalogGrid from "../components/CatalogGrid";
import CategoryTabs from "../components/CategoryTabs";
import SearchOverlay from "../components/SearchOverlay";
import { confirmAction } from "../components/confirmAction";
import { embeddedShellStyle } from "../components/storeLayout";
import {
  CatalogAppDetails,
  CatalogAppSummary,
  CatalogFailure,
  CatalogRemoteWarning,
} from "../types/catalog";
import { catalogKey, isFlathubSource, ProviderId } from "../types/provider";

const SEARCH_DEBOUNCE_MS = 300;

type CachedCategory = {
  apps: CatalogAppSummary[];
  page: number;
  totalPages: number;
  totalHits: number;
  warnings: CatalogRemoteWarning[];
  fetchedAt: number;
};

const browseCache = new Map<string, CachedCategory>();

function cacheKey(provider: ProviderId, slug: string, source = "all", format = "all"): string {
  if (provider === "appman") {
    return `${provider}:${slug}:${source}:${format}`;
  }
  return `${provider}:${slug}`;
}

const APPMAN_BASE_SOURCES = ["am", "amutils", "busybox", "coreutilsh", "python"];

export default function StoreRoute({
  provider,
}: {
  provider: ProviderId;
}): ReactElement {
  const inventoryState = useFlatpakInventory();
  const steam = useSteamShortcuts();
  const [activeCategory, setActiveCategory] = useState<string>(() => defaultDestination(provider));
  const activeCategoryRef = useRef(activeCategory);
  activeCategoryRef.current = activeCategory;
  const [browseApps, setBrowseApps] = useState<CatalogAppSummary[]>([]);
  const [browseTotalHits, setBrowseTotalHits] = useState(0);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [formatFilter, setFormatFilter] = useState("all");
  const [nestedSlug, setNestedSlug] = useState<string | null>(null);
  const [catalogSources, setCatalogSources] = useState<string[]>(APPMAN_BASE_SOURCES);
  const filtersRef = useRef({ source: "all", format: "all" });
  const nestedRef = useRef<string | null>(null);
  filtersRef.current = { source: sourceFilter, format: formatFilter };
  nestedRef.current = nestedSlug;
  const [browsePage, setBrowsePage] = useState(1);
  const [browseTotalPages, setBrowseTotalPages] = useState(1);
  const [browseLoading, setBrowseLoading] = useState(true);
  const [browseLoadingMore, setBrowseLoadingMore] = useState(false);
  const [browseError, setBrowseError] = useState<CatalogFailure | null>(null);
  const [browseWarnings, setBrowseWarnings] = useState<CatalogRemoteWarning[]>([]);
  const [contentFilters, setContentFilters] = useState<ContentFilters>(getContentFilters);
  const [deniedAppIds, setDeniedAppIds] = useState<Set<string>>(new Set());

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchApps, setSearchApps] = useState<CatalogAppSummary[]>([]);
  const [, setSearchTotalHits] = useState(0);
  const [searchPage, setSearchPage] = useState(1);
  const [searchTotalPages, setSearchTotalPages] = useState(1);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchLoadingMore, setSearchLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState<CatalogFailure | null>(null);
  const [searchPartialFailure, setSearchPartialFailure] = useState(false);
  const [searchFailedSourceLabels, setSearchFailedSourceLabels] = useState<string[]>([]);

  const [selected, setSelected] = useState<CatalogAppDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<CatalogFailure | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<CatalogAppSummary | null>(null);
  const [restoreBrowseAppId, setRestoreBrowseAppId] = useState<string | null>(null);
  const [restoreSearchAppId, setRestoreSearchAppId] = useState<string | null>(null);

  const browseAbortRef = useRef<AbortController | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const detailsAbortRef = useRef<AbortController | null>(null);
  const browseTileRefs = useRef(new Map<string, HTMLDivElement>());
  const searchTileRefs = useRef(new Map<string, HTMLDivElement>());
  const searchOpenRef = useRef(false);

  useEffect(() => {
    searchOpenRef.current = searchOpen;
  }, [searchOpen]);

  useEffect(() => {
    return subscribeContentFilters(() => setContentFilters(getContentFilters()));
  }, []);

  useEffect(() => {
    if (provider !== "flatpak") {
      return;
    }
    void (async () => {
      const [filters, denied] = await Promise.all([
        ensureContentFiltersLoaded(),
        ensureHostPolicyDeniedIds(),
      ]);
      setContentFilters(filters);
      setDeniedAppIds(denied);
    })();
  }, [provider]);

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
    setBrowseWarnings(cached.warnings || []);
    setBrowseLoading(false);
  };

  const browseFilters = () =>
    provider === "appman" ? filtersRef.current : { source: "all", format: "all" };

  const openCategory = (slug: string, force = false, refresh = false) => {
    if (slug !== "all-categories") {
      nestedRef.current = null;
      setNestedSlug(null);
    }
    const browseSlug = slug === "all-categories" ? nestedRef.current : slug;
    const { source, format } = browseFilters();
    if (!browseSlug) {
      browseAbortRef.current?.abort();
      setActiveCategory(slug);
      setBrowseApps([]);
      setBrowseError(null);
      setBrowseWarnings([]);
      setBrowseLoading(false);
      setBrowseLoadingMore(false);
      setBrowsePage(1);
      setBrowseTotalHits(0);
      setBrowseTotalPages(1);
      return;
    }
    const ttl =
      destinationById(browseSlug)?.cacheTtlMs ??
      destinationById(slug)?.cacheTtlMs ??
      10 * 60 * 1000;
    const key = cacheKey(provider, browseSlug, source, format);
    const cached = browseCache.get(key);
    const fresh = Boolean(cached && isBrowseCacheFresh(cached.fetchedAt, Date.now(), ttl));
    if (cached && fresh && !force) {
      browseAbortRef.current?.abort();
      applyCategory(slug, cached);
      return;
    }
    browseAbortRef.current?.abort();
    const controller = new AbortController();
    browseAbortRef.current = controller;
    setActiveCategory(slug);
    setBrowseError(null);
    setBrowseLoading(true);
    if (!cached || !fresh) {
      setBrowseApps([]);
      setBrowsePage(1);
      setBrowseTotalHits(0);
      setBrowseTotalPages(1);
    }
    void (async () => {
      try {
        if (provider === "flatpak" && refresh) {
          setDeniedAppIds(await ensureHostPolicyDeniedIds(true));
        }
        const result = await listProviderCategory(provider, browseSlug, {
          page: 1,
          signal: controller.signal,
          refresh,
          sourceId: source,
          packageFormat: format,
        });
        if (controller.signal.aborted) {
          return;
        }
        if (!result.ok) {
          setBrowseError(result);
          setBrowseApps([]);
          setBrowseWarnings([]);
          return;
        }
        const next: CachedCategory = {
          apps: result.apps,
          page: result.page,
          totalPages: result.totalPages,
          totalHits: result.totalHits,
          warnings: result.warnings || [],
          fetchedAt: Date.now(),
        };
        browseCache.set(key, next);
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

  const openNestedCategory = (slug: string) => {
    nestedRef.current = slug;
    setNestedSlug(slug);
    openCategory("all-categories", true);
  };

  const closeNestedCategory = () => {
    nestedRef.current = null;
    setNestedSlug(null);
    openCategory("all-categories");
  };

  const changeAppmanFilter = (kind: "source" | "format", id: string) => {
    const next = { ...filtersRef.current, [kind]: id };
    filtersRef.current = next;
    if (kind === "source") {
      setSourceFilter(id);
    } else {
      setFormatFilter(id);
    }
    const tab = activeCategoryRef.current;
    if (tab === "all-categories" && !nestedRef.current) {
      return;
    }
    openCategory(tab, true);
  };

  useEffect(() => {
    openCategory(resolveDestination(provider, activeCategoryRef.current), false, false);
  }, [provider]);

  useEffect(() => {
    if (provider !== "appman") {
      return;
    }
    let cancelled = false;
    void getAppmanStatus().then((result) => {
      if (cancelled || !result.ok || !result.catalogSources?.length) {
        return;
      }
      setCatalogSources(result.catalogSources);
      if (
        filtersRef.current.source !== "all" &&
        !result.catalogSources.includes(filtersRef.current.source)
      ) {
        filtersRef.current = { ...filtersRef.current, source: "all" };
        setSourceFilter("all");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const cycleCategory = (direction: -1 | 1) => {
    const ids = destinationsFor(provider).map((item) => item.id);
    openCategory(cycleDestination(ids, activeCategory, direction));
  };

  const runSearch = (trimmed: string, refresh = false) => {
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setSearchError(null);
    setSearchLoading(true);
    setSearchApps([]);
    setSearchPage(1);
    setSearchTotalHits(0);
    setSearchTotalPages(1);
    setSearchPartialFailure(false);
    setSearchFailedSourceLabels([]);
    void (async () => {
      try {
        const result = await searchProviderCatalog(provider, trimmed, {
          page: 1,
          signal: controller.signal,
          refresh,
        });
        if (controller.signal.aborted) {
          return;
        }
        if (!result.ok) {
          setSearchError(result);
          setSearchApps([]);
          setSearchPartialFailure(false);
          setSearchFailedSourceLabels([]);
          return;
        }
        setSearchApps(result.apps);
        setSearchTotalHits(result.totalHits);
        setSearchPage(result.page);
        setSearchTotalPages(result.totalPages);
        setSearchPartialFailure(Boolean(result.partialFailure));
        setSearchFailedSourceLabels(result.failedSourceLabels || []);
      } catch (exc) {
        if (exc instanceof DOMException && exc.name === "AbortError") {
          return;
        }
        console.warn("[DeckDepot] search failed", exc);
        setSearchError({
          ok: false,
          errorCode: "NETWORK_ERROR",
          errorMessage: String(exc),
        });
        setSearchPartialFailure(false);
        setSearchFailedSourceLabels([]);
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
      setSearchPartialFailure(false);
      setSearchFailedSourceLabels([]);
      return;
    }
    setSearchLoading(true);
    setSearchError(null);
    const handle = window.setTimeout(() => runSearch(trimmed), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query, searchOpen]);

  const loadMoreBrowse = () => {
    const browseSlug = activeCategory === "all-categories" ? nestedRef.current : activeCategory;
    if (!browseSlug || browseLoading || browseLoadingMore || browsePage >= browseTotalPages) {
      return;
    }
    const nextPage = browsePage + 1;
    const { source, format } = browseFilters();
    const key = cacheKey(provider, browseSlug, source, format);
    const controller = browseAbortRef.current ?? new AbortController();
    browseAbortRef.current = controller;
    setBrowseLoadingMore(true);
    void (async () => {
      try {
        const result = await listProviderCategory(provider, browseSlug, {
          page: nextPage,
          signal: controller.signal,
          sourceId: source,
          packageFormat: format,
        });
        if (controller.signal.aborted) {
          return;
        }
        if (!result.ok) {
          setBrowseError(result);
          return;
        }
        setBrowseApps((current) => {
          const apps = mergeBrowseApps([...current, ...result.apps]);
          const existing = browseCache.get(key);
          browseCache.set(key, {
            apps,
            page: result.page,
            totalPages: result.totalPages,
            totalHits: result.totalHits,
            warnings: result.warnings || [],
            fetchedAt: existing?.fetchedAt ?? Date.now(),
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
        setSearchApps((current) => mergeBrowseApps([...current, ...result.apps]));
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
  const filteredBrowse =
    provider === "flatpak"
      ? applyContentFilters(browseApps, contentFilters, deniedAppIds)
      : { apps: browseApps, dropped: 0 };
  const filteredSearch =
    provider === "flatpak"
      ? applyContentFilters(searchApps, contentFilters, deniedAppIds)
      : { apps: searchApps, dropped: 0 };
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
  const selectedIsFlathub = Boolean(selected && !isAppman && isFlathubSource(selected));
  const catalogInstallScope =
    selected && !isAppman && !selectedIsFlathub
      ? selected.installationScope || null
      : isAppman
        ? null
        : inventoryState.resolvedInstallScope;

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
    inventoryState.rememberAppName(app.appId, app.name);
    if (isFlathubSource(app)) {
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
      await inventoryState.installFlatpak(app.appId, scope, "flathub", app.ref);
      return;
    }
    const scope = app.installationScope;
    if (scope !== "user" && scope !== "system") {
      return;
    }
    const source = app.sourceLabel || app.remoteName || "this remote";
    const confirmed = await confirmAction(
      `Install ${app.name}?`,
      `Install ${app.appId} as a ${scope}-scoped Flatpak from ${source}.`
    );
    if (!confirmed) {
      return;
    }
    await inventoryState.installFlatpak(app.appId, scope, app.remoteName, app.ref);
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
        flathubMissing={isAppman || !selectedIsFlathub ? false : inventoryState.flathubMissing}
        resolvedInstallScope={catalogInstallScope}
        scopeUnavailableReason={
          isAppman
            ? null
            : selectedIsFlathub
              ? inventoryState.scopeUnavailableReason
              : catalogInstallScope === "system" && !inventoryState.systemMutationsAvailable
                ? inventoryState.scopeUnavailableReason
                : null
        }
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
          isAppman || !selectedIsFlathub
            ? undefined
            : () => void inventoryState.enableFlathub()
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
        apps={filteredSearch.apps}
        loading={searchLoading}
        loadingMore={searchLoadingMore}
        error={searchError}
        partialFailure={searchPartialFailure}
        failedSourceLabels={searchFailedSourceLabels}
        totalHits={filteredSearch.apps.length}
        page={searchPage}
        totalPages={searchTotalPages}
        restoreAppId={restoreSearchAppId}
        tileRefs={searchTileRefs}
        searchLabel={provider === "appman" ? "Search AppMan" : "Search Flatpak"}
        emptyHint={
          provider === "appman"
            ? "Type a name to search AppMan."
            : "Type a name to search configured Flatpak remotes."
        }
        onQueryChange={setQuery}
        onClose={closeSearch}
        onOpen={(app) => openDetails(app, true)}
        onRetry={() => {
          const trimmed = query.trim();
          if (trimmed) {
            runSearch(trimmed, true);
          }
        }}
        onLoadMore={loadMoreSearch}
        onFocusApp={(app) => setRestoreSearchAppId(catalogKey(app))}
        badgeForApp={catalogBadge}
        provider={provider}
      />
    );
  }

  const activeDestination = destinationById(activeCategory);
  const browseSlug = activeCategory === "all-categories" ? nestedSlug : activeCategory;
  const showingIndex = activeCategory === "all-categories" && !browseSlug;
  const activeLabel = browseSlug
    ? activeCategory === "all-categories"
      ? browseEntryLabel(browseSlug)
      : activeDestination?.label ?? browseSlug
    : activeDestination?.label ?? activeCategory;
  const sourceNote = destinationById(browseSlug || "")?.kind === "collection" ? " · Flathub" : "";
  const countLabel =
    browseTotalHits > filteredBrowse.apps.length
      ? `${filteredBrowse.apps.length} of ${browseTotalHits}`
      : `${filteredBrowse.apps.length}`;

  const browsePane = showingIndex ? (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      {provider === "appman" ? (
        <AppmanBrowseFilters
          source={sourceFilter}
          format={formatFilter}
          sources={catalogSources}
          onSource={(id) => changeAppmanFilter("source", id)}
          onFormat={(id) => changeAppmanFilter("format", id)}
        />
      ) : null}
      <div style={{ flex: 1, minHeight: 0 }}>
        {provider === "appman" ? (
          <AppmanCategoryIndex
            onOpen={openNestedCategory}
            onOpenEverything={() => openNestedCategory(APPMAN_EVERYTHING_ID)}
          />
        ) : (
          <FlatpakCategoryIndex onOpen={openNestedCategory} />
        )}
      </div>
    </div>
  ) : (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      {provider === "appman" ? (
        <AppmanBrowseFilters
          source={sourceFilter}
          format={formatFilter}
          sources={catalogSources}
          onSource={(id) => changeAppmanFilter("source", id)}
          onFormat={(id) => changeAppmanFilter("format", id)}
        />
      ) : null}
      {nestedSlug && activeCategory === "all-categories" ? (
        <Focusable
          onActivate={closeNestedCategory}
          onOKActionDescription="All categories"
          style={{ padding: "4px 18px 0", flexShrink: 0, fontWeight: 700 }}
        >
          All categories
        </Focusable>
      ) : null}
      <div style={{ flex: 1, minHeight: 0 }}>
        <CatalogGrid
          apps={filteredBrowse.apps}
          loading={browseLoading}
          loadingMore={browseLoadingMore}
          error={browseError}
          warnings={browseWarnings}
          emptyMessage="No matching applications. This is an empty successful query."
          statusLabel={browseLoading ? activeLabel : `${activeLabel}${sourceNote} · ${countLabel}`}
          restoreAppId={restoreBrowseAppId}
          canLoadMore={browsePage < browseTotalPages}
          onOpen={(app) => openDetails(app, false)}
          onSearch={openSearch}
          onRetry={() => openCategory(activeCategory, true, true)}
          onLoadMore={loadMoreBrowse}
          onBumper={cycleCategory}
          onCancel={nestedSlug && activeCategory === "all-categories" ? closeNestedCategory : undefined}
          onFocusApp={(app) => setRestoreBrowseAppId(catalogKey(app))}
          badgeForApp={catalogBadge}
          tileRefs={browseTileRefs}
        />
      </div>
    </div>
  );

  const tabs: Tab[] = destinationsFor(provider).map((category) => ({
    id: category.id,
    title: category.label,
    content: category.id === activeCategory ? browsePane : <div />,
  }));

  return (
    <div style={embeddedShellStyle}>
      <CategoryTabs
        activeTab={activeCategory}
        onShowTab={(id) => {
          if (id === "all-categories" && id === activeCategory) {
            nestedRef.current = null;
            setNestedSlug(null);
          }
          openCategory(id);
        }}
        onSearch={openSearch}
        tabs={tabs}
      />
    </div>
  );
}
