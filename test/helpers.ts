import { buildCorpusIndex, type CorpusIndex } from "../src/posthog/retrieval.js";
import type { PageKind, PostHogPage } from "../src/types.js";

export interface PageFixture {
  url: string;
  title?: string;
  text: string;
  kind?: PageKind;
  fetchedAt?: Date;
  changedAt?: Date;
  lastUsedAt?: Date | null;
  contentHash?: string;
  etag?: string | null;
  missingStreak?: number;
  retiredAt?: Date | null;
}

/**
 * A corpus row with everything the bookkeeping columns need, so a test can say
 * only the part it cares about.
 */
export function page(fixture: PageFixture): PostHogPage {
  const fetchedAt = fixture.fetchedAt ?? new Date("2026-01-01T00:00:00Z");
  return {
    url: fixture.url,
    title: fixture.title ?? "",
    text: fixture.text,
    mentions: [],
    kind: fixture.kind ?? "docs",
    contentHash: fixture.contentHash ?? "hash",
    fetchedAt,
    changedAt: fixture.changedAt ?? fetchedAt,
    discoveredFrom: ["sitemap"],
    etag: fixture.etag ?? null,
    lastModified: null,
    missingStreak: fixture.missingStreak ?? 0,
    lastUsedAt: fixture.lastUsedAt ?? null,
    retiredAt: fixture.retiredAt ?? null,
  };
}

export function corpus(...fixtures: PageFixture[]): CorpusIndex {
  return buildCorpusIndex(fixtures.map(page));
}

/** The empty corpus, for the paths that have to survive one. */
export const EMPTY_CORPUS: CorpusIndex = buildCorpusIndex([]);
