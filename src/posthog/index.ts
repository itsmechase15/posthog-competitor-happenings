import { COMPETITORS, COMPETITOR_IDS, type Config } from "../config.js";
import type { Store } from "../db/store.js";
import { createLogger } from "../log.js";
import type { CompetitorId, PostHogClaim, PostHogPage } from "../types.js";
import { extractPage } from "../util/html.js";
import { fetchText } from "../util/http.js";
import { normalizeUrl, truncate } from "../util/text.js";
import { parseSitemap } from "../sources/sitemap.js";
import { CANONICAL_DOC_URLS } from "./products.js";

const log = createLogger("posthog-index");

const SITEMAP_URL = "https://posthog.com/sitemap/sitemap-0.xml";

/** Page text stored per page. Enough for citation, small enough for a jsonb-heavy table. */
const MAX_STORED_TEXT = 40_000;
const MAX_CLAIMS_PER_PAGE = 12;
const MIN_CLAIM_LENGTH = 60;

/**
 * Paths worth indexing. Community Q&A under /questions/ mentions competitors
 * constantly but is not marketing copy anyone would edit, so it is excluded.
 */
const INCLUDED_PREFIXES = [
  "/compare",
  "/blog/",
  "/docs/",
  "/product",
  "/tutorials/",
  "/customers/",
  "/pricing",
];
const EXCLUDED_PREFIXES = ["/questions/", "/community/", "/careers", "/handbook"];

/**
 * Lower sorts first. The canonical product docs lead, ahead even of the
 * comparison pages: they are what an "enhance this" or "build this"
 * recommendation gets checked against, and a compare page written last year is
 * not evidence about what the product does today.
 */
export function candidatePriority(url: string): number {
  const lower = url.toLowerCase();
  if (CANONICAL_DOC_URLS.includes(normalizeUrl(url))) return 0;
  const named = COMPETITOR_IDS.some((id) => lower.includes(id));
  if (named && lower.includes("/compare")) return 1;
  if (named) return 2;
  if (lower.includes("/compare")) return 3;
  if (lower.includes("/blog/")) return 4;
  if (lower.includes("/product")) return 5;
  return 6;
}

export function isIndexCandidate(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    if (hostname !== "posthog.com" && hostname !== "www.posthog.com") return false;
    if (EXCLUDED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return false;
    return INCLUDED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  } catch {
    return false;
  }
}

export function detectMentions(text: string): CompetitorId[] {
  const lower = text.toLowerCase();
  return COMPETITOR_IDS.filter((id) =>
    COMPETITORS[id].aliases.some((alias) => lower.includes(alias)),
  );
}

/** Pull out the paragraphs that actually name a competitor, with their heading. */
export function extractClaims(
  url: string,
  blocks: Array<{ heading: string | null; paragraph: string }>,
): PostHogClaim[] {
  const claims: PostHogClaim[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    if (block.paragraph.length < MIN_CLAIM_LENGTH) continue;
    for (const competitor of detectMentions(block.paragraph)) {
      const key = `${competitor}|${block.paragraph}`;
      if (seen.has(key)) continue;
      seen.add(key);
      claims.push({
        url,
        competitor,
        paragraph: truncate(block.paragraph, 1_200),
        heading: block.heading,
      });
    }
  }

  return claims.slice(0, MAX_CLAIMS_PER_PAGE);
}

async function listCandidateUrls(config: Config): Promise<string[]> {
  const xml = await fetchText(SITEMAP_URL, {
    timeoutMs: config.httpTimeoutMs,
    userAgent: config.userAgent,
    accept: "application/xml, text/xml, */*",
  });
  // The canonical docs are added by hand rather than trusted to the sitemap:
  // they are the pages analysis reads to check a gap claim, so they are in the
  // index whether or not posthog.com lists them today.
  const urls = [...CANONICAL_DOC_URLS, ...parseSitemap(xml).entries.map((entry) => entry.url)]
    .map(normalizeUrl)
    .filter(isIndexCandidate);
  return [...new Set(urls)].sort(
    (a, b) => candidatePriority(a) - candidatePriority(b) || a.localeCompare(b),
  );
}

export interface IndexResult {
  fetched: number;
  withMentions: number;
  claims: number;
}

/**
 * Refresh the PostHog.com index. Budget-limited per run: it prioritises pages
 * that name a competitor, skips pages fetched recently, and stores every page
 * it fetches (mentions or not) so the next run does not re-check them.
 */
export async function refreshPostHogIndex(config: Config, store: Store): Promise<IndexResult> {
  const result: IndexResult = { fetched: 0, withMentions: 0, claims: 0 };
  if (config.skipPosthogIndex) {
    log.info("skipping PostHog.com index (SKIP_POSTHOG_INDEX)");
    return result;
  }

  const candidates = await listCandidateUrls(config);
  const indexed = await store.getIndexedPageUrls();
  const staleBefore = new Date(Date.now() - config.posthogRefreshDays * 24 * 60 * 60 * 1000);

  const neverIndexed: string[] = [];
  const stale: string[] = [];
  for (const url of candidates) {
    const fetchedAt = indexed.get(url);
    if (fetchedAt === undefined) neverIndexed.push(url);
    else if (fetchedAt < staleBefore) stale.push(url);
  }

  // Split the budget so refreshing the comparison pages never starves the
  // long tail of pages we have not looked at yet.
  const refreshBudget = Math.floor(config.posthogMaxPages / 2);
  const refreshing = stale.slice(0, refreshBudget);
  const queue = [...refreshing, ...neverIndexed.slice(0, config.posthogMaxPages - refreshing.length)];

  log.info(
    `PostHog index: ${candidates.length} candidates, ${neverIndexed.length} never indexed, ${stale.length} stale — fetching ${queue.length}`,
  );

  for (const url of queue) {
    try {
      const html = await fetchText(url, {
        timeoutMs: config.httpTimeoutMs,
        userAgent: config.userAgent,
        accept: "text/html,application/xhtml+xml",
        attempts: 2,
      });
      const extracted = extractPage(html);
      const mentions = detectMentions(extracted.text);
      const page: PostHogPage = {
        url,
        title: extracted.title || url,
        text: truncate(extracted.text, MAX_STORED_TEXT),
        mentions,
        fetchedAt: new Date(),
      };
      await store.upsertPage(page);
      result.fetched += 1;

      const claims = mentions.length > 0 ? extractClaims(url, extracted.blocks) : [];
      await store.replaceClaimsForUrl(url, claims);
      if (mentions.length > 0) result.withMentions += 1;
      result.claims += claims.length;
    } catch (error) {
      log.warn(`failed to index ${url}`, error instanceof Error ? error.message : error);
    }
  }

  log.info(
    `PostHog index: fetched ${result.fetched} pages, ${result.withMentions} mention a competitor, ${result.claims} claims`,
  );
  return result;
}
