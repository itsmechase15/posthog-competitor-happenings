import { asQuestions } from "../analysis/questions.js";
import { relevantDocs } from "../analysis/verify.js";
import { COMPETITORS, type Config } from "../config.js";
import { createLogger } from "../log.js";
import { actionLabel, actionOwner, IMPACT_LABEL, IMPACT_MEANING, SOURCE_LABEL } from "../labels.js";
import { isDocsUrl, isMarketingTarget } from "../posthog/pages.js";
import { findProductByName, productForDocUrl, productsForAction } from "../posthog/products.js";
import { entryUrl } from "../sources/link.js";
import { relatedTeams, relatedTeamsLabel } from "../teams.js";
import {
  IMPACTS,
  isContentAction,
  type AnalyzedItem,
  type ArticleDraftVisual,
  type FeatureImage,
  type Impact,
  type IssueRef,
  type PageEditVisual,
  type PostHogRef,
  type RecommendedAction,
} from "../types.js";
import { SPACED_EN_DASH, truncate } from "../util/text.js";

const log = createLogger("github");

export const GITHUB_API_BASE = "https://api.github.com";

/** GitHub rejects titles far longer than this, and nobody reads them anyway. */
const MAX_TITLE_CHARS = 120;

export interface IssueDraft {
  title: string;
  body: string;
  labels: string[];
}

/**
 * What a review verdict changes on an issue that already exists.
 *
 * `labels` replaces the whole set rather than adding to it, which is what
 * GitHub's PATCH does. That is why the labels an issue was opened with are
 * carried alongside it: a verdict adds its own label to that list and sends
 * the result, so one request records the whole outcome.
 */
export interface IssuePatch {
  title?: string;
  body?: string;
  labels?: string[];
  state?: "open" | "closed";
  stateReason?: "completed" | "not_planned" | "reopened";
}

/** One action's issue, kept next to the action so the caller can pair them up. */
export interface ActionIssueDraft {
  action: RecommendedAction;
  draft: IssueDraft;
}

interface IssueResponse {
  number?: number;
  html_url?: string;
  message?: string;
}

/** A label GitHub accepts: lowercase, no spaces, no punctuation to escape. */
function labelSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Marketing owns page work, so the page actions are the ones that route there. */
function isPageAction(action: RecommendedAction): boolean {
  return action.type === "update_pages" || action.type === "new_compare_page";
}

/**
 * Labels for one action's issue. Beyond the alert's own labels, the action
 * type and the owner are what a marketing or product filter actually queries,
 * the `team:` labels name the small teams the work is for by their /teams
 * slug, and the product label is added whenever the action names one we
 * recognize.
 */
export function buildIssueLabels(alert: AnalyzedItem, action: RecommendedAction): string[] {
  const { item, analysis } = alert;
  // Only a feature the catalog recognizes earns a label. A model's own phrasing
  // for something we hold no docs for would mint a label nobody ever queries
  // again, and a repo full of one-off labels is worse than none.
  const product = action.feature ? findProductByName(action.feature) : undefined;

  return [
    "competitor-happenings",
    item.competitor,
    `source:${item.source}`,
    `impact:${analysis.impact}`,
    `action:${labelSlug(action.type)}`,
    `owner:${actionOwner(action)}`,
    ...relatedTeams(action).map((team) => `team:${team.slug}`),
    ...(product ? [`${product.kind}:${labelSlug(product.label)}`] : []),
  ];
}

/**
 * Competitor and feature first, so issues from one launch sit together, then
 * the action, so a list of three issues reads as three different jobs.
 */
export function buildIssueTitle(alert: AnalyzedItem, action: RecommendedAction): string {
  const label = COMPETITORS[alert.item.competitor].label;
  const suffix = `${SPACED_EN_DASH}${actionLabel(action)}`;
  const head = `${label}: ${alert.item.title}`;
  return `${truncate(head, Math.max(24, MAX_TITLE_CHARS - suffix.length))}${suffix}`;
}

/** A docs page says what PostHog ships; everything else on posthog.com is copy. */
function isDocsRef(ref: PostHogRef): boolean {
  return isDocsUrl(ref.url);
}

