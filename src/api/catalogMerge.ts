import type { CatalogAppSummary } from "../types/catalog";
import { catalogKey, isFlathubSource } from "../types/provider";

function branchOf(app: CatalogAppSummary): string {
  return app.branch?.trim() || "stable";
}

function installedRank(state: CatalogAppSummary["installedState"]): number {
  if (state === "update_available") {
    return 3;
  }
  if (state === "installed") {
    return 2;
  }
  if (state === "not_installed") {
    return 1;
  }
  return 0;
}

function isGenericFlathub(app: CatalogAppSummary): boolean {
  return app.provider === "flatpak" && isFlathubSource(app) && !app.installationScope;
}

function pairKey(app: CatalogAppSummary): string {
  return `${app.provider}:${app.appId}:${branchOf(app)}`;
}

/** Keep local identity and fill empty catalog fields from the other row. */
export function mergeCatalogMetadata(
  identity: CatalogAppSummary,
  extra: CatalogAppSummary
): CatalogAppSummary {
  const preferInstalled =
    installedRank(extra.installedState) > installedRank(identity.installedState)
      ? extra.installedState
      : identity.installedState;
  return {
    ...identity,
    name: identity.name || extra.name,
    summary: identity.summary || extra.summary,
    iconUrl: identity.iconUrl || extra.iconUrl,
    categories: identity.categories?.length ? identity.categories : extra.categories || [],
    nativeCategories: identity.nativeCategories?.length
      ? identity.nativeCategories
      : extra.nativeCategories,
    developerName: identity.developerName || extra.developerName,
    projectLicense: identity.projectLicense || extra.projectLicense,
    isFreeLicense: identity.isFreeLicense ?? extra.isFreeLicense,
    verificationVerified: identity.verificationVerified ?? extra.verificationVerified,
    isEol: identity.isEol ?? extra.isEol,
    installedState: preferInstalled,
    sourceLabel: identity.sourceLabel || extra.sourceLabel,
    remoteName: identity.remoteName || extra.remoteName,
    origin: identity.origin || extra.origin,
    installationScope: identity.installationScope || extra.installationScope,
    branch: identity.branch || extra.branch,
    arch: identity.arch || extra.arch,
    ref: identity.ref || extra.ref,
    sourceId: identity.sourceId || extra.sourceId,
  };
}

function preferExact(current: CatalogAppSummary, incoming: CatalogAppSummary): CatalogAppSummary {
  if (installedRank(incoming.installedState) > installedRank(current.installedState)) {
    return mergeCatalogMetadata(incoming, current);
  }
  return mergeCatalogMetadata(current, incoming);
}

/**
 * Collapse accidental Flatpak duplicates without merging distinct apps.
 *
 * A generic Flathub hit (no installation scope) and a local row with the
 * same app id and branch are one application. The local row keeps its
 * remote, scope, and ref; Flathub fills missing metadata. User and system
 * rows stay separate. Different branches stay separate. The same display
 * name with a different app id stays separate. Repeated catalog keys,
 * including across pages, keep a single row.
 */
export function mergeBrowseApps(apps: CatalogAppSummary[]): CatalogAppSummary[] {
  const order: string[] = [];
  const byKey = new Map<string, CatalogAppSummary>();
  for (const app of apps) {
    const key = catalogKey(app);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, app);
      order.push(key);
      continue;
    }
    byKey.set(key, preferExact(existing, app));
  }
  const unique = order.map((key) => byKey.get(key)!);

  const scopedByPair = new Map<string, CatalogAppSummary[]>();
  for (const app of unique) {
    if (isGenericFlathub(app)) {
      continue;
    }
    const pair = pairKey(app);
    const list = scopedByPair.get(pair) ?? [];
    list.push(app);
    scopedByPair.set(pair, list);
  }

  const droppedGenerics = new Set<CatalogAppSummary>();
  const enriched = new Map<string, CatalogAppSummary>();
  for (const app of unique) {
    if (!isGenericFlathub(app)) {
      enriched.set(catalogKey(app), app);
    }
  }
  for (const generic of unique) {
    if (!isGenericFlathub(generic)) {
      continue;
    }
    const matches = scopedByPair.get(pairKey(generic)) ?? [];
    if (matches.length === 0) {
      continue;
    }
    droppedGenerics.add(generic);
    for (const match of matches) {
      const key = catalogKey(match);
      enriched.set(key, mergeCatalogMetadata(enriched.get(key) ?? match, generic));
    }
  }

  const result: CatalogAppSummary[] = [];
  for (const app of unique) {
    if (droppedGenerics.has(app)) {
      continue;
    }
    result.push(enriched.get(catalogKey(app)) ?? app);
  }
  return result;
}
