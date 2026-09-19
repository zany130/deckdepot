import { CatalogAppSummary } from "../types/catalog";
import {
  CONTENT_FILTER_KEYS,
  ContentFilterKey,
  ContentFilters,
  DEFAULT_CONTENT_FILTERS,
} from "../types/contentFilters";
import { isFlathubSource } from "../types/provider";
import { getFlatpakContentFilters, setFlatpakContentFilters } from "./flatpakBridge";

export {
  CONTENT_FILTER_KEYS,
  DEFAULT_CONTENT_FILTERS,
};
export type { ContentFilterKey, ContentFilters };

export const CONTENT_FILTER_ROWS: Array<{
  key: ContentFilterKey;
  label: string;
  description: string;
}> = [
  {
    key: "freeSoftwareOnly",
    label: "Free Software Only",
    description: "Hide proprietary apps when browsing and searching",
  },
  {
    key: "flathubResultsOnly",
    label: "Flathub Results Only",
    description: "Limit search and browse results to apps only available on Flathub",
  },
  {
    key: "verifiedResultsOnly",
    label: "Verified Results Only",
    description: "Hide results that are not verified on Flathub",
  },
  {
    key: "hideEndOfLifeApps",
    label: "Hide End-of-Life Apps",
    description: "Hide apps which are no longer supported by their developers",
  },
  {
    key: "respectDistroFilters",
    label: "Respect Distro Filters",
    description: "Hide apps intentionally filtered by your operating system",
  },
];

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function isExplicitlyProprietary(app: CatalogAppSummary): boolean {
  if (app.isFreeLicense === false) {
    return true;
  }
  const license = (app.projectLicense || "").trim().toLowerCase();
  if (!license) {
    return false;
  }
  return license.includes("proprietary") || license.includes("non-free");
}

export function isExplicitlyUnverifiedFlathub(app: CatalogAppSummary): boolean {
  if (!isFlathubSource(app)) {
    return false;
  }
  return app.verificationVerified === false;
}

export function isExplicitlyEndOfLife(app: CatalogAppSummary): boolean {
  return app.isEol === true;
}

export function applyContentFilters(
  apps: CatalogAppSummary[],
  filters: ContentFilters,
  deniedAppIds: Set<string> = new Set()
): { apps: CatalogAppSummary[]; dropped: number } {
  const kept: CatalogAppSummary[] = [];
  let dropped = 0;
  for (const app of apps) {
    if (filters.respectDistroFilters && deniedAppIds.has(app.appId)) {
      dropped += 1;
      continue;
    }
    if (filters.flathubResultsOnly && !isFlathubSource(app)) {
      dropped += 1;
      continue;
    }
    if (filters.freeSoftwareOnly && isExplicitlyProprietary(app)) {
      dropped += 1;
      continue;
    }
    if (filters.verifiedResultsOnly && isExplicitlyUnverifiedFlathub(app)) {
      dropped += 1;
      continue;
    }
    if (filters.hideEndOfLifeApps && isExplicitlyEndOfLife(app)) {
      dropped += 1;
      continue;
    }
    kept.push(app);
  }
  return { apps: kept, dropped };
}

export function normalizeContentFilters(raw: Partial<ContentFilters> | null | undefined): ContentFilters {
  return {
    freeSoftwareOnly: Boolean(raw?.freeSoftwareOnly),
    flathubResultsOnly: Boolean(raw?.flathubResultsOnly),
    verifiedResultsOnly: Boolean(raw?.verifiedResultsOnly),
    hideEndOfLifeApps: Boolean(raw?.hideEndOfLifeApps),
    respectDistroFilters:
      raw?.respectDistroFilters === undefined ? true : Boolean(raw.respectDistroFilters),
  };
}

let currentFilters: ContentFilters = { ...DEFAULT_CONTENT_FILTERS };
let loaded = false;
const listeners = new Set<() => void>();

export function getContentFilters(): ContentFilters {
  return currentFilters;
}

export function contentFiltersLoaded(): boolean {
  return loaded;
}

export function subscribeContentFilters(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitContentFilters(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function setLocalContentFilters(next: ContentFilters, markLoaded = true): void {
  currentFilters = normalizeContentFilters(next);
  if (markLoaded) {
    loaded = true;
  }
  emitContentFilters();
}

let loadPromise: Promise<ContentFilters> | null = null;

export async function ensureContentFiltersLoaded(): Promise<ContentFilters> {
  if (loaded) {
    return currentFilters;
  }
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const result = await getFlatpakContentFilters();
        if (result.ok) {
          setLocalContentFilters(result);
          return currentFilters;
        }
        console.warn(
          `[DeckDepot] content filters unavailable ${result.errorCode} ${result.errorMessage}`
        );
      } catch (exc) {
        console.warn("[DeckDepot] content filters unavailable", exc);
      }
      setLocalContentFilters(DEFAULT_CONTENT_FILTERS);
      return currentFilters;
    })();
  }
  return loadPromise;
}

export async function persistContentFilter(
  key: ContentFilterKey,
  value: boolean
): Promise<ContentFilters> {
  const previous = currentFilters;
  const next = { ...currentFilters, [key]: value };
  setLocalContentFilters(next);
  try {
    const result = await setFlatpakContentFilters({ [key]: value });
    if (!result.ok) {
      setLocalContentFilters(previous);
      throw new Error(`${result.errorCode}: ${result.errorMessage}`);
    }
    setLocalContentFilters(result);
    return currentFilters;
  } catch (exc) {
    setLocalContentFilters(previous);
    throw exc;
  }
}

export { optionalBoolean };
