import { fetchNoCors } from "@decky/api";
import {
  FLATHUB_APPSTREAM_URL,
  FLATHUB_CATEGORY_URL,
  FLATHUB_SEARCH_URL,
} from "../constants";
import {
  CatalogAppSummary,
  CatalogDetailsResult,
  CatalogFailure,
  CatalogScreenshot,
  CatalogSearchResult,
} from "../types/catalog";
import { htmlToPlainText, httpsUrl } from "../utils/plainText";
import {
  AppstreamSchema,
  IconEntrySchema,
  ScreenshotSchema,
  SearchHitSchema,
  SearchResponseSchema,
} from "./flathubSchemas";

const REQUEST_TIMEOUT_MS = 15000;
const RETRY_DELAY_MS = 400;
const MAX_ATTEMPTS = 3;
const CATEGORY_PAGE_SIZE = 20;

export const CURATED_CATEGORIES = [
  { slug: "game", label: "Games" },
  { slug: "utility", label: "Utilities" },
  { slug: "audiovideo", label: "Audio & Video" },
  { slug: "graphics", label: "Graphics" },
  { slug: "network", label: "Network" },
  { slug: "office", label: "Office" },
  { slug: "development", label: "Development" },
] as const;

function failure(
  errorCode: CatalogFailure["errorCode"],
  errorMessage: string,
  httpStatus?: number
): CatalogFailure {
  return { ok: false, errorCode, errorMessage, httpStatus };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchJson(
  url: string,
  init: RequestInit,
  signal?: AbortSignal
): Promise<
  | { ok: true; status: number; value: unknown }
  | { ok: false; kind: "network" | "http" | "schema"; status?: number; message: string }
> {
  // Steam CEF's fetch() rejects with "Failed to fetch" when given an AbortSignal,
  // and plugin-origin CORS often blocks Flathub. Decky fetchNoCors is the
  // frontend catalog path; timeout/cancel wrap it instead of using signal.
  let timer: number | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = window.setTimeout(
      () => reject(new Error("Flathub request timed out")),
      REQUEST_TIMEOUT_MS
    );
    const onAbort = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const response = await Promise.race([
      fetchNoCors(url, {
        method: init.method,
        headers: {
          Accept: "application/json",
          ...(init.headers ?? {}),
        },
        body: init.body,
      }),
      timeout,
    ]);
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        kind: "http",
        status: response.status,
        message: `Flathub HTTP ${response.status}`,
      };
    }
    try {
      return { ok: true, status: response.status, value: JSON.parse(text) as unknown };
    } catch {
      return {
        ok: false,
        kind: "schema",
        status: response.status,
        message: "Flathub returned a non-JSON body",
      };
    }
  } catch (exc) {
    if (signal?.aborted || (exc instanceof DOMException && exc.name === "AbortError")) {
      throw exc instanceof DOMException && exc.name === "AbortError"
        ? exc
        : new DOMException("Aborted", "AbortError");
    }
    return {
      ok: false,
      kind: "network",
      message: exc instanceof Error ? exc.message : String(exc),
    };
  } finally {
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }
  }
}

async function fetchJsonRetry(
  url: string,
  init: RequestInit,
  signal?: AbortSignal
): Promise<Awaited<ReturnType<typeof fetchJson>>> {
  let last = await fetchJson(url, init, signal);
  for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (last.ok) {
      return last;
    }
    if (last.kind === "schema") {
      return last;
    }
    if (last.kind === "http" && last.status !== undefined && last.status < 500) {
      return last;
    }
    await sleep(RETRY_DELAY_MS * 2 ** (attempt - 1), signal);
    last = await fetchJson(url, init, signal);
  }
  return last;
}

function toSummary(hit: {
  app_id: string;
  name: string;
  summary?: string | null;
  icon?: string | null;
  main_categories?: string | null;
  developer_name?: string | null;
}): CatalogAppSummary | null {
  const appId = hit.app_id.trim();
  const name = hit.name.trim();
  if (!appId || !name) {
    return null;
  }
  const categories = hit.main_categories?.trim() ? [hit.main_categories.trim()] : [];
  return {
    provider: "flatpak",
    appId,
    name,
    summary: hit.summary?.trim() || undefined,
    iconUrl: httpsUrl(hit.icon),
    categories,
    developerName: hit.developer_name?.trim() || undefined,
    installedState: "unknown",
  };
}

function parseSearchPayload(
  value: unknown,
  fallbackQuery: string
): CatalogSearchResult {
  const parsed = SearchResponseSchema.safeParse(value);
  if (!parsed.success) {
    return failure(
      "REMOTE_SCHEMA_ERROR",
      "Flathub search response did not match the validated schema"
    );
  }
  const apps: CatalogAppSummary[] = [];
  let droppedHitCount = 0;
  for (const rawHit of parsed.data.hits) {
    const hit = SearchHitSchema.safeParse(rawHit);
    if (!hit.success) {
      droppedHitCount += 1;
      continue;
    }
    const summary = toSummary(hit.data);
    if (!summary) {
      droppedHitCount += 1;
      continue;
    }
    apps.push(summary);
  }
  if (parsed.data.hits.length > 0 && apps.length === 0) {
    return failure(
      "REMOTE_SCHEMA_ERROR",
      "Flathub search returned hits that could not be validated"
    );
  }
  return {
    ok: true,
    query: parsed.data.query ?? fallbackQuery,
    apps,
    totalHits: parsed.data.totalHits ?? apps.length,
    page: parsed.data.page ?? 1,
    totalPages: parsed.data.totalPages ?? 1,
    droppedHitCount,
  };
}

