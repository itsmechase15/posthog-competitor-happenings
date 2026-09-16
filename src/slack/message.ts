import { FALLBACK_MODEL } from "../analysis/fallback.js";
import { COMPETITORS } from "../config.js";
import { actionTitleParts, IMPACT_EMOJI, IMPACT_LABEL, SOURCE_LABEL } from "../labels.js";
import { entryUrl } from "../sources/link.js";
import { rewriteForAction } from "../analysis/rewrite.js";
import type {
  ActionIssue,
  Alert,
  IssueRef,
  PostHogRef,
  RecommendedAction,
  SourceId,
} from "../types.js";
import {
  collapseWhitespace,
  firstSentence,
  pageNameFromUrl,
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

/** Slack truncates a header block past this, so the title is cut first. */
const MAX_HEADER_CHARS = 150;

/**
 * The line at the very top of an alert: which competitor, and what they
 * shipped. Slack headers are plain text, so this is sanitized but not escaped.
 */
export function alertHeaderText(alert: Alert): string {
  const competitor = COMPETITORS[alert.item.competitor].label;
  return sanitizeCopy(truncate(`${competitor} · ${alert.item.title}`, MAX_HEADER_CHARS));
}

/**
 * The visual break every alert opens with. Slack collapses consecutive
 * messages from the same bot, so without this a second alert reads as more of
 * the first one: a picture appears under the previous message's footer with
 * nothing saying a new item started. The divider draws the line and the header
 * names what is below it.
 *
 * Both blocks are built here, and nothing else depends on them, so taking the
 * break back out is deleting this function and its call.
 */
export function alertBreakBlocks(alert: Alert): unknown[] {
  return [
    { type: "divider" },
    { type: "header", text: { type: "plain_text", text: alertHeaderText(alert), emoji: true } },
  ];
}

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
/**
 * The one sentence under an action title, which leads with the work to do and
 * so runs longer than a bare description of the gap. Two short lines on a
 * phone, not a paragraph, and the prompt asks for the same budget.
 */
export const MAX_ACTION_CHARS = 220;
const MAX_ACTIONS = 3;
/**
 * How much of an exact rewrite Slack shows. Long enough to judge the voice and
 * the claim, short enough that an alert stays an alert: the issue has the rest.
 */
export const MAX_REWRITE_CHARS = 200;

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
 * The sources the KNOW line can link, labeled by `SOURCE_LABEL` like every
 * other place the source is tagged. A newsletter is not one of them: its URL
 * is a thread in our own inbox, which nobody else can open, so it is left out
 * rather than linked to a page that answers 404 for the reader.
 */
const LINKED_SOURCES: readonly SourceId[] = ["changelog", "blog", "x"];

/**
 * The source link that sits with the KNOW sentence. The footer links the
 * source too, but the footer is the last line of the message: this is the one
 * you can hit as soon as you have read what happened, without going through
 * the GitHub issue to find out where the change was announced.
 */
export function knowSourceLink(alert: Alert): string | null {
  if (!LINKED_SOURCES.includes(alert.item.source)) return null;
  const url = entryUrl(alert.item);
  return /^https?:\/\//i.test(url) ? link(url, SOURCE_LABEL[alert.item.source]) : null;
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
export function actionSectionText(
  action: RecommendedAction,
  issue: IssueRef | null,
  rewrite: PostHogRef | null = null,
): string {
  const { label, feature } = actionTitleParts(action);
  const title = !feature
    ? escape(label)
    : `${escape(label)} ${feature.url ? link(feature.url, feature.label) : escape(feature.label)}`;
  const lines = [`*${title}*`, escape(firstSentence(action.detail, MAX_ACTION_CHARS))];
  const preview = rewritePreview(rewrite);
  if (preview) lines.push(preview);
  if (issue) lines.push(link(issue.url, issueLinkLabel(issue)));
  return lines.join("\n");
}

/**
 * The first words of the rewrite, under the page it goes on.
 *
 * A page edit read in Slack is a decision about copy, so seeing the copy is
 * what makes the decision possible before anyone opens the issue. It is a
 * preview and says so: Slack gets a line, the issue carries the whole thing
 * next to what the page says today, which is the pair you actually edit from.
 */
export function rewritePreview(ref: PostHogRef | null): string | null {
  if (!ref?.proposedText) return null;
  const copy = collapseWhitespace(ref.proposedText);
  const shown = truncate(copy, MAX_REWRITE_CHARS);
  const tail = shown.length < copy.length ? " (full copy in the issue)" : "";
  return `> ${escape(`New copy for ${pageNameFromUrl(ref.url)}: "${shown}"`)}${tail}`;
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

/** What the action section says when there is nothing to do. */
export const NO_ACTION_TITLE = "None";
const FALLBACK_NO_ACTION_REASON =
  "Nothing here asks anything of PostHog, and no reason was recorded.";
/** A Slack section block stops rendering past this, so the reason is cut first. */
const MAX_NO_ACTION_CHARS = 600;

/**
 * Zero actions rendered as an answer rather than as a blank.
 *
 * A launch that asks nothing of PostHog is a normal outcome and a useful one:
 * it says somebody looked. An empty section would read as a broken alert, and
 * a missing one would read as an alert nobody finished, so the reason goes
 * where the actions would have been.
 */
export function noActionSectionText(alert: Alert): string {
  const reason = alert.analysis.noActionReason?.trim() || FALLBACK_NO_ACTION_REASON;
  return [`*${NO_ACTION_TITLE}*`, escape(truncate(reason, MAX_NO_ACTION_CHARS))].join("\n");
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
    if (block.type === "divider") {
      parts.push("---");
    } else if (block.type === "header" && block.text?.text) {
      parts.push(`*${block.text.text}*`);
    } else if (block.type === "image" && block.image_url) {
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
  const sourceLink = knowSourceLink(alert);
  const points = detailPoints(alert);

  const blocks: unknown[] = [
    // The break between this alert and whatever Slack collapsed it into.
    ...alertBreakBlocks(alert),
    // First after the break, always present: the picture is what makes the
    // alert readable at a glance in a busy channel. alt_text is plain text, so
    // it is the one string here that must not be mrkdwn-escaped.
    {
      type: "image",
      image_url: image.url,
      alt_text: sanitizeCopy(truncate(image.altText || lead, 300)),
    },
    // The heading carries the whole sentence, so there is no unlabelled line
    // above it competing to be read first. The source hangs off the end of the
    // sentence in parentheses, where it reads as a place to go rather than as
    // part of what happened.
    section(`*${KNOW_HEADING}*\n${escape(lead)}${sourceLink ? ` (${sourceLink})` : ""}`),
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
  blocks.push(section(`*${ACTION_HEADING}*`));
  if (entries.length > 0) {
    for (const entry of entries) {
      blocks.push(
        section(
          actionSectionText(entry.action, entry.issue, rewriteForAction(analysis, entry.action)),
        ),
      );
    }
  } else {
    blocks.push(section(noActionSectionText(alert)));
  }

  // `every` on an empty list is true, which used to put "GitHub issues not
  // created" under an alert that never asked for one.
  if (issueNote && entries.length > 0 && entries.every((entry) => entry.issue === null)) {
    blocks.push(section(`_${escape(truncate(issueNote, MAX_NO_ACTION_CHARS))}_`));
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
      { type: "mrkdwn", text: `${escape(footer)} · ${link(entryUrl(item), "source")}` },
    ],
  });

  // The notification preview is plain text, not mrkdwn, so it needs the
  // punctuation pass that escape() gives everything else.
  return { text: sanitizeCopy(truncate(lead, 220)), blocks };
}
