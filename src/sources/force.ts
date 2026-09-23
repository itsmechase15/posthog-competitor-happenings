import { COMPETITORS, COMPETITOR_IDS, type Config, type CompetitorConfig } from "../config.js";
import { createLogger } from "../log.js";
import type { CandidateItem, SourceId } from "../types.js";
import { extractImageUrls, extractPage, extractPublishedAt } from "../util/html.js";
import { fetchText } from "../util/http.js";
import { normalizeUrl, titleFromUrl, truncate } from "../util/text.js";
import { sitemapEntryToItem } from "./blog.js";
import { matchesAnyPrefix, readSitemap } from "./sitemap.js";

const log = createLogger("force");

const MAX_BODY_CHARS = 8_000;

/** A competitor source a named URL belongs to, and how we found that out. */
export interface ForcedSource {
  competitor: CompetitorConfig;
  source: Extract<SourceId, "blog" | "changelog">;
}

export interface ForcedCandidate {
  item: CandidateItem;
  /** Where the item came from, for the run's log line. */
  via: string;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Everything under the directory the changelog feed lives in: Mixpanel's feed
 * is at `/changelogs/rss.xml` and its entries are anchors on `/changelogs`,
 * Amplitude's is at `/releases/feed.xml` and its entries are `/releases/…`.
 */
function changelogPrefix(feedUrl: string): string | null {
  try {
    const segments = new URL(feedUrl).pathname.split("/").filter(Boolean);
    segments.pop();
    return segments.length > 0 ? `/${segments.join("/")}` : null;
  } catch {
    return null;
  }
}

function matchesCompetitor(competitor: CompetitorConfig, url: string): ForcedSource | null {
  const host = hostOf(url);
  if (!host) return null;

  const blogHosts = competitor.sitemaps.map(hostOf).filter((value): value is string => value !== null);
  if (blogHosts.includes(host) && matchesAnyPrefix(url, competitor.blogPathPrefixes)) {
    return { competitor, source: "blog" };
  }

  const prefix = changelogPrefix(competitor.changelogFeed);
  if (prefix && hostOf(competitor.changelogFeed) === host && matchesAnyPrefix(url, [prefix])) {
    return { competitor, source: "changelog" };
  }

  return null;
}

/**
 * The competitor source a URL belongs to, or null when it belongs to none.
 *
 * This is the guard on the whole force path: a URL nobody configured is not a
 * competitor announcement, however much it looks like one, and the run says so
 * rather than posting an alert about a page it made up a competitor for.
 */
export function forcedSourceFor(rawUrl: string): ForcedSource | null {
  const url = normalizeUrl(rawUrl);
  for (const id of COMPETITOR_IDS) {
    const match = matchesCompetitor(COMPETITORS[id], url);
    if (match) return match;
  }
  return null;
}

/** The competitor's whole sitemap, unfiltered by date, looking for one URL. */
async function findInSitemaps(
  config: Config,
  competitor: CompetitorConfig,
  wanted: string,
): Promise<CandidateItem | null> {
  for (const sitemap of competitor.sitemaps) {
    try {
      const entries = await readSitemap(config, sitemap);
      const entry = entries.find((candidate) => normalizeUrl(candidate.url) === wanted);
      if (entry) return sitemapEntryToItem(competitor, entry);
    } catch (error) {
      log.warn(
        `could not read ${competitor.label}'s sitemap ${sitemap}`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return null;
}

/**
 * The page itself as a candidate, for a post the sitemap does not list. Its
 * own title and date, because a slug and today's date would both be guesses.
 */
async function fetchAsCandidate(
  config: Config,
  { competitor, source }: ForcedSource,
  wanted: string,
): Promise<CandidateItem | null> {
  let html: string;
  try {
    html = await fetchText(wanted, {
      timeoutMs: config.httpTimeoutMs,
      userAgent: config.userAgent,
      accept: "text/html,application/xhtml+xml",
      attempts: 2,
    });
  } catch (error) {
    log.warn(`could not fetch ${wanted}`, error instanceof Error ? error.message : error);
    return null;
  }

  const page = extractPage(html);
  return {
    competitor: competitor.id,
    source,
    externalId: wanted,
    title: page.title || titleFromUrl(wanted),
    url: wanted,
    publishedAt: extractPublishedAt(html),
    raw: {
      discoveredVia: "force-url",
      description: page.description,
      body: truncate(page.text, MAX_BODY_CHARS),
      image: extractImageUrls(html, wanted)[0] ?? null,
    },
  };
}

/**
 * Find a named URL that the day's candidates do not have.
 *
 * A post drops out of collection long before it drops off the site: blog
 * candidates are the sitemap's recent slice, so anything older than the
 * lookback window is real, still published, and invisible to a force post.
 * Two ways back to it, in order of how much they know: the competitor's full
 * sitemap, which carries the same lastmod the daily run would have used, then
 * the page itself. Both stay inside the configured sources.
 */
export async function resolveForcedCandidate(
  config: Config,
  rawUrl: string,
): Promise<ForcedCandidate | null> {
  const wanted = normalizeUrl(rawUrl);
  const match = forcedSourceFor(wanted);
  if (!match) return null;

  if (match.source === "blog") {
    const fromSitemap = await findInSitemaps(config, match.competitor, wanted);
    if (fromSitemap) return { item: fromSitemap, via: `${match.competitor.label}'s sitemap` };
  }

  const fromPage = await fetchAsCandidate(config, match, wanted);
  return fromPage ? { item: fromPage, via: "the page itself" } : null;
}
