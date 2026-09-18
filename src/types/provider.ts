export type ProviderId = "flatpak" | "appman";

export type AppManSearchScope = "default" | "all" | "appimages" | "portable";

export type AppManSourceId =
  | "am"
  | "soarpkg"
  | "busybox"
  | "coreutilsh"
  | "python"
  | "appbundle";

export const APPMAN_SEARCH_SCOPE_OPTIONS: Array<{
  value: AppManSearchScope;
  label: string;
  description: string;
}> = [
  {
    value: "default",
    label: "Default",
    description: "Search the main AM database.",
  },
  {
    value: "all",
    label: "All",
    description: "Include third-party AppMan databases.",
  },
  {
    value: "appimages",
    label: "AppImages only",
    description: "Limit search to AppImages.",
  },
  {
    value: "portable",
    label: "Portable only",
    description: "Limit search to non-AppImage portable apps.",
  },
];

export function catalogKey(app: {
  provider: ProviderId;
  appId: string;
  sourceId?: string;
}): string {
  if (app.provider === "appman") {
    return `appman:${app.sourceId || "am"}:${app.appId}`;
  }
  return `flatpak:${app.appId}`;
}
