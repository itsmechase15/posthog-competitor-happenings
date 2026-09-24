import type {
  ActionIssue,
  Analysis,
  CandidateItem,
  CompetitorId,
  DiscoverySource,
  FeatureImage,
  PageKind,
  PageMeta,
  PostHogClaim,
  PostHogPage,
  SourceId,
  StoredItem,
} from "../types.js";

/** One URL and the discovery sources that offered it on this run. */
export interface DiscoveryRecord {
  url: string;
  sources: DiscoverySource[];
}

/**
 * What one corpus refresh learned about URLs it did not re-download.
 *
 * Kept apart from `savePage` because most of a run's bookkeeping is about
 * pages nothing happened to: they were still listed, or they were not, and two
 * runs of not being listed is what retires a page.
 */
export interface CorpusBookkeeping {
  /** Offered by at least one source: the missing streak resets. */
  seen: DiscoveryRecord[];
  /** Offered by no source: the missing streak goes up by one. */
  missing: string[];
  /** Gone for good – missing twice over, or answering 404 or 410. */
  retired: string[];
  /** Reached an analyst this run, so it belongs in the short refresh tier. */
  used: string[];
  at: Date;
}

export interface RecordAnalysisInput {
  itemId: string;
  analysis: Analysis;
  model: string;
  /** Stored with the analysis so a retry re-posts the same picture. */
  image: FeatureImage | null;
  /** One per action, stored so a retry links those issues instead of opening more. */
  issues: ActionIssue[];
}

export interface PendingPost {
  analysisId: string;
  item: StoredItem;
  analysis: Analysis;
  model: string;
  /** Null for analyses written before alerts carried an image. */
  image: FeatureImage | null;
  /** One per action. A row from before the split puts its one issue on the first action. */
  issues: ActionIssue[];
}

/**
 * Everything the pipeline needs from persistence. Backed by Postgres in
 * production and by an in-memory implementation for dry runs, so a dry run
 * works with no `DATABASE_URL` at all.
 */
export interface Store {
  /**
   * Insert items, skipping ones already stored under the same
   * (competitor, source, external_id). Returns only the rows that were new.
   */
  insertNewItems(items: CandidateItem[]): Promise<StoredItem[]>;

  /**
   * The id an item is already stored under, or null. Single-item mode uses it
   * to re-post something the deduplicator has seen before.
   */
  findItemId(item: CandidateItem): Promise<string | null>;

  /**
   * Which of these items are already stored, as `competitor|source|externalId`
   * keys. Lets a dry run answer "what is new?" without writing anything.
   */
  findKnownKeys(items: CandidateItem[]): Promise<Set<string>>;

  /** How many items already exist for a competitor+source pair. */
  countItems(competitor: CompetitorId, source: SourceId): Promise<number>;

  recordAnalysis(input: RecordAnalysisInput): Promise<string>;

  markSlackPosted(analysisId: string, postedAt: Date): Promise<void>;

  /**
   * Analyses that were recorded but never made it to Slack. An item is only
   * deduped once, so without this a transient Slack failure would lose the
   * message permanently.
   */
  getUnpostedAnalyses(since: Date, limit: number): Promise<PendingPost[]>;

  /**
   * Whether the channel has already been told that nothing shipped on this
   * day, which is a calendar day in the zone the cron is set in.
   *
   * The empty-day line is the one thing a run posts that has no item under it,
   * so it is the one thing item dedupe cannot keep to once. Two scheduled runs
   * landing on the same morning is normal – the workflow schedules both DST
   * offsets and only turns away a run that is too early – and the second of
   * them has to stay quiet about the quiet day.
   */
  quietDayNoteSent(day: string): Promise<boolean>;

  /** Record that the day's empty-day line went out. Writing it twice is a no-op. */
  recordQuietDayNote(day: string, at: Date): Promise<void>;

  /**
   * Every corpus row without its body, retired ones included. This is what the
   * refresh plans against: which URLs are known, what they last hashed to,
   * what the server called them, when each was read, and which are on their
   * way out.
   */
  listPageMeta(): Promise<PageMeta[]>;

  /**
   * The live corpus with bodies, which is what retrieval searches and what the
   * workspace on disk is written from. Retired pages are left out.
   */
  loadCorpus(kinds?: PageKind[]): Promise<PostHogPage[]>;

  /**
   * Indexed pages for these exact URLs, in whatever order they come back.
   * Analysis uses it to read the canonical product docs without re-fetching.
   */
  getPages(urls: string[]): Promise<PostHogPage[]>;

  /** Write a page and everything known about it. Un-retires a page that is back. */
  savePage(page: PostHogPage): Promise<void>;

  /**
   * Record that a page was checked and had not moved, without touching its
   * body. This is what a 304 leaves behind: no download happened, so the only
   * new fact is that the copy we hold was current at this moment.
   */
  touchPage(url: string, at: Date): Promise<void>;

  /** Freshness bookkeeping for the pages this run did not re-download. */
  recordCorpusRun(update: CorpusBookkeeping): Promise<void>;

  replaceClaimsForUrl(url: string, claims: PostHogClaim[]): Promise<void>;

  /** Claims for a competitor, most useful pages first, capped at `limit`. */
  getClaims(competitor: CompetitorId, limit: number): Promise<PostHogClaim[]>;

  close(): Promise<void>;
}

export function itemKey(item: Pick<CandidateItem, "competitor" | "source" | "externalId">): string {
  return `${item.competitor}|${item.source}|${item.externalId}`;
}
