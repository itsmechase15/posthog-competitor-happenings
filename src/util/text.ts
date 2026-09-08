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
 * PostHog writes dashes British-style: an en dash with a space either side.
 * https://posthog.com/handbook/wizard-and-docs/docs-style-guide
 */
export const EN_DASH = "\u2013";
export const SPACED_EN_DASH = ` ${EN_DASH} `;

/**
 * Punctuation the style guide settles for us, applied to every string on its
 * way to Slack or an issue: en dashes instead of em dashes, straight quotes
 * instead of curly ones. A model that slips back to `—` cannot ship it.
 */
export function sanitizeCopy(input: string): string {
  return input
    .replace(/[ \t]*[\u2014\u2015][ \t]*/g, SPACED_EN_DASH)
    // A dash between words takes spaces; a range like 2024–2025 keeps none.
    .replace(/(?<!\d)[ \t]*\u2013[ \t]*(?!\d)/g, SPACED_EN_DASH)
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d]/g, '"');
}

/**
 * Split prose into sentences. Abbreviations and decimals would fool a bare
 * split on ".", so a boundary also needs whitespace and a capital or digit
 * after it.
 */
export function sentences(input: string): string[] {
  return collapseWhitespace(input)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'“(])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** The first sentence, for the places that are allowed exactly one. */
export function firstSentence(input: string, max = 240): string {
  const [first] = sentences(input);
  return truncate(first ?? collapseWhitespace(input), max);
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

/**
 * How a page is named inside a sentence: "the best amplitude alternatives
 * page". Used where a reader has to be told which page an action is about and
 * a bare URL would eat the whole line.
 */
export function pageNameFromUrl(raw: string): string {
  const title = titleFromUrl(raw);
  return title === raw ? raw : `the ${title.toLowerCase()} page`;
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
