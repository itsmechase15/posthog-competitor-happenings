import { COMPETITORS, type Config } from "../config.js";
import { createLogger } from "../log.js";
import { ACTION_LABEL, IMPACT_LABEL } from "../labels.js";
import type { AnalyzedItem, FeatureImage, IssueRef } from "../types.js";
import { truncate } from "../util/text.js";

const log = createLogger("github");

export const GITHUB_API_BASE = "https://api.github.com";

/** GitHub rejects titles far longer than this, and nobody reads them anyway. */
const MAX_TITLE_CHARS = 120;

export interface IssueDraft {
  title: string;
  body: string;
  labels: string[];
}

interface IssueResponse {
  number?: number;
  html_url?: string;
  message?: string;
}

function slug(value: string): string {
  return value.replace(/_/g, "-");
}

export function buildIssueLabels(alert: AnalyzedItem): string[] {
  const { item, analysis } = alert;
  return [
    "competitor-happenings",
    item.competitor,
    `source:${item.source}`,
    `impact:${analysis.impact}`,
    `action:${slug(analysis.action)}`,
  ];
}

export function buildIssueTitle(alert: AnalyzedItem): string {
  const label = COMPETITORS[alert.item.competitor].label;
  return truncate(`${label}: ${alert.item.title}`, MAX_TITLE_CHARS);
}

function pagesSection(alert: AnalyzedItem): string {
  if (alert.analysis.posthogRefs.length === 0) {
    return "_No indexed PostHog.com page covers this yet, which is itself worth a look._";
  }
  return alert.analysis.posthogRefs
    .map((ref) => {
      const lines = [`### ${ref.url}`, `- **Claim today:** ${ref.claim}`];
      if (ref.suggestedEdit) lines.push(`- **Suggested edit:** ${ref.suggestedEdit}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

function bullets(values: string[], empty: string): string {
  if (values.length === 0) return `_${empty}_`;
  return values.map((value) => `- ${value}`).join("\n");
}

/**
 * The long form of an alert. Everything Slack used to carry — page citations,
 * suggested edits, open questions — lives here now, so Slack can stay short.
 */
export function buildIssueBody(alert: AnalyzedItem, image: FeatureImage | null): string {
  const { item, analysis, model } = alert;
  const competitor = COMPETITORS[item.competitor];
  const published = item.publishedAt?.toISOString().slice(0, 10) ?? "unknown";

  const sections = [
    `**${competitor.label}** · ${item.source} · published ${published} · impact **${IMPACT_LABEL[analysis.impact]}**`,
    image ? `<img src="${image.url}" alt="${image.altText}" width="720" />` : null,
    `## Summary\n${analysis.summary}`,
    `## What you need to know\n${bullets(analysis.keyPoints, "The source gave nothing beyond the summary above.")}`,
    `## Impact\n${IMPACT_LABEL[analysis.impact]}`,
    `## Recommended action\n**${ACTION_LABEL[analysis.action]}** — ${analysis.actionDetail}`,
    `## PostHog pages to update\n${pagesSection(alert)}`,
    `## Open questions\n${bullets(analysis.openQuestions, "None raised.")}`,
    `## Sources\n- [${competitor.label} ${item.source}](${item.url})${
      image ? `\n- Feature image (${image.origin}): ${image.url}` : ""
    }`,
    `---\nOpened by posthog-competitor-happenings. Analyzed with \`${model}\`.`,
  ];

  return sections.filter((section): section is string => section !== null).join("\n\n");
}

export function buildIssueDraft(alert: AnalyzedItem, image: FeatureImage | null): IssueDraft {
  return {
    title: buildIssueTitle(alert),
    body: buildIssueBody(alert, image),
    labels: buildIssueLabels(alert),
  };
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
