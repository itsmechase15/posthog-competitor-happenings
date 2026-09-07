export type CompetitorId = "mixpanel" | "amplitude";

export type SourceId = "changelog" | "blog" | "x" | "newsletter";

export const IMPACTS = ["minor", "notable", "major"] as const;
export type Impact = (typeof IMPACTS)[number];

/** Rows and model replies written on the low/medium/high scale are read as impact. */
export const LEGACY_IMPACTS = ["low", "medium", "high"] as const;
export type LegacyImpact = (typeof LEGACY_IMPACTS)[number];

export const IMPACT_FROM_LEGACY: Record<LegacyImpact, Impact> = {
  low: "minor",
  medium: "notable",
  high: "major",
};

/** Accepts either scale so a stored row never has to be migrated to be read. */
export function toImpact(token: Impact | LegacyImpact): Impact {
  return token in IMPACT_FROM_LEGACY ? IMPACT_FROM_LEGACY[token as LegacyImpact] : (token as Impact);
}

export const ACTIONS = [
  "update_pages",
  "new_compare_page",
  "consider_building",
  "consider_enhancing",
] as const;
export type Action = (typeof ACTIONS)[number];

/** A competitor signal before it has been written to the database. */
export interface CandidateItem {
  competitor: CompetitorId;
  source: SourceId;
  /** Stable per-source identity used for deduplication. */
  externalId: string;
  title: string;
  url: string;
  publishedAt: Date | null;
  /** Source payload kept verbatim so analysis can be re-run without re-fetching. */
  raw: Record<string, unknown>;
}

/** A candidate item after it has been persisted (or simulated) and given an id. */
export interface StoredItem extends CandidateItem {
  id: string;
}

export interface PostHogRef {
  url: string;
  claim: string;
  suggestedEdit?: string;
}

export interface Analysis {
  impact: Impact;
  /** One sentence. Slack shows it under "What you need to KNOW", so it carries the change. */
  summary: string;
  /** The elaboration, as short lines under "More detail". */
  keyPoints: string[];
  action: Action;
  /** Full reasoning. Slack shows its first sentence; the GitHub issue gets all of it. */
  actionDetail: string;
  posthogRefs: PostHogRef[];
  /** What we could not tell from the source, for whoever picks the issue up. */
  openQuestions: string[];
}

export interface AnalyzedItem {
  item: StoredItem;
  analysis: Analysis;
  model: string;
}

/** Where a feature image came from, in the order we try them. */
export const IMAGE_ORIGINS = ["feed", "page", "x", "screenshot", "generated"] as const;
export type ImageOrigin = (typeof IMAGE_ORIGINS)[number];

/** The picture at the top of every alert. Slack renders it from a public URL. */
export interface FeatureImage {
  url: string;
  altText: string;
  origin: ImageOrigin;
}

export interface IssueRef {
  url: string;
  number: number;
}

/** An analyzed item with everything Slack needs: a picture and an issue to link. */
export interface Alert extends AnalyzedItem {
  image: FeatureImage;
  issue: IssueRef | null;
  /** Why there is no issue link. Dry runs only — a real run either links or stays quiet. */
  issueNote?: string;
}

/** A PostHog.com page we have indexed. */
export interface PostHogPage {
  url: string;
  title: string;
  text: string;
  mentions: CompetitorId[];
  fetchedAt: Date;
}

/** A single competitor-mentioning paragraph lifted out of a PostHog page. */
export interface PostHogClaim {
  url: string;
  competitor: CompetitorId;
  paragraph: string;
  heading: string | null;
}
