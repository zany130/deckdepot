import type { ProviderId } from "../types/provider";

export type BrowseKind = "category" | "collection" | "index";

/**
 * A browse tab. Categories answer "what kind of app is this?".
 * Collections answer "what is new, updated, or ranked?" and are only listed
 * for providers that have a real data source.
 *
 * Flatpak collections use Flathub's official collection endpoints and keep
 * that response order. They are Flathub rankings: third-party remotes are
 * not mixed in, because those apps have no Flathub popularity or publish
 * time. AppMan's catalog files only carry a name and summary, so AppMan
 * does not offer these collections.
 */
export type BrowseDestination = {
  id: string;
  label: string;
  kind: BrowseKind;
  providers: readonly ProviderId[];
  /** Path under https://flathub.org/api/v2/collection/ */
  flathubCollection?: string;
  /** False for sections Flathub does not publish, such as Flatpark AI and Finance. */
  flathubCategory?: boolean;
  cacheTtlMs: number;
};

const TEN_MINUTES = 10 * 60 * 1000;
const THREE_MINUTES = 3 * 60 * 1000;

const CATEGORIES: BrowseDestination[] = [
  { id: "game", label: "Games", kind: "category", providers: ["flatpak", "appman"], cacheTtlMs: TEN_MINUTES },
  { id: "utility", label: "Utilities", kind: "category", providers: ["flatpak", "appman"], cacheTtlMs: TEN_MINUTES },
  { id: "audiovideo", label: "Audio & Video", kind: "category", providers: ["flatpak", "appman"], cacheTtlMs: TEN_MINUTES },
  { id: "graphics", label: "Graphics & Photography", kind: "category", providers: ["flatpak", "appman"], cacheTtlMs: TEN_MINUTES },
  { id: "network", label: "Networking", kind: "category", providers: ["flatpak"], cacheTtlMs: TEN_MINUTES },
  { id: "office", label: "Productivity", kind: "category", providers: ["flatpak"], cacheTtlMs: TEN_MINUTES },
  { id: "finance", label: "Finance", kind: "category", providers: ["flatpak"], flathubCategory: false, cacheTtlMs: TEN_MINUTES },
  { id: "development", label: "Developer Tools", kind: "category", providers: ["flatpak", "appman"], cacheTtlMs: TEN_MINUTES },
  { id: "ai", label: "AI", kind: "category", providers: ["flatpak"], flathubCategory: false, cacheTtlMs: TEN_MINUTES },
  { id: "education", label: "Education", kind: "category", providers: ["flatpak"], cacheTtlMs: TEN_MINUTES },
  { id: "science", label: "Science", kind: "category", providers: ["flatpak"], cacheTtlMs: TEN_MINUTES },
  { id: "system", label: "System", kind: "category", providers: ["flatpak"], cacheTtlMs: TEN_MINUTES },
];

/** AppMan-only tabs. The long AM category list stays behind All Categories. */
const APPMAN_TABS: BrowseDestination[] = [
  { id: "emulator", label: "Emulators", kind: "category", providers: ["appman"], cacheTtlMs: TEN_MINUTES },
  { id: "gnome", label: "GNOME", kind: "category", providers: ["appman"], cacheTtlMs: TEN_MINUTES },
  { id: "kde", label: "KDE", kind: "category", providers: ["appman"], cacheTtlMs: TEN_MINUTES },
  { id: "metapackages", label: "Metapackages", kind: "category", providers: ["appman"], cacheTtlMs: TEN_MINUTES },
  { id: "wine", label: "Wine", kind: "category", providers: ["appman"], cacheTtlMs: TEN_MINUTES },
  { id: "all-categories", label: "All Categories", kind: "index", providers: ["appman"], cacheTtlMs: TEN_MINUTES },
];

/**
 * AM software categories. Keep the ids aligned with
 * py_modules/deckdepot/appman_taxonomy.py SOFTWARE_CATEGORIES.
 * AppImages, portable apps, and the on-the-fly / CLI / desktop slices
 * are package formats, not entries in this list.
 */
