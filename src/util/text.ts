import { createHash } from "node:crypto";

export function sha1(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

export function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Parse a date from a feed or API payload. Returns null rather than an
 * Invalid Date so callers can treat "no date" and "bad date" the same way.
 */
export function parseDate(input: unknown): Date | null {
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  if (typeof input !== "string" && typeof input !== "number") return null;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function daysAgo(days: number, now = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/** Drop tracking params and fragments so the same page always dedupes to one URL. */
export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || key.toLowerCase() === "ref") {
        url.searchParams.delete(key);
      }
    }
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return raw.trim();
  }
}

/** Turn a slug like "first-party-domains" into "First party domains". */
export function titleFromUrl(raw: string): string {
  try {
    const { pathname } = new URL(raw);
    const slug = pathname.split("/").filter(Boolean).pop() ?? pathname;
    const words = decodeURIComponent(slug).replace(/[-_]+/g, " ").trim();
    if (!words) return raw;
    return words.charAt(0).toUpperCase() + words.slice(1);
  } catch {
    return raw;
  }
}
