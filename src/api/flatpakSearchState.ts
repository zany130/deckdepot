import {
  CatalogAppSummary,
  CatalogFailure,
  CatalogRemoteWarning,
  CatalogSearchResult,
} from "../types/catalog";

export const FLATPAK_SEARCH_EMPTY_HINT = "Try another search term.";
export const FLATPAK_SEARCH_PARTIAL_WARNING =
  "Some Flatpak sources couldn't be searched.";
export const FLATPAK_SEARCH_TOTAL_FAILURE_TITLE = "Couldn't search Flatpak sources.";
export const FLATPAK_SEARCH_TOTAL_FAILURE_HINT = "Try again.";

const SOURCE_LABELS: Record<string, string> = {
  user: "your user remotes",
  system: "system remotes",
  flathub: "Flathub",
  search: "Flatpak search",
  remotes: "configured remotes",
};

export function failedSourceLabel(remoteName: string): string {
  return SOURCE_LABELS[remoteName] || remoteName;
}

export function emptySearchMessage(query: string): string {
  return `No apps found for "${query}".`;
}

function sourceFailed(
  warnings: CatalogRemoteWarning[],
  name: string
): boolean {
  return warnings.some((item) => item.remoteName === name);
}

export function logSearchDiagnostics(
  query: string,
  failures: CatalogRemoteWarning[]
): void {
  if (failures.length === 0) {
    return;
  }
  for (const item of failures) {
    console.warn(
      `[DeckDepot] Flatpak search source failed query=${JSON.stringify(query)} source=${item.remoteName} ${item.errorMessage}`
    );
  }
}

export function presentFlatpakSearch(input: {
  query: string;
  host: CatalogSearchResult;
  http: CatalogSearchResult;
  apps: CatalogAppSummary[];
  droppedHitCount: number;
}): CatalogSearchResult {
  const hostWarnings = input.host.ok ? input.host.warnings || [] : [];
  const failures: CatalogRemoteWarning[] = [...hostWarnings];
  if (!input.host.ok) {
    failures.push({
      remoteName: "search",
      errorMessage: input.host.errorMessage,
    });
  }
  if (!input.http.ok) {
    failures.push({
      remoteName: "flathub",
      errorMessage: input.http.errorMessage,
    });
  }

  const userOk = input.host.ok && !sourceFailed(hostWarnings, "user");
  const systemOk = input.host.ok && !sourceFailed(hostWarnings, "system");
  const httpOk = input.http.ok;
  const usableCount = [userOk, systemOk, httpOk].filter(Boolean).length;

  logSearchDiagnostics(input.query, failures);

  if (usableCount === 0) {
    const failure: CatalogFailure = {
      ok: false,
      errorCode: "NETWORK_ERROR",
      errorMessage: FLATPAK_SEARCH_TOTAL_FAILURE_TITLE,
    };
    return failure;
  }

  const failedSourceLabels = [
    ...new Set(failures.map((item) => failedSourceLabel(item.remoteName))),
  ];
  return {
    ok: true,
    query: input.query,
    apps: input.apps,
    totalHits: input.apps.length,
    page: 1,
    totalPages: 1,
    droppedHitCount: input.droppedHitCount,
    partialFailure: failures.length > 0,
    failedSourceLabels: failures.length > 0 ? failedSourceLabels : undefined,
  };
}

export type SearchPresentationKind =
  | "results"
  | "empty-success"
  | "partial-failure"
  | "total-failure";

export function searchPresentationKind(
  result: CatalogSearchResult
): SearchPresentationKind {
  if (!result.ok) {
    return "total-failure";
  }
  if (result.partialFailure) {
    return "partial-failure";
  }
  if (result.apps.length === 0) {
    return "empty-success";
  }
  return "results";
}