export const APPMAN_SOFTWARE_CATEGORIES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "ai", label: "AI" },
  { id: "am-utils", label: "AM utilities" },
  { id: "android", label: "Android" },
  { id: "audio", label: "Audio" },
  { id: "comic", label: "Comic" },
  { id: "command-line", label: "Command Line" },
  { id: "communication", label: "Communication" },
  { id: "disk", label: "Disk" },
  { id: "education", label: "Education" },
  { id: "emulator", label: "Emulator" },
  { id: "file-manager", label: "File Manager" },
  { id: "finance", label: "Finance" },
  { id: "game", label: "Game" },
  { id: "gnome", label: "GNOME" },
  { id: "graphic", label: "Graphic" },
  { id: "internet", label: "Internet" },
  { id: "kde", label: "KDE" },
  { id: "metapackages", label: "Metapackages" },
  { id: "office", label: "Office" },
  { id: "password", label: "Password" },
  { id: "steam", label: "Steam" },
  { id: "system-monitor", label: "System Monitor" },
  { id: "video", label: "Video" },
  { id: "virtual-machine", label: "Virtual Machine" },
  { id: "wallet", label: "Wallet" },
  { id: "web-app", label: "Web App" },
  { id: "web-browser", label: "Web Browser" },
  { id: "wine", label: "Wine" },
  { id: "youtube", label: "YouTube" },
];

export const APPMAN_EVERYTHING_ID = "everything";

export const APPMAN_SOURCE_LABELS: Record<string, string> = {
  all: "All sources",
  am: "AM database",
  amutils: "AM utils",
  busybox: "BusyBox",
  coreutilsh: "Coreutils",
  python: "Python",
  appbundle: "AppBundle",
  soarpkg: "Soar",
};

export const APPMAN_FORMAT_FILTERS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "all", label: "All formats" },
  { id: "appimage", label: "AppImage" },
  { id: "portable", label: "Portable" },
];

const COLLECTIONS: BrowseDestination[] = [
  {
    id: "new-arrivals",
    label: "New Arrivals",
    kind: "collection",
    providers: ["flatpak"],
    flathubCollection: "recently-added",
    cacheTtlMs: THREE_MINUTES,
  },
  {
    id: "recently-updated",
    label: "Recently Updated",
    kind: "collection",
    providers: ["flatpak"],
    flathubCollection: "recently-updated",
    cacheTtlMs: THREE_MINUTES,
  },
  {
    id: "trending",
    label: "Trending",
    kind: "collection",
    providers: ["flatpak"],
    flathubCollection: "trending",
    cacheTtlMs: THREE_MINUTES,
  },
  {
    id: "popular",
    label: "Popular",
    kind: "collection",
    providers: ["flatpak"],
    flathubCollection: "popular",
    cacheTtlMs: THREE_MINUTES,
  },
];

export const BROWSE_DESTINATIONS: readonly BrowseDestination[] = [
  ...COLLECTIONS,
  ...CATEGORIES,
  ...APPMAN_TABS,
];

const BY_ID = new Map(BROWSE_DESTINATIONS.map((item) => [item.id, item]));

export function destinationById(id: string): BrowseDestination | undefined {
  return BY_ID.get(id);
}

export function destinationsFor(provider: ProviderId): BrowseDestination[] {
  return BROWSE_DESTINATIONS.filter((item) => item.providers.includes(provider));
}

export function defaultDestination(provider: ProviderId): string {
  return destinationsFor(provider)[0]?.id ?? "game";
}

export function resolveDestination(provider: ProviderId, current: string | null | undefined): string {
  const available = destinationsFor(provider);
  if (current && available.some((item) => item.id === current)) {
    return current;
  }
  return available[0]?.id ?? "game";
}

export function cycleDestination(ids: readonly string[], active: string, direction: -1 | 1): string {
  if (ids.length === 0) {
    return active;
  }
  const index = Math.max(0, ids.indexOf(active));
  return ids[(index + direction + ids.length) % ids.length];
}

export function isBrowseCacheFresh(fetchedAt: number, now: number, ttlMs: number): boolean {
  return now - fetchedAt < ttlMs;
}

export function categoryIds(): string[] {
  return CATEGORIES.map((item) => item.id);
}

export function appmanCategoryLabel(id: string): string {
  if (id === APPMAN_EVERYTHING_ID) {
    return "All applications";
  }
  return APPMAN_SOFTWARE_CATEGORIES.find((item) => item.id === id)?.label ?? destinationById(id)?.label ?? id;
}
