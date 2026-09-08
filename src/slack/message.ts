import { FALLBACK_MODEL } from "../analysis/fallback.js";
import { COMPETITORS } from "../config.js";
import { actionTitleParts, IMPACT_EMOJI, IMPACT_LABEL, SOURCE_LABEL } from "../labels.js";
import type { ActionIssue, Alert, IssueRef, RecommendedAction } from "../types.js";
import {
  firstSentence,
  sanitizeCopy,
  sentences,
  SPACED_EN_DASH,
  truncate,
} from "../util/text.js";

export interface SlackMessage {
  text: string;
  blocks: unknown[];
}

export const ISSUE_LINK_LABEL = "Access GitHub issue";

/**
 * The link under one action. Every action has an issue of its own, so the
 * number is part of the label: three links reading "Access GitHub issue" would
 * be indistinguishable on a phone.
 */
export function issueLinkLabel(issue: IssueRef): string {
  return `${ISSUE_LINK_LABEL} #${issue.number}`;
}

/** The one sentence lives under this heading; the bullets under the next one. */
export const KNOW_HEADING = "What you need to KNOW";
export const DETAIL_HEADING = "More detail";
/** Plural in the heading, because an alert often needs a page fix and a feature gap. */
export const ACTION_HEADING = "Recommended action(s)";

/** Short enough that nothing in the message wraps into a wall of text. */
const MAX_LEAD_CHARS = 240;
const MAX_POINT_CHARS = 160;
const MAX_POINTS = 4;
/** One line under the action title on a phone, which is roughly this many characters. */
const MAX_ACTION_CHARS = 150;
const MAX_ACTIONS = 3;

/**
 * Slack's mrkdwn treats these as control characters inside text nodes. Every
 * string routed through here is also punctuated the way PostHog writes, which
 * is the last gate before a message goes out.
 */
function escape(text: string): string {
  return sanitizeCopy(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function link(url: string, label: string): string {
  return `<${url}|${escape(truncate(label, 140))}>`;
}

function section(text: string): unknown {
  return { type: "section", text: { type: "mrkdwn", text } };
}

/**
 * The one sentence under "What you need to KNOW". It has to say which competitor
 * did what, so the competitor's name is added only when the sentence lacks it.
 */
export function leadSentence(alert: Alert): string {
  const label = COMPETITORS[alert.item.competitor].label;
  const lead = firstSentence(alert.analysis.summary, MAX_LEAD_CHARS);
  return lead.toLowerCase().includes(label.toLowerCase()) ? lead : `${label}: ${lead}`;
}

/**
 * The bullets that elaborate on the one sentence, never repeat it. Analyses
 * written before key points existed fall back to the rest of their summary.
 */
export function detailPoints(alert: Alert): string[] {
  const { keyPoints, summary } = alert.analysis;
  const source = keyPoints.length > 0 ? keyPoints : sentences(summary).slice(1);
  return source
    .map((point) => truncate(point.trim(), MAX_POINT_CHARS))
    .filter(Boolean)
    .slice(0, MAX_POINTS);
}

/**
 * One action, as Slack shows it: a bold title on its own line, one short
 * sentence under it, then the link to that action's own issue. The title
 * carries the PostHog feature for "Consider enhancing", so it still names
 * something concrete when read on its own, and the feature links to its
 * product page when we know one. A feature we do not recognize stays plain
 * text rather than pointing at a guessed URL.
 */
export function actionSectionText(action: RecommendedAction, issue: IssueRef | null): string {
  const { label, feature } = actionTitleParts(action);
  const title = !feature
    ? escape(label)
    : `${escape(label)} ${feature.url ? link(feature.url, feature.label) : escape(feature.label)}`;
  const lines = [`*${title}*`, escape(firstSentence(action.detail, MAX_ACTION_CHARS))];
  if (issue) lines.push(link(issue.url, issueLinkLabel(issue)));
  return lines.join("\n");
}

/**
 * The actions to render, each paired with its own issue. The analysis is the
 * spine, so an alert whose issues were never opened – a dry run, or a run with
 * no token – still shows every action, just without a link under it.
 */
export function actionEntries(alert: Alert): ActionIssue[] {
  return alert.analysis.actions.slice(0, MAX_ACTIONS).map((action, index) => ({
    action,
    issue: alert.issues[index]?.issue ?? null,
  }));
}

/**
 * The message as Slack renders it, for logs and artifacts. Section text is
 * already mrkdwn, so this only has to join the blocks back together.
 */
export function renderMessageText(message: SlackMessage): string {
  const parts: string[] = [];

  for (const block of message.blocks as Array<{
    type?: string;
    text?: { text?: string };
    image_url?: string;
    alt_text?: string;
    elements?: Array<{ text?: string }>;
  }>) {
    if (block.type === "image" && block.image_url) {
      parts.push(`![${block.alt_text ?? ""}](${block.image_url})`);
    } else if (block.type === "section" && block.text?.text) {
      parts.push(block.text.text);
    } else if (block.type === "context") {
      const text = (block.elements ?? [])
        .map((element) => element.text ?? "")
        .filter(Boolean)
        .join(" ");
      if (text) parts.push(`_${text}_`);
    }
  }

  return parts.join("\n\n");
}

export function buildSlackMessage(alert: Alert): SlackMessage {
  const { item, analysis, model, image, issueNote } = alert;
  const competitor = COMPETITORS[item.competitor];
  const lead = leadSentence(alert);
  const points = detailPoints(alert);

  const blocks: unknown[] = [
    // Always first, always present: the picture is what makes the alert
    // readable at a glance in a busy channel. alt_text is plain text, so it is
    // the one string here that must not be mrkdwn-escaped.
    {
      type: "image",
      image_url: image.url,
      alt_text: sanitizeCopy(truncate(image.altText || lead, 300)),
    },
    // The heading carries the whole sentence, so there is no unlabelled line
    // above it competing to be read first.
    section(`*${KNOW_HEADING}*\n${escape(lead)}`),
    section(`*Impact*  ${IMPACT_EMOJI[analysis.impact]} ${IMPACT_LABEL[analysis.impact]}`),
  ];

  if (points.length > 0) {
    blocks.push(
      section(
        `*${DETAIL_HEADING}*\n${points.map((point) => `• ${escape(point)}`).join("\n")}`,
      ),
    );
  }

  // One section per action, under a heading of its own, each linking the issue
  // opened for it. Slack puts real space between sections, so each action reads
  // as its own thing on a phone, with its own place to go for the detail.
  const entries = actionEntries(alert);
  if (entries.length > 0) {
    blocks.push(section(`*${ACTION_HEADING}*`));
    for (const entry of entries) {
      blocks.push(section(actionSectionText(entry.action, entry.issue)));
    }
  }

  if (issueNote && entries.every((entry) => entry.issue === null)) {
    blocks.push(section(`_${escape(issueNote)}_`));
  }

  const footer = [
    `${competitor.label} · ${SOURCE_LABEL[item.source]}`,
    model === FALLBACK_MODEL
      ? `not model-analyzed (CURSOR_API_KEY unset)${SPACED_EN_DASH}the summary is lifted from the source`
      : `analyzed with ${model}`,
  ].join(" · ");

  blocks.push({
    type: "context",
    elements: [
      { type: "mrkdwn", text: `${escape(footer)} · ${link(item.url, "source")}` },
    ],
  });

  // The notification preview is plain text, not mrkdwn, so it needs the
  // punctuation pass that escape() gives everything else.
  return { text: sanitizeCopy(truncate(lead, 220)), blocks };
}
