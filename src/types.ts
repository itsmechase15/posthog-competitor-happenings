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
  "consider_publishing",
] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * The one action that is not about the competitor's product.
 *
 * The other four answer "what did they ship, and what should PostHog's product
 * or pages do about it". `consider_publishing` answers a different question,
 * asked after that one comes back **None**: the piece is thought leadership,
 * an explainer, or an event write-up, PostHog publishes nothing on the same
 * angle, and marketing might want to. So it sits next to the product verdict
 * rather than replacing it, and an alert can carry both.
 */
export function isContentAction(action: Pick<RecommendedAction, "type">): boolean {
  return action.type === "consider_publishing";
}

/** The actions about the product ship, which is what the product verdict is about. */
export function productActions<T extends Pick<RecommendedAction, "type">>(actions: T[]): T[] {
  return actions.filter((action) => !isContentAction(action));
}

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
  /**
   * The working title of the piece a `consider_publishing` action asks for.
   * Required with the draft: a headline is what a marketer decides on first.
   */
  articleTitle?: string;
  /**
   * The draft itself, in markdown, in PostHog's blog voice. Required for
   * `consider_publishing` and the reason the action exists: "consider
   * publishing something about X" is a job with the writing left in it, and
   * the analyst had PostHog's own blog posts open to match. Rendered into the
   * issue as a page somebody can read and as copy somebody can edit.
   */
  articleDraft?: string;
  /**
   * PostHog's own pieces nearest the draft's angle, as URLs: what the corpus
   * search for the headline found that the analysis had read and recommended
   * past. Named in the issue so whoever picks it up compares before writing.
   * Set by the evidence gate, never by the model.
   */
  similarPages?: string[];
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
  /** The copy on the page today, quoted. Checked against the stored page. */
  claim: string;
  /** What should change, in one line. An instruction, not the copy itself. */
  suggestedEdit?: string;
  /**
   * The words to put on the page, exactly as they should read there.
   *
   * Required on the page an `update_pages` action fixes, because "update the
   * pricing section to mention X" is a job someone still has to do the writing
   * for, and the analyst has the page open and we do not. See
   * `src/analysis/rewrite.ts` for what makes text a rewrite rather than an
   * instruction about one.
   */
  proposedText?: string;
}

/**
 * Why an alert recommends nothing.
 *
 * `already_covered` is PostHog shipping the thing, which is the answer a reader
 * most wants and the only one that has to carry docs pages. `not_a_gap` is a
 * launch that asks nothing of the product: pricing, company news, a capability
 * PostHog chose not to build. `unverified` is a gap claim that could not be
 * checked, which is not the same as no gap and says so. `dropped_on_review` is
 * the second model closing every issue the first one filed, and `unanalyzed`
 * is a run with no model behind it.
 */
export const NO_ACTION_KINDS = [
  "already_covered",
  "not_a_gap",
  "unverified",
  "dropped_on_review",
  "unanalyzed",
] as const;
export type NoActionKind = (typeof NO_ACTION_KINDS)[number];

/** A page the verdict rests on, so a reader can go and read it. */
export interface NoActionEvidence {
  url: string;
  /** The page's own title, which is what a link is labelled with. */
  title?: string;
  /** Words from the page, checked against the stored copy like any other quote. */
  quote?: string;
}

/**
 * Zero actions as an answer rather than a blank.
 *
 * The kind picks the title, the reason is the sentence under it, and the
 * evidence is the pages under that. A reason that names nothing concrete is
 * the failure this replaces, so `already_covered` is only allowed to say
 * PostHog ships something when it can name the page that says so.
 */
export interface NoAction {
  kind: NoActionKind;
  /** One sentence: what the launch does, and what PostHog ships or why it does not matter. */
  reason: string;
  /**
   * The pages the verdict rests on, docs unless the answer is a page PostHog
   * publishes. Non-empty for `already_covered`, which is downgraded without
   * them rather than published as a claim nobody can check.
   */
  evidence: NoActionEvidence[];
  /**
   * The answer to the second question, asked once the product answer is None:
   * does this piece change anything about PostHog's marketing content? Set
   * when it is answered without an action – PostHog already publishes a
   * similar piece, or there is nothing here worth one. When the answer is a
   * new piece, the `consider_publishing` action carries it instead.
   */
  marketing?: MarketingNote;
}

