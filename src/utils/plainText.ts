const BLOCK_BREAK = /<\/(p|div|h[1-6]|li|tr)>/gi;
const LINE_BREAK = /<br\s*\/?>/gi;
const TAG = /<[^>]+>/g;
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function htmlToPlainText(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const withBreaks = value
    .replace(BLOCK_BREAK, "\n\n")
    .replace(LINE_BREAK, "\n")
    .replace(TAG, "");
  const decoded = withBreaks
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
      const lower = entity.toLowerCase();
      if (lower in NAMED) {
        return NAMED[lower];
      }
      if (lower.startsWith("#x")) {
        const code = Number.parseInt(lower.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : "";
      }
      if (lower.startsWith("#")) {
        const code = Number.parseInt(lower.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : "";
      }
      return match;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return decoded;
}

export function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || /[\s<>]/.test(trimmed)) {
    return undefined;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:") {
      return undefined;
    }
    if (parsed.username || parsed.password) {
      return undefined;
    }
    if (!parsed.hostname) {
      return undefined;
    }
    return parsed.href;
  } catch {
    return undefined;
  }
}
