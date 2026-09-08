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

/**
 * One thing PostHog should do about a competitor signal. An alert often needs
 * more than one: a stale compare page to fix and a feature to close a gap in.
 */
export interface RecommendedAction {
  type: Action;
  /** Full reasoning. Slack shows its first sentence; the GitHub issue gets all of it. */
  detail: string;
  /**
   * The PostHog feature the action is about, e.g. "Experiments". Required for
   * consider_enhancing, where the label on its own names nothing to enhance.
   */
  feature?: string;
}

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
  /** At least one, in the order they should be read. */
  actions: RecommendedAction[];
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

/** Who picks the work up. Marketing owns the pages, product owns the roadmap. */
export const ACTION_OWNERS = ["marketing", "product"] as const;
export type ActionOwner = (typeof ACTION_OWNERS)[number];

/**
 * One recommended action and the issue opened for it. Every action gets its
 * own issue, because a page fix and a feature gap land on different desks and
 * get closed on different days.
 */
export interface ActionIssue {
  action: RecommendedAction;
  /** Null when no issue could be opened, e.g. a dry run or a missing token. */
  issue: IssueRef | null;
}

/** An analyzed item with everything Slack needs: a picture and an issue per action. */
export interface Alert extends AnalyzedItem {
  image: FeatureImage;
  /** One entry per recommended action, in the order the actions are read. */
  issues: ActionIssue[];
  /** Why there are no issue links. Dry runs only — a real run either links or stays quiet. */
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

/**
 * A paragraph about PostHog lifted out of a competitor's own comparison page.
 * Where they say PostHog cannot do something PostHog does, PostHog's pages
 * have a claim to answer.
 */
export interface CompetitorClaim {
  url: string;
  competitor: CompetitorId;
  paragraph: string;
  heading: string | null;
}

/**
 * A PostHog docs page, cut down to what it says about one signal. This is the
 * evidence an action is checked against before it may claim PostHog cannot do
 * something.
 */
export interface PostHogDoc {
  url: string;
  title: string;
  excerpt: string;
}