/**
 * One line about PostHog's own content, and the pages it points at. The pages
 * are marketing pages by definition – a blog post, a tutorial, a newsletter
 * issue – so they are checked for being in the corpus and nothing else.
 */
export interface MarketingNote {
  note: string;
  pages: NoActionEvidence[];
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
  /**
   * The product verdict when there is no product action: why the ship asks
   * nothing of PostHog's product or pages, in full. Set whenever `actions`
   * holds no product action, which includes an alert whose only action is
   * `consider_publishing` – that one is about PostHog's content, and the
   * product answer still has to be given next to it.
   */
  noAction?: NoAction;
  /**
   * The same verdict as one string. Written alongside `noAction` so a row
   * stored before the verdict had a shape still reads, and never the thing a
   * surface renders: the title and the links come off `noAction`.
   */
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

/**
 * One page edit as a marketer should see it: which page, the copy on it
 * today, the copy to put there, and where the two screenshots of it go.
 *
 * The line to change is read off the stored corpus page, because the corpus
 * copy is the one the evidence gate matched the claim against. The pictures
 * are of the live page. See `src/media/pageEdit.ts`.
 */
export interface PageEditPlan {
  url: string;
  /** The page's own title, which is how a marketer knows which page this is. */
  pageTitle: string;
  /** Where on posthog.com the copy sits, e.g. `/compare/mixpanel`. */
  path: string;
  /** What the edit does, in one line. */
  summary: string;
  /** Whether the quoted line is being replaced, or kept with copy added after it. */
  mode: "replace" | "insert";
  /** The copy on the page today, as the stored page reads it. */
  oldLine: string;
  /** The copy to put there, one entry per paragraph. */
  newLines: string[];
  /** The rewrite whole and uncut, which is what somebody pastes. */
  proposedText: string;
  /** A `diff` block body, `-`/`+` for a replace and context/`+` for an insert. */
  diff: string;
  /** Opens the live page scrolled to today's line. Null when the line is too short to match. */
  highlightUrl: string | null;
  beforeAlt: string;
  afterAlt: string;
  /** Where the two PNGs go, relative to the repo root. */
  beforePath: string;
  afterPath: string;
  /** The day the pair is taken on, which is the day the before shot is true for. */
  capturedOn: string;
  /**
   * Whether the stored copy of the page still has the quoted line on it. It is
   * what makes a line the live page does not have worth saying out loud: the
   * page has moved on since the corpus read it, and the recommendation may
   * have moved with it.
   */
  quotedOnStoredPage: boolean;
}

/** A before/after pair an issue body can embed, once something has committed the PNGs. */
export interface PageShots {
  /** Where the reader's browser fetches each image from. See `src/github/files.ts`. */
  beforeUrl: string;
  afterUrl: string;
  beforeAlt: string;
  afterAlt: string;
}

/**
 * A page edit with whatever the camera came back with.
 *
 * `shots` is null whenever the pair could not be taken or committed, and an
 * issue with a null there is opened with its text layers alone. The pictures
 * are the point and they are never the only copy of the edit: an edit that
 * lost them still carries the diff and the copy to paste.
 *
 * `copyMissingLive` is the one absence worth a line in the issue rather than
 * only in the log: the quoted line is on the stored page and is not on the
 * live one, so the page has moved on since the corpus read it.
 */
export interface PageEditVisual extends PageEditPlan {
  shots: PageShots | null;
  copyMissingLive: boolean;
}

/**
 * A `consider_publishing` draft rendered as a page and photographed, so a
 * marketer reading the issue sees the piece rather than a fence of markdown.
 *
 * The picture is of the draft laid out as a post, and it says so: there is no
 * posthog.com page to photograph for an article nobody has written. `shots`
 * is empty when nothing could be rendered or committed, and the issue carries
 * the draft in text either way.
 */
export interface ArticleDraftVisual {
  title: string;
  wordCount: number;
  capturedOn: string;
  /** In reading order, top of the page first. */
  shots: DraftShot[];
}

export interface DraftShot {
  url: string;
  alt: string;
  /** Where the PNG went in the repo, relative to its root. */
  path: string;
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
