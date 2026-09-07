import { COMPETITORS, type Config } from "../config.js";
import { createLogger } from "../log.js";
import type { CandidateItem, FeatureImage, StoredItem } from "../types.js";
import { extractImageUrls } from "../util/html.js";
import { fetchContentType, fetchText } from "../util/http.js";
import { truncate } from "../util/text.js";

const log = createLogger("image");

/** How many candidates from one page we are willing to probe before giving up. */
const MAX_CANDIDATES = 4;

/**
 * Some sites hand every page the same og:image. Amplitude's releases all
 * declare `amplitude-default-seo.png`, which is a brand card, not the feature.
 * A screenshot of the actual page beats that, so these sort last.
 */
const GENERIC_PREVIEW = /(default[-_.]?(seo|og|share|social)|(og|seo|share|social)[-_.]?default)/i;

export function isGenericPreview(url: string): boolean {
  return GENERIC_PREVIEW.test(url);
}

/** Alt text is for screen readers and for Slack's own fallback line. */
function altTextFor(item: Pick<CandidateItem, "competitor" | "title">): string {
  return truncate(`${COMPETITORS[item.competitor].label}: ${item.title}`, 140);
}

/**
 * Renders the page and serves the result as an image, so the last resort is a
 * real screenshot of the competitor's feature page without shipping a browser
 * into the daily job. Swappable via `SCREENSHOT_URL_TEMPLATE`.
 */
export function screenshotUrl(template: string, pageUrl: string): string {
  return template.includes("{url}")
    ? template.replace("{url}", pageUrl)
    : `${template}${pageUrl}`;
}

/**
 * A generated card naming the competitor and the feature. Never pretty, but an
 * alert always has to open with a valid image, and this one cannot 404.
 */
export function generatedCardUrl(item: Pick<CandidateItem, "competitor" | "title">): string {
  const label = COMPETITORS[item.competitor].label;
  const text = encodeURIComponent(truncate(`${label}\n${item.title}`, 90));
  return `https://placehold.co/1200x630/1d1f27/f9bd2b/png?text=${text}&font=source-sans-pro`;
}

/** The image URL a source handed us directly, if it gave one. */
export function imageFromRaw(item: Pick<StoredItem, "raw">): string | null {
  const candidate = (item.raw as Record<string, unknown>).image;
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : null;
}

async function servesAnImage(config: Config, url: string): Promise<boolean> {
  const contentType = await fetchContentType(url, {
    timeoutMs: config.httpTimeoutMs,
    userAgent: config.userAgent,
    accept: "image/*",
  });
  if (contentType === null) return false;
  return contentType.toLowerCase().startsWith("image/");
}

async function candidatesFromPage(config: Config, url: string): Promise<string[]> {
  try {
    const html = await fetchText(url, {
      timeoutMs: config.httpTimeoutMs,
      userAgent: config.userAgent,
      accept: "text/html,application/xhtml+xml",
      attempts: 2,
    });
    return extractImageUrls(html, url).slice(0, MAX_CANDIDATES);
  } catch (error) {
    log.debug(`could not read ${url} for images: ${error instanceof Error ? error.message : error}`);
    return [];
  }
}

/**
 * Find the picture that goes at the top of an alert: whatever the feed or tweet
 * attached, then the page's own og:image or an in-content screenshot, then a
 * rendered screenshot of the page, and finally a generated card. The last step
 * cannot fail, because an alert without an image does not get posted.
 */
export async function resolveFeatureImage(config: Config, item: StoredItem): Promise<FeatureImage> {
  const altText = altTextFor(item);
  const fromSource = imageFromRaw(item);

  if (fromSource && (await servesAnImage(config, fromSource))) {
    return { url: fromSource, altText, origin: item.source === "x" ? "x" : "feed" };
  }

  const candidates = await candidatesFromPage(config, item.url);
  const specific = candidates.filter((url) => !isGenericPreview(url));
  const generic = candidates.filter(isGenericPreview);

  for (const candidate of specific) {
    if (await servesAnImage(config, candidate)) {
      return { url: candidate, altText, origin: "page" };
    }
  }

  const shot = screenshotUrl(config.screenshotUrlTemplate, item.url);
  if (await servesAnImage(config, shot)) {
    return { url: shot, altText, origin: "screenshot" };
  }

  // A brand card is still better than a card we generated ourselves.
  for (const candidate of generic) {
    if (await servesAnImage(config, candidate)) {
      return { url: candidate, altText, origin: "page" };
    }
  }

  log.warn(`no usable image for ${item.url} — falling back to a generated card`);
  return { url: generatedCardUrl(item), altText, origin: "generated" };
}
