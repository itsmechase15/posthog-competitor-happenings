import type {
  Analysis,
  CandidateItem,
  CompetitorId,
  PostHogClaim,
  PostHogPage,
  SourceId,
  StoredItem,
} from "../types.js";

export interface RecordAnalysisInput {
  itemId: string;
  analysis: Analysis;
  model: string;
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
   * Which of these items are already stored, as `competitor|source|externalId`
   * keys. Lets a dry run answer "what is new?" without writing anything.
   */
  findKnownKeys(items: CandidateItem[]): Promise<Set<string>>;

  /** How many items already exist for a competitor+source pair. */
  countItems(competitor: CompetitorId, source: SourceId): Promise<number>;

  recordAnalysis(input: RecordAnalysisInput): Promise<string>;

  markSlackPosted(analysisId: string, postedAt: Date): Promise<void>;

  /** URLs already indexed, mapped to when they were last fetched. */
  getIndexedPageUrls(): Promise<Map<string, Date>>;

  upsertPage(page: PostHogPage): Promise<void>;

  replaceClaimsForUrl(url: string, claims: PostHogClaim[]): Promise<void>;

  /** Claims for a competitor, most useful pages first, capped at `limit`. */
  getClaims(competitor: CompetitorId, limit: number): Promise<PostHogClaim[]>;

  close(): Promise<void>;
}

export function itemKey(item: Pick<CandidateItem, "competitor" | "source" | "externalId">): string {
  return `${item.competitor}|${item.source}|${item.externalId}`;
}
