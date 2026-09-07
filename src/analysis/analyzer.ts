import type { Analysis, PostHogClaim, StoredItem } from "../types.js";

export interface Analyzer {
  /** Recorded on the analysis row and shown in the Slack footer. */
  readonly model: string;
  analyze(item: StoredItem, claims: PostHogClaim[]): Promise<Analysis>;
}
