import type {
  Analysis,
  CompetitorClaim,
  PostHogClaim,
  PostHogDoc,
  StoredItem,
} from "../types.js";

export interface Analyzer {
  /** Recorded on the analysis row and shown in the Slack footer. */
  readonly model: string;
  /**
   * `claims` is PostHog's copy about the competitor, `docs` is what PostHog
   * ships, and `compareClaims` is what the competitor says about PostHog.
   */
  analyze(
    item: StoredItem,
    claims: PostHogClaim[],
    docs: PostHogDoc[],
    compareClaims: CompetitorClaim[],
  ): Promise<Analysis>;
}
