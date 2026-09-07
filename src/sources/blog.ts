import type { CompetitorConfig } from "../config.js";
import type { CandidateItem } from "../types.js";
import { normalizeUrl, titleFromUrl } from "../util/text.js";
import { matchesAnyPrefix, type SitemapEntry } from "./sitemap.js";

/** Sitemap paths that are listings or taxonomy pages rather than posts. */
const NON_ARTICLE_SEGMENTS = new Set(["page", "tag", "tags", "category", "categories", "author"]);

function isArticle(url: string, prefixes: string[]): boolean {
  if (!matchesAnyPrefix(url, prefixes)) return false;
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    // A bare prefix like /blog is the index, not a post.
    if (segments.length < 2) return false;
    return !segments.some((segment) => NON_ARTICLE_SEGMENTS.has(segment.toLowerCase()));
  } catch {
    return false;
  }
}

export interface BlogCandidateOptions {
  /** Ignore entries last modified before this. */
  since: Date;
  /** Cap on candidates handed to the deduplicator. */
  limit: number;
}

/**
 * Turn sitemap entries into blog candidates. `lastmod` is only a pre-filter to
 * keep the candidate list small: some sites bump it on every site-wide
 * re-render, so novelty is decided by URL dedupe against the `items` table.
 */
export function sitemapEntriesToItems(
  competitor: CompetitorConfig,
  entries: SitemapEntry[],
  options: BlogCandidateOptions,
): CandidateItem[] {
  return entries
    .filter((entry) => isArticle(entry.url, competitor.blogPathPrefixes))
    .filter((entry) => entry.lastModified !== null && entry.lastModified >= options.since)
    .sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0))
    .slice(0, options.limit)
    .map((entry) => {
      const url = normalizeUrl(entry.url);
      return {
        competitor: competitor.id,
        source: "blog" as const,
        externalId: url,
        title: titleFromUrl(url),
        url,
        publishedAt: entry.lastModified,
        raw: {
          discoveredVia: "sitemap",
          lastmod: entry.lastModified?.toISOString() ?? null,
        },
      };
    });
}
