import type { Analysis, PostHogClaim, PostHogDoc, StoredItem } from "../types.js";

export interface Analyzer {
  /** Recorded on the analysis row and shown in the Slack footer. */
  readonly model: string;
  /**
   * `docs` is what PostHog ships in the area this signal touches. An action
   * that claims PostHog does or does not do something is answerable from it.
   */
  analyze(item: StoredItem, claims: PostHogClaim[], docs: PostHogDoc[]): Promise<Analysis>;
}