function pickScreenshot(entry: {
  caption?: string | null;
  sizes?: Array<{ src: string; width?: number; height?: number }> | null;
}): CatalogScreenshot | null {
  const sizes = entry.sizes ?? [];
  let best: { src: string; width?: number; height?: number } | undefined;
  for (const size of sizes) {
    const url = httpsUrl(size.src);
    if (!url) {
      continue;
    }
    if (!best || (size.width ?? 0) > (best.width ?? 0)) {
      best = { ...size, src: url };
    }
  }
  if (!best) {
    return null;
  }
  return {
    url: best.src,
    width: best.width,
    height: best.height,
    caption: entry.caption?.trim() || undefined,
  };
}

function toDetails(value: unknown): CatalogDetailsResult {
  const parsed = AppstreamSchema.safeParse(value);
  if (!parsed.success) {
    return failure(
      "REMOTE_SCHEMA_ERROR",
      "Flathub appstream response did not match the validated schema"
    );
  }
  const data = parsed.data;
  const screenshots: CatalogScreenshot[] = [];
  for (const rawShot of data.screenshots ?? []) {
    const shot = ScreenshotSchema.safeParse(rawShot);
    if (!shot.success) {
      continue;
    }
    const mapped = pickScreenshot(shot.data);
    if (mapped) {
      screenshots.push(mapped);
    }
  }
  const fallbackIcon = (data.icons ?? [])
    .map((raw) => IconEntrySchema.safeParse(raw))
    .find((icon) => icon.success && httpsUrl(icon.data.url));
  const iconUrl =
    httpsUrl(data.icon) ??
    (fallbackIcon?.success ? httpsUrl(fallbackIcon.data.url) : undefined);
  const categories = (data.categories ?? [])
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  let latest: string | undefined;
  for (const rawRelease of data.releases ?? []) {
    if (
      rawRelease &&
      typeof rawRelease === "object" &&
      "version" in rawRelease &&
      typeof rawRelease.version === "string" &&
      rawRelease.version.trim()
    ) {
      latest = rawRelease.version.trim();
      break;
    }
  }
  return {
    ok: true,
    app: {
      provider: "flatpak",
      appId: data.id.trim(),
      name: data.name.trim(),
      summary: data.summary?.trim() || undefined,
      iconUrl,
      categories,
      developerName: data.developer_name?.trim() || undefined,
      installedState: "unknown",
      descriptionText: htmlToPlainText(data.description) || undefined,
      projectLicense: data.project_license?.trim() || undefined,
      homepageUrl: httpsUrl(data.urls?.homepage),
      screenshots,
      launchableDesktopId: data.launchable?.value?.trim() || undefined,
      bundleRef: data.bundle?.value?.trim() || undefined,
      latestVersion: latest || null,
    },
  };
}

function mapFetchError(
  result: Exclude<Awaited<ReturnType<typeof fetchJson>>, { ok: true }>
): CatalogFailure {
  if (result.kind === "schema") {
    return failure("REMOTE_SCHEMA_ERROR", result.message, result.status);
  }
  return failure("NETWORK_ERROR", result.message, result.status);
}

export async function searchFlathub(
  query: string,
  options: { page?: number; signal?: AbortSignal } = {}
): Promise<CatalogSearchResult> {
  const trimmed = query.trim();
  const fetched = await fetchJsonRetry(
    FLATHUB_SEARCH_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: trimmed,
        filters: [],
        page: options.page ?? 1,
      }),
    },
    options.signal
  );
  if (!fetched.ok) {
    return mapFetchError(fetched);
  }
  return parseSearchPayload(fetched.value, trimmed);
}

export async function listFlathubCategory(
  slug: string,
  options: { page?: number; signal?: AbortSignal } = {}
): Promise<CatalogSearchResult> {
  const page = options.page ?? 1;
  const url =
    `${FLATHUB_CATEGORY_URL}${encodeURIComponent(slug)}` +
    `?page=${page}&per_page=${CATEGORY_PAGE_SIZE}`;
  const fetched = await fetchJsonRetry(url, { method: "GET" }, options.signal);
  if (!fetched.ok) {
    return mapFetchError(fetched);
  }
  return parseSearchPayload(fetched.value, slug);
}

export async function getFlathubAppDetails(
  appId: string,
  options: { signal?: AbortSignal } = {}
): Promise<CatalogDetailsResult> {
  const trimmed = appId.trim();
  const fetched = await fetchJsonRetry(
    `${FLATHUB_APPSTREAM_URL}${encodeURIComponent(trimmed)}`,
    { method: "GET" },
    options.signal
  );
  if (!fetched.ok) {
    return mapFetchError(fetched);
  }
  return toDetails(fetched.value);
}

export function catalogErrorText(result: CatalogFailure): string {
  const status = result.httpStatus ? ` (HTTP ${result.httpStatus})` : "";
  return `${result.errorCode}${status}: ${result.errorMessage}`;
}
