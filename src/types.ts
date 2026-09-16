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
  /**
   * The PostHog small teams the model thinks are most involved, by name. Read
   * as a suggestion only: every name is looked up in the catalog before
   * anything renders it, so a team that is not on posthog.com/teams is
   * dropped. See `src/teams.ts`.
   */
  teams?: string[];
  /**
   * What PostHog does not do today, in one line. Required for the two product
   * actions: an enhancement with no gap named is a suggestion nobody can check.
   */
  gap?: string;
  /** The corpus page the gap was read off. Checked against the stored corpus. */
  evidenceUrl?: string;
  /** Words quoted from `evidenceUrl`. Checked against the stored page body. */
  evidenceQuote?: string;
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
  /**
   * Zero to three, in the order they should be read. Empty is a normal answer,
   * not a failure: plenty of launches are worth knowing about and ask nothing
   * of PostHog, and an action that cannot survive the evidence checks is
   * dropped rather than filed.
   */
  actions: RecommendedAction[];
  /** Why there is nothing to do. Set whenever `actions` is empty. */
  noActionReason?: string;
  posthogRefs: PostHogRef[];
  /** What we could not tell from the source, for whoever picks the issue up. */
  openQuestions: string[];
  /**
   * Corpus pages the analyst actually read, as URLs. Recorded from its own
   * tool calls, so the coverage gate can tell a checked claim from a guess.
   */
  pagesRead?: string[];
}

export interface AnalyzedItem {
  item: StoredItem;
  analysis: Analysis;
  model: string;
  /**
   * The docs pages this verdict was checked against. Carried so an issue can
   * name the pages that stop being true if the recommendation ships, without
   * looking anything up a second time. Absent on an analysis replayed from the
   * database, which is past the point where issues are opened.
   */
  docs?: PostHogDoc[];
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
  /** Absent until a reviewer has been past this action. Set once, never twice. */
  review?: ActionReview;
}

/**
 * What a reviewer can say about one filed action. `agree` files it as written,
 * `revise` sends it to be rewritten once, `drop` closes the issue.
 */
export const REVIEW_VERDICTS = ["agree", "revise", "drop"] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

/**
 * The review one action got, stored on the analysis row.
 *
 * This is what makes the loop run once. A retry that finds a review here does
 * not review again, whatever the issue's labels say, so a Slack failure cannot
 * turn into a second reviewer run and a second rewrite of the same issue.
 */
export interface ActionReview {
  verdict: ReviewVerdict;
  /** The reviewer's model id, which is not the analyst's. */
  model: string;
  at: Date;
  /** Why, in the reviewer's own words. The issue comment carries the same line. */
  reason: string;
  /**
   * Whether a `revise` verdict reached the issue. False when the rewrite could
   * not survive the evidence checks, which leaves the original filed.
   */
  applied?: boolean;
}

/** An analyzed item with everything Slack needs: a picture and an issue per action. */
export interface Alert extends AnalyzedItem {
  image: FeatureImage;
  /** One entry per recommended action, in the order the actions are read. */
  issues: ActionIssue[];
  /** Why there are no issue links. Dry runs only — a real run either links or stays quiet. */
  issueNote?: string;
}

/**
 * What a corpus page is for.
 *
 * `docs` is what PostHog ships, and the only evidence a gap claim may rest on.
 * `marketing` is copy: the compare pages, the product pages, pricing, the blog,
 * which are the only pages an action may ask anyone to edit. `changelog` is
 * PostHog's own changelog, which is evidence that something shipped and no
 * evidence at all that it is documented.
 */
export const PAGE_KINDS = ["docs", "marketing", "changelog"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

/**
 * Where a corpus URL came from. A URL that no source offers any more is on its
 * way out, so the union is kept per page rather than collapsed to a boolean.
 *
 * `catalog` pins the overview pages `products.ts` routes to, so the products
 * this bot reasons about cannot fall out of the corpus. Everything else is
 * discovered: `sitemap` is PostHog's own list, `llms` is one input and never
 * the whole truth, and `crawl` is the links found on pages already fetched.
 */
export const DISCOVERY_SOURCES = ["sitemap", "llms", "crawl", "catalog", "changelog"] as const;
export type DiscoverySource = (typeof DISCOVERY_SOURCES)[number];

/**
 * A PostHog.com page as the `pages` table holds it, which is this bot's source
 * of truth for what PostHog documents.
 *
 * `contentHash` is what freshness is decided on: a re-download whose hash
 * matches leaves `changedAt` alone, so "we looked" and "it moved" stay
 * separate facts. `etag` and `lastModified` are what the server said about the
 * copy we hold, so most re-reads cost a 304 and no body at all. `lastUsedAt`
 * is the last time the page reached an analyst, which is what puts it in the
 * every-few-days tier instead of the every-fortnight one.
 */
export interface PostHogPage {
  url: string;
  title: string;
  text: string;
  mentions: CompetitorId[];
  fetchedAt: Date;
  kind: PageKind;
  contentHash: string;
  changedAt: Date;
  discoveredFrom: DiscoverySource[];
  etag: string | null;
  lastModified: string | null;
  /** Consecutive runs this URL was offered by no discovery source. Two retires it. */
  missingStreak: number;
  lastUsedAt: Date | null;
  /** Set once the page is gone: retired pages stay on the row and leave the corpus. */
  retiredAt: Date | null;
}

/** A corpus row without its body, for deciding what to re-fetch. */
export type PageMeta = Omit<PostHogPage, "text" | "mentions">;

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
 * A corpus page, cut down to what it says about one signal. This is the
 * evidence an action is checked against before it may claim PostHog cannot do
 * something.
 */
export interface PostHogDoc {
  url: string;
  title: string;
  excerpt: string;
  /**
   * What the page is evidence of. Absent on an excerpt assembled before the
   * corpus knew: read as product documentation, which is the common case.
   */
  kind?: PageKind;
}
