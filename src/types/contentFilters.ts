export type ContentFilterKey =
  | "freeSoftwareOnly"
  | "flathubResultsOnly"
  | "verifiedResultsOnly"
  | "hideEndOfLifeApps"
  | "respectDistroFilters";

export type ContentFilters = Record<ContentFilterKey, boolean>;

export const CONTENT_FILTER_KEYS: ContentFilterKey[] = [
  "freeSoftwareOnly",
  "flathubResultsOnly",
  "verifiedResultsOnly",
  "hideEndOfLifeApps",
  "respectDistroFilters",
];

export const DEFAULT_CONTENT_FILTERS: ContentFilters = {
  freeSoftwareOnly: false,
  flathubResultsOnly: false,
  verifiedResultsOnly: false,
  hideEndOfLifeApps: false,
  respectDistroFilters: true,
};