/**
 * The refs that back one action.
 *
 * A page action is the page work, so it gets every page someone could edit,
 * with the edits suggested for them: the docs are evidence, never a target, so
 * they are left off the list of pages to change. A product action is a claim
 * about what PostHog ships, and only the docs support that: a compare-page
 * paragraph and its suggested edit are the marketing issue's job, and a docs
 * page for some other product named in the same alert belongs to that
 * product's own issue.
 */
function supportingRefs(alert: AnalyzedItem, action: RecommendedAction): PostHogRef[] {
  const refs = alert.analysis.posthogRefs;
  if (isPageAction(action)) return refs.filter((ref) => isMarketingTarget(ref.url));

  const wanted = new Set(productsForAction(action).map((product) => product.label));

  return refs.filter((ref) => {
    if (ref.suggestedEdit || !isDocsRef(ref)) return false;
    const product = productForDocUrl(ref.url);
    if (!product) return true;
    return wanted.size === 0 || wanted.has(product.label);
  });
}

/** Multi-line copy as a blockquote, so a paragraph survives with its breaks. */
function quoteBlock(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line.trim()}`)
    .join("\n>\n");
}

/**
 * One page to edit: what it says now, and the words to put there instead.
 *
 * The rewrite is the point of the section for an `update_pages` issue. Whoever
 * opens one should be able to read the two blocks, agree or disagree, and
 * paste – so the proposed copy is quoted whole rather than summarized, and the
 * one-line suggested edit sits under it as the reason rather than above it as
 * the ask. A ref with no rewrite on it keeps the old shape: it is either a
 * second page the action mentioned in passing, or a `new_compare_page`, which
 * has no current copy to replace.
 */
function pageToEdit(ref: PostHogRef): string {
  if (!ref.proposedText) {
    const lines = [`### ${ref.url}`, `- **Claim today:** ${ref.claim}`];
    if (ref.suggestedEdit) lines.push(`- **Suggested edit:** ${ref.suggestedEdit}`);
    return lines.join("\n");
  }

  const lines = [
    `### ${ref.url}`,
    "",
    "**On the page today**",
    quoteBlock(ref.claim),
    "",
    "**Replace it with**",
    quoteBlock(ref.proposedText),
  ];
  if (ref.suggestedEdit) lines.push("", `**Why**${SPACED_EN_DASH}${ref.suggestedEdit}`);
  return lines.join("\n");
}

/**
 * A fence long enough to hold `text`, so copy with backticks in it still comes
 * out as one block somebody can select and paste.
 */
