import { COMPETITORS, type Config } from "../config.js";
import { createLogger } from "../log.js";
import { actionLabel, actionOwner, IMPACT_LABEL } from "../labels.js";
import { findPostHogProduct, productForDocUrl, productsForAction } from "../posthog/products.js";
import { relatedTeams, relatedTeamsLabel } from "../teams.js";
import {
  IMPACTS,
  type AnalyzedItem,
  type FeatureImage,
  type Impact,
  type IssueRef,
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
 * the `team:` labels say who else the work touches, and the product label is
 * added whenever the action names one we recognize.
 */
export function buildIssueLabels(alert: AnalyzedItem, action: RecommendedAction): string[] {
  const { item, analysis } = alert;
  const product = action.feature ? findPostHogProduct(action.feature) : undefined;
  const productName = product?.label ?? action.feature;

  return [
    "competitor-happenings",
    item.competitor,
    `source:${item.source}`,
    `impact:${analysis.impact}`,
    `action:${labelSlug(action.type)}`,
    `owner:${actionOwner(action)}`,
    ...relatedTeams(action).map((team) => `team:${team}`),
    ...(productName ? [`product:${labelSlug(productName)}`] : []),
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
  return ref.url.includes("posthog.com/docs/");
}

/**
 * The refs that back one action.
 *
 * A page action is the page work, so it gets every cited page and the edits
 * suggested for them. A product action is a claim about what PostHog ships,
 * and only the docs support that: a compare-page paragraph and its suggested
 * edit are the marketing issue's job, and a docs page for some other product
 * named in the same alert belongs to that product's own issue.
 */
function supportingRefs(alert: AnalyzedItem, action: RecommendedAction): PostHogRef[] {
  const refs = alert.analysis.posthogRefs;
  if (isPageAction(action)) return refs;

  const wanted = new Set(productsForAction(action).map((product) => product.label));

  return refs.filter((ref) => {
    if (ref.suggestedEdit || !isDocsRef(ref)) return false;
    const product = productForDocUrl(ref.url);
    if (!product) return true;
    return wanted.size === 0 || wanted.has(product.label);
  });
}

/**
 * The cited pages. Marketing gets the pages to edit with the suggested edits,
 * because editing the page is the job; product gets the docs that speak to the
 * action it is being asked to take, and nothing else.
 */
function pagesSection(alert: AnalyzedItem, action: RecommendedAction): string {
  const heading = isPageAction(action)
    ? "## PostHog pages to update"
    : "## PostHog pages for context";
  const refs = supportingRefs(alert, action);

  if (refs.length === 0) {
    const empty = isPageAction(action)
      ? "No indexed PostHog.com page covers this yet, which is itself worth a look."
      : "No PostHog docs page in context speaks to this action, so nothing here has been checked against what PostHog ships.";
    return `${heading}\n_${empty}_`;
  }

  const pages = refs
    .map((ref) => {
      const lines = [`### ${ref.url}`, `- **Claim today:** ${ref.claim}`];
      if (ref.suggestedEdit && isPageAction(action)) {
        lines.push(`- **Suggested edit:** ${ref.suggestedEdit}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");

  return `${heading}\n${pages}`;
}

/**
 * The whole scale as a task list, so a reader who does not carry the three
 * levels in their head can see where this one sits. Slack keeps the single
 * label; an issue has the room.
 */
function impactScale(impact: Impact): string {
  return IMPACTS.map(
    (level) => `- [${level === impact ? "x" : " "}] ${IMPACT_LABEL[level]}`,
  ).join("\n");
}

function bullets(values: string[], empty: string): string {
  if (values.length === 0) return `_${empty}_`;
  return values.map((value) => `- ${value}`).join("\n");
}

/**
 * The long form of one recommended action. Everything Slack cannot carry –
 * the full detail, page citations, suggested edits, open questions – lives
 * here, scoped to the one job this issue is asking for.
 */
export function buildIssueBody(
  alert: AnalyzedItem,
  image: FeatureImage | null,
  action: RecommendedAction,
): string {
  const { item, analysis, model } = alert;
  const competitor = COMPETITORS[item.competitor];
  const published = item.publishedAt?.toISOString().slice(0, 10) ?? "unknown";

  const sections = [
    `**${competitor.label}** · ${item.source} · published ${published} · impact **${IMPACT_LABEL[analysis.impact]}** · owned by **${actionOwner(action)}**`,
    image ? `<img src="${image.url}" alt="${image.altText}" width="720" />` : null,
    `## Recommended action\n**${actionLabel(action)}**${SPACED_EN_DASH}${action.detail}`,
    `## Related team(s)\n${relatedTeamsLabel(action)}`,
    `## What you need to know\n${analysis.summary}`,
    `## Impact\n${impactScale(analysis.impact)}`,
    `## More detail\n${bullets(analysis.keyPoints, "The source gave nothing beyond the summary above.")}`,
    pagesSection(alert, action),
    `## Open questions\n${bullets(analysis.openQuestions, "None raised.")}`,
    `## Sources\n- [${competitor.label} ${item.source}](${item.url})${
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
): IssueDraft {
  return {
    title: buildIssueTitle(alert, action),
    body: buildIssueBody(alert, image, action),
    labels: buildIssueLabels(alert, action),
  };
}

/**
 * One draft per recommended action. An alert that says "enhance Experiments,
 * enhance feature flags, and fix the compare page" is three issues, so nobody
 * has to read someone else's work to find their own.
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${GITHUB_API_BASE}/repos/${this.repo}/issues`, {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
          "x-github-api-version": "2022-11-28",
        },
        body: JSON.stringify({ title: draft.title, body: draft.body, labels }),
        signal: controller.signal,
      });

      const body = (await response.json().catch(() => ({}))) as IssueResponse;
      if (!response.ok) {
        throw new Error(
          `POST /issues returned ${response.status}: ${body.message ?? "no detail"}`,
        );
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
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
