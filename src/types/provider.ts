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
  installationScope?: string;
  remoteName?: string;
  arch?: string;
  branch?: string;
}): string {
  if (app.provider === "appman") {
    return `appman:${app.sourceId || "am"}:${app.appId}`;
  }
  if (app.remoteName && app.installationScope && app.arch && app.branch) {
    return `flatpak:${app.installationScope}:${app.remoteName}:${app.appId}:${app.arch}:${app.branch}`;
  }
  if (app.installationScope) {
    return `flatpak:${app.installationScope}:${app.appId}`;
  }
  if (app.remoteName) {
    return `flatpak:${app.remoteName}:${app.appId}`;
  }
  return `flatpak:${app.appId}`;
}

export function isFlathubSource(app: {
  remoteName?: string | null;
  origin?: string | null;
  sourceLabel?: string | null;
}): boolean {
  const name = (app.remoteName || app.origin || "").trim().toLowerCase();
  if (name === "flathub") {
    return true;
  }
  const label = (app.sourceLabel || "").trim().toLowerCase();
  return label === "flathub";
}
