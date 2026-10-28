import type { ProviderId } from "../types/provider";

export type BrowseKind = "category" | "collection";

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
  cacheTtlMs: number;
};

const TEN_MINUTES = 10 * 60 * 1000;
const THREE_MINUTES = 3 * 60 * 1000;

const CATEGORIES: BrowseDestination[] = [
  { id: "game", label: "Games", kind: "category", providers: ["flatpak", "appman"], cacheTtlMs: TEN_MINUTES },
  { id: "utility", label: "Utilities", kind: "category", providers: ["flatpak", "appman"], cacheTtlMs: TEN_MINUTES },
  { id: "audiovideo", label: "Audio & Video", kind: "category", providers: ["flatpak", "appman"], cacheTtlMs: TEN_MINUTES },
  { id: "graphics", label: "Graphics", kind: "category", providers: ["flatpak", "appman"], cacheTtlMs: TEN_MINUTES },
  { id: "network", label: "Network", kind: "category", providers: ["flatpak", "appman"], cacheTtlMs: TEN_MINUTES },
  { id: "office", label: "Office", kind: "category", providers: ["flatpak", "appman"], cacheTtlMs: TEN_MINUTES },
  { id: "development", label: "Development", kind: "category", providers: ["flatpak", "appman"], cacheTtlMs: TEN_MINUTES },
  { id: "education", label: "Education", kind: "category", providers: ["flatpak", "appman"], cacheTtlMs: TEN_MINUTES },
  { id: "science", label: "Science", kind: "category", providers: ["flatpak", "appman"], cacheTtlMs: TEN_MINUTES },
  { id: "system", label: "System", kind: "category", providers: ["flatpak", "appman"], cacheTtlMs: TEN_MINUTES },
  { id: "healthfitness", label: "Health & Fitness", kind: "category", providers: ["flatpak", "appman"], cacheTtlMs: TEN_MINUTES },
  { id: "other", label: "Other", kind: "category", providers: ["flatpak", "appman"], cacheTtlMs: TEN_MINUTES },
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