function fence(text: string): string {
  const longest = [...text.matchAll(/`+/g)].reduce((max, run) => Math.max(max, run[0].length), 0);
  return "`".repeat(Math.max(3, longest + 1));
}

/**
 * The two screenshots of the page, stacked and captioned.
 *
 * Stacked rather than side by side: an issue column is about 830 pixels wide,
 * so two pictures of a 1280-wide page next to each other are unreadable, and
 * being readable is the whole point of them.
 *
 * The after shot is of a page with words on it that nobody has published, so
 * its caption says exactly that. Somebody scrolling an issue about a
 * posthog.com page must not come away thinking the edit is live. It also says
 * where to look: the proposed copy is the highlighted run, and saying so is
 * cheaper than making a reader compare two pages of prose.
 */
function beforeAndAfter(visual: PageEditVisual): string[] {
  if (!visual.shots) {
    return visual.copyMissingLive
      ? [
          "",
          `_The quoted copy was not on the live page on ${visual.capturedOn}, so there is no before and after of it. The page may already have been changed${SPACED_EN_DASH}read it before you edit it._`,
        ]
      : [];
  }

  const { beforeUrl, afterUrl, beforeAlt, afterAlt } = visual.shots;
  return [
    "",
    `**Before**${SPACED_EN_DASH}the live page on ${visual.capturedOn}`,
    `![${beforeAlt}](${beforeUrl})`,
    "",
    `**After**${SPACED_EN_DASH}the same page with the proposed copy highlighted in yellow, staged in a browser only. Nothing was published.`,
    `![${afterAlt}](${afterUrl})`,
  ];
}

/**
 * One page edit, with the pictures of it.
 *
 * The order is the reading order: which page and where on it, what the edit
 * does, then the page photographed before and after, then the same edit as a
 * diff, then the copy to paste. Every layer under the pictures says the same
 * thing in text, which is what makes a missing pair survivable: an edit whose
 * PNGs could not be taken or committed opens the issue with the diff and the
 * copy, and nobody is left with a broken image and no idea what to type.
 *
 * The full replacement copy is never truncated. It is the deliverable.
 */
function pageEditSection(visual: PageEditVisual): string {
  const lines = [
    `### ${visual.pageTitle}${SPACED_EN_DASH}${visual.path}`,
    "",
    `**What this edit does**${SPACED_EN_DASH}${visual.summary}`,
    ...beforeAndAfter(visual),
  ];

  lines.push("", "```diff", visual.diff, "```");

  const wrap = fence(visual.proposedText);
  lines.push("", "**Paste this**", "", `${wrap}text`, visual.proposedText, wrap);

  lines.push(
    "",
    visual.highlightUrl
      ? `[Open ${visual.path} with today's line highlighted](${visual.highlightUrl})`
      : `[Open ${visual.path}](${visual.url})`,
  );

  return lines.join("\n");
}

/**
 * Why a product action cites no docs page, said plainly.
 *
 * An empty section here used to read as a failed check, which is the opposite
 * of what it usually means: PostHog has no page describing a capability
 * PostHog does not ship, so there was no page to quote. That is the gap, and
 * the issue names it two sections up.
 *
 * The confusion it caused was the next heading. "Docs that would change if
 * this ships" lists docs URLs right underneath, which reads as a contradiction
 * until you know one section is about today and the other is about afterwards.
 * So the empty state says which section is which, and only names a section the
 * issue actually has.
 */
function noDocsCited(action: RecommendedAction, hasGap: boolean, hasFutureDocs: boolean): string {
  const what = action.feature ? `this part of ${action.feature}` : "this capability";
  const opening =
    action.type === "consider_building"
      ? `No PostHog docs page describes ${what}, which is what you would expect for something PostHog does not ship: there is no page about it to quote here, and that absence is the gap rather than a check that failed.`
      : `No PostHog docs page describes ${what} yet, so there was no page about it to quote here. That absence is the gap rather than a check that failed.`;

  const pointers = [
    hasGap
      ? `The docs the gap itself was read off are under "The gap this closes".`
      : null,
    hasFutureDocs
      ? `The pages under "Docs that would change if this ships" are the ones somebody would rewrite after PostHog does this, not evidence for it.`
      : null,
  ].filter((line): line is string => line !== null);

  return [opening, ...pointers].join(" ");
}

/**
 * The cited pages. Marketing gets the pages to edit with the copy to put on
 * them, because editing the page is the job; product gets the docs that say
 * what PostHog ships today, and nothing else.
 */
function pagesSection(
  alert: AnalyzedItem,
  action: RecommendedAction,
  visuals: PageEditVisual[],
  futureDocs: string[] = [],
): string {
  const heading = isPageAction(action)
    ? "## PostHog pages to update"
    : "## What PostHog's docs say today";
  const refs = supportingRefs(alert, action);

  if (refs.length === 0) {
    const empty = isPageAction(action)
      ? "No indexed PostHog.com page covers this yet, which is itself worth a look."
      : noDocsCited(action, Boolean(action.gap), futureDocs.length > 0);
    return `${heading}\n_${empty}_`;
  }

  const pages = refs
    .map((ref) => {
      if (!isPageAction(action)) return `### ${ref.url}\n- **Claim today:** ${ref.claim}`;
      // A photographed edit is the richer version of the same section: it
      // names the page by its title, shows the page with the change on it, and
      // carries the copy. A ref with none – a page the corpus does not hold, a
      // `new_compare_page` with no current copy – keeps the quoted-copy shape.
      const visual = visuals.find((entry) => entry.url === ref.url);
      return visual ? pageEditSection(visual) : pageToEdit(ref);
    })
    .join("\n\n");

  const note =
    action.type === "update_pages" && refs.every((ref) => !ref.proposedText)
      ? "\n\n_No exact replacement copy came back for this edit, so the wording is still to write._"
      : "";

  return `${heading}\n${pages}${note}`;
}

/** Enough to name the pages, short enough that nobody scrolls past it. */
const MAX_DOCS_THAT_CHANGE = 6;

/**
 * The docs pages this recommendation was checked against, which are the pages
 * that stop being true the day it ships.
 *
 * Nothing new is looked up for this. These are the same pages the action was
 * verified against and cites, read a second way: as evidence they say what
 * PostHog does today, and as a list they say what someone has to rewrite when
 * PostHog does something else. Page actions have no use for it – editing a
 * page is already the job they describe.
 */
function docsThatWouldChange(alert: AnalyzedItem, action: RecommendedAction): string[] {
  if (isPageAction(action) || isContentAction(action)) return [];
  const verified = relevantDocs(action, alert.docs ?? []).map((doc) => doc.url);
  const cited = supportingRefs(alert, action)
    .filter(isDocsRef)
    .map((ref) => ref.url);
  return [...new Set([...verified, ...cited])].slice(0, MAX_DOCS_THAT_CHANGE);
}

function docsThatWouldChangeSection(urls: string[]): string | null {
  if (urls.length === 0) return null;
  return `## Docs that would change if this ships\n${urls.map((url) => `- ${url}`).join("\n")}`;
}

/**
 * The gap, and the page it was read off, quoted.
 *
 * This is what the issue is standing on, so it goes near the top: the reader's
 * first question about "PostHog should build X" is "are we sure we don't?",
 * and the answer is a line from PostHog's own docs with a link to the page it
 * is on. An action with no gap named is a page edit, which carries its
 * evidence further down as the copy to change.
 */
function evidenceSection(action: RecommendedAction): string | null {
  if (!action.gap) return null;

  const lines = [`## The gap this closes\n${action.gap}`];
  if (action.evidenceUrl) {
    const quote = action.evidenceQuote ? `\n> ${action.evidenceQuote.replace(/\n+/g, " ")}` : "";
    lines.push(`\nChecked against ${action.evidenceUrl}${quote}`);
  }
  return lines.join("\n");
}

/**
 * The whole scale as a task list, each level with what it means, so a reader
 * who does not carry the rule in their head can see where this one sits and
 * why. Slack keeps the single label; an issue has the room.
 */
function impactScale(impact: Impact): string {
  return IMPACTS.map(
    (level) =>
      `- [${level === impact ? "x" : " "}] ${IMPACT_LABEL[level]}${SPACED_EN_DASH}${IMPACT_MEANING[level]}`,
  ).join("\n");
}

function bullets(values: string[], empty: string): string {
  if (values.length === 0) return `_${empty}_`;
  return values.map((value) => `- ${value}`).join("\n");
}

/**
 * The draft, as a page and as copy.
 *
 * The pictures come first because they are what a marketer reads: the piece
 * on posthog.com, in the site's own layout, a screen at a time. The caption
 * says how the picture was made, because a reader seeing their own site with
 * a post on it nobody has written deserves to be told which of the two is
 * real: the layout is a live post's, staged in a browser tab with the draft in
 * place of its copy, and nothing was published. The markdown under them is
 * the deliverable: an editor pastes from it, and an issue whose pictures
 * failed still carries the whole piece.
 */
function draftSection(action: RecommendedAction, visual: ArticleDraftVisual | null): string | null {
  if (!isContentAction(action) || !action.articleDraft) return null;

  const title = action.articleTitle ?? visual?.title ?? "Untitled";
  const lines = [`## The draft`, "", `**Working title**${SPACED_EN_DASH}${title}`];
  if (visual) lines.push("", `About ${visual.wordCount} words.`);

  if (visual && visual.shots.length > 0) {
    const several = visual.shots.length > 1;
    const template = visual.stagedOn
      ? `the live post at ${visual.stagedOn}`
      : "a live posthog.com blog post";
    lines.push(
      "",
      `_The draft as it would read on posthog.com${several ? `, in ${visual.shots.length} parts from the top down` : ""}: ${template}, opened in a headless browser with its headline and copy swapped for the draft and stamped as one, then photographed and thrown away. Nothing was published._`,
    );
    for (const shot of visual.shots) lines.push("", `![${shot.alt}](${shot.url})`);
  }

  const wrap = fence(action.articleDraft);
  lines.push("", "**Copy this**", "", `${wrap}markdown`, action.articleDraft, wrap);
  return lines.join("\n");
}

/**
 * The long form of one recommended action. Everything Slack cannot carry –
 * the full detail, page citations, suggested edits, open questions – lives
 * here, scoped to the one job this issue is asking for.
 *
 * What the competitor shipped comes first and the ask comes after it, because
 * somebody who opens this cold needs the news before a job makes sense: the
 * summary, the detail behind it, how much it matters, then what PostHog
 * should do about it. Everything the ask stands on – the gap, the teams, the
 * docs, the open questions – follows the ask, in the order somebody checking
 * it asks for it.
 *
 * `visuals` are the photographed page edits for an `update_pages` action,
 * already taken and committed by the caller, because building this body is
 * synchronous and photographing a page is not. None is a normal answer: an
 * action of any other type has none, and an edit whose pictures failed still
 * arrives here carrying its diff and its copy. `draft` is the same thing for a
 * `consider_publishing` action: the piece laid out and photographed, or null.
 *
 * A publishing issue reads differently after the ask. It carries the draft
 * itself, and it skips the docs sections, which are about what the product
 * does today and what a product change would make stale.
 */
export function buildIssueBody(
  alert: AnalyzedItem,
  image: FeatureImage | null,
  action: RecommendedAction,
  visuals: PageEditVisual[] = [],
  draft: ArticleDraftVisual | null = null,
): string {
  const { item, analysis, model } = alert;
  const competitor = COMPETITORS[item.competitor];
  const published = item.publishedAt?.toISOString().slice(0, 10) ?? "unknown";
  const content = isContentAction(action);

  const futureDocs = docsThatWouldChange(alert, action);

  const sections = [
    `**${competitor.label}** · ${SOURCE_LABEL[item.source]} · published ${published} · impact **${IMPACT_LABEL[analysis.impact]}** · owned by **${actionOwner(action)}**`,
    image ? `<img src="${image.url}" alt="${image.altText}" width="720" />` : null,
    `## What you need to know\n${analysis.summary}`,
    `## More detail\n${bullets(analysis.keyPoints, "The source gave nothing beyond the summary above.")}`,
    `## Impact\n${impactScale(analysis.impact)}`,
    `## Recommended action\n**${actionLabel(action)}**${SPACED_EN_DASH}${action.detail}`,
    evidenceSection(action),
    draftSection(action, draft),
    `## Related team(s)\n${relatedTeamsLabel(action)}`,
    content
      ? null
      : pagesSection(alert, action, action.type === "update_pages" ? visuals : [], futureDocs),
    docsThatWouldChangeSection(futureDocs),
    // Normalized once more on the way out: a question is the one thing this
    // section is for, and an analysis stored before that was true still
    // renders here.
    `## Open questions\n${bullets(asQuestions(analysis.openQuestions), "None raised.")}`,
    `## Sources\n- [${competitor.label} ${SOURCE_LABEL[item.source]}](${entryUrl(item)})${
      image ? `\n- Feature image (${image.origin}): ${image.url}` : ""
    }`,
    `---\nOpened by posthog-competitor-happenings. Analyzed with \`${model}\`.`,
  ];

  return sections.filter((section): section is string => section !== null).join("\n\n");
}

export function buildIssueDraft(
  alert: AnalyzedItem,
  image: FeatureImage | null,
  action: RecommendedAction,
  visuals: PageEditVisual[] = [],
  draft: ArticleDraftVisual | null = null,
): IssueDraft {
  return {
    title: buildIssueTitle(alert, action),
    body: buildIssueBody(alert, image, action, visuals, draft),
    labels: buildIssueLabels(alert, action),
  };
}

/**
 * One draft per recommended action. An alert that says "enhance Experiments,
 * enhance feature flags, and fix the compare page" is three issues, so nobody
 * has to read someone else's work to find their own.
 *
 * No pictures: a pair needs a browser and an upload per page, so the pipeline
 * builds the drafts one action at a time with the shots for that action. This
 * is the shape for everything that only needs the text.
 */
export function buildIssueDrafts(
  alert: AnalyzedItem,
  image: FeatureImage | null,
): ActionIssueDraft[] {
  return alert.analysis.actions.map((action) => ({
    action,
    draft: buildIssueDraft(alert, image, action),
  }));
}

export interface IssueCreator {
  readonly description: string;
  /** Returns null when no issue could be opened; the caller keeps going regardless. */
  create(draft: IssueDraft): Promise<IssueRef | null>;
}

export interface GitHubRequest {
  method: "GET" | "POST" | "PATCH" | "PUT";
  path: string;
  token: string;
  timeoutMs: number;
  /** Omitted on a GET, which is the only method here that sends no body. */
  payload?: Record<string, unknown>;
}

/**
 * One call to the GitHub API. Throws with the status in the message, which is
 * what the label retry reads, and what tells the card uploader a file it tried
 * to write is already there.
 */
export async function githubRequest<T extends { message?: string } = IssueResponse>(
  request: GitHubRequest,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch(`${GITHUB_API_BASE}${request.path}`, {
      method: request.method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${request.token}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
      },
      ...(request.payload === undefined ? {} : { body: JSON.stringify(request.payload) }),
      signal: controller.signal,
    });

    const body = (await response.json().catch(() => ({}))) as T;
    if (!response.ok) {
      throw new Error(
        `${request.method} ${request.path} returned ${response.status}: ${body.message ?? "no detail"}`,
      );
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export class GitHubIssueCreator implements IssueCreator {
  readonly description: string;

  constructor(
    private readonly repo: string,
    private readonly token: string,
    private readonly timeoutMs: number,
  ) {
    this.description = `issues in ${repo}`;
  }

  private async post(draft: IssueDraft, labels: string[]): Promise<IssueResponse> {
    return githubRequest({
      method: "POST",
      path: `/repos/${this.repo}/issues`,
      token: this.token,
      timeoutMs: this.timeoutMs,
      payload: { title: draft.title, body: draft.body, labels },
    });
  }

  async create(draft: IssueDraft): Promise<IssueRef | null> {
    try {
      let body: IssueResponse;
      try {
        body = await this.post(draft, draft.labels);
      } catch (error) {
        // A label the repo has never seen is a 422. The issue itself matters
        // more than its labels, so try again without them.
        if (!(error instanceof Error) || !error.message.includes("422")) throw error;
        log.warn(`retrying without labels: ${error.message}`);
        body = await this.post(draft, []);
      }

      if (!body.html_url || body.number === undefined) {
        throw new Error("GitHub accepted the issue but returned no url");
      }
      log.info(`opened ${body.html_url}`);
      return { url: body.html_url, number: body.number };
    } catch (error) {
      log.error(
        `could not open an issue for "${draft.title}"`,
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }
}

/** Used when there is no token, or when a dry run must not write anything. */
export class DisabledIssueCreator implements IssueCreator {
  readonly description: string;

  constructor(readonly reason: string) {
    this.description = `skipped (${reason})`;
  }

  async create(draft: IssueDraft): Promise<IssueRef | null> {
    log.info(`[${this.reason}] would open an issue: ${draft.title}`);
    return null;
  }
}

export function createIssueCreator(config: Config): IssueCreator {
  if (config.dryRun) return new DisabledIssueCreator("dry run");
  if (!config.githubToken) return new DisabledIssueCreator("GITHUB_TOKEN is not set");
  return new GitHubIssueCreator(config.githubRepo, config.githubToken, config.httpTimeoutMs);
}

/**
 * Changing an issue that already exists, which is what a review verdict does.
 *
 * Every method takes an issue that may be null, because the pipeline reviews an
 * action whether or not an issue was opened for it: a dry run and a run with no
 * token both review and both have nothing to write to. That is deliberate – the
 * disabled editor says what it would have done, so a dry run shows the whole
 * verdict rather than the half of it that needs no credentials.
 *
 * Nothing here fails a run. An issue that cannot be edited is an issue that
 * still says what the analyst wrote, which is worse than the reviewed version
 * and better than a run that stopped.
 */
export interface IssueEditor {
  readonly description: string;
  /** Returns whether the edit landed. */
  update(issue: IssueRef | null, patch: IssuePatch): Promise<boolean>;
  comment(issue: IssueRef | null, body: string): Promise<boolean>;
  /**
   * Close it, with the labels the verdict leaves behind. One request, so an
   * issue is never briefly closed and unlabelled.
   */
  close(
    issue: IssueRef | null,
    reason: "completed" | "not_planned",
    labels?: string[],
  ): Promise<boolean>;
}

export class GitHubIssueEditor implements IssueEditor {
  readonly description: string;

  constructor(
    private readonly repo: string,
    private readonly token: string,
    private readonly timeoutMs: number,
  ) {
    this.description = `edits issues in ${repo}`;
  }

  async update(issue: IssueRef | null, patch: IssuePatch): Promise<boolean> {
    if (!issue) return false;
    const payload: Record<string, unknown> = {};
    if (patch.title !== undefined) payload.title = patch.title;
    if (patch.body !== undefined) payload.body = patch.body;
    if (patch.labels !== undefined) payload.labels = patch.labels;
    if (patch.state !== undefined) payload.state = patch.state;
    if (patch.stateReason !== undefined) payload.state_reason = patch.stateReason;

    // A label the repo has never seen is a 422, same as on create, and the rest
    // of the edit matters more than the label that came with it.
    const withoutLabels =
      payload.labels !== undefined && Object.keys(payload).length > 1
        ? Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "labels"))
        : undefined;

    return this.send(
      `/repos/${this.repo}/issues/${issue.number}`,
      "PATCH",
      payload,
      issue,
      withoutLabels,
    );
  }

  async comment(issue: IssueRef | null, body: string): Promise<boolean> {
    if (!issue) return false;
    return this.send(`/repos/${this.repo}/issues/${issue.number}/comments`, "POST", { body }, issue);
  }

  async close(
    issue: IssueRef | null,
    reason: "completed" | "not_planned",
    labels?: string[],
  ): Promise<boolean> {
    return this.update(issue, {
      state: "closed",
      stateReason: reason,
      ...(labels ? { labels } : {}),
    });
  }

  private async send(
    path: string,
    method: "POST" | "PATCH",
    payload: Record<string, unknown>,
    issue: IssueRef,
    withoutLabels?: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      try {
        await githubRequest({ method, path, token: this.token, timeoutMs: this.timeoutMs, payload });
      } catch (error) {
        const rejectedLabel =
          withoutLabels !== undefined && error instanceof Error && error.message.includes("422");
        if (!rejectedLabel) throw error;
        log.warn(`retrying without labels: ${(error as Error).message}`);
        await githubRequest({
          method,
          path,
          token: this.token,
          timeoutMs: this.timeoutMs,
          payload: withoutLabels,
        });
      }
      return true;
    } catch (error) {
      log.error(
        `could not edit ${issue.url}`,
        error instanceof Error ? error.message : error,
      );
      return false;
    }
  }
}

/** Used when there is no token, or when a dry run must not write anything. */
export class DisabledIssueEditor implements IssueEditor {
  readonly description: string;

  constructor(readonly reason: string) {
    this.description = `skipped (${reason})`;
  }

  async update(issue: IssueRef | null, patch: IssuePatch): Promise<boolean> {
    const changed = [
      patch.title ? "title" : null,
      patch.body ? "body" : null,
      patch.labels ? `labels ${patch.labels.join(", ")}` : null,
      patch.state ? `state ${patch.state}` : null,
      patch.stateReason ? `reason ${patch.stateReason}` : null,
    ].filter(Boolean);
    log.info(`[${this.reason}] would edit ${describeIssue(issue)}: ${changed.join(" · ")}`);
    return false;
  }

  async comment(issue: IssueRef | null, body: string): Promise<boolean> {
    log.info(`[${this.reason}] would comment on ${describeIssue(issue)}: ${firstLine(body)}`);
    return false;
  }

  async close(
    issue: IssueRef | null,
    reason: "completed" | "not_planned",
    labels?: string[],
  ): Promise<boolean> {
    return this.update(issue, {
      state: "closed",
      stateReason: reason,
      ...(labels ? { labels } : {}),
    });
  }
}

function describeIssue(issue: IssueRef | null): string {
  return issue ? `#${issue.number}` : "the issue it never opened";
}

function firstLine(body: string): string {
  return truncate(body.split("\n").find((line) => line.trim() !== "") ?? "", 160);
}

export function createIssueEditor(config: Config): IssueEditor {
  if (config.dryRun) return new DisabledIssueEditor("dry run");
  if (!config.githubToken) return new DisabledIssueEditor("GITHUB_TOKEN is not set");
  return new GitHubIssueEditor(config.githubRepo, config.githubToken, config.httpTimeoutMs);
}
