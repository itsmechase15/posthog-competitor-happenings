import { FALLBACK_MODEL } from "../analysis/fallback.js";
import { COMPETITORS } from "../config.js";
import { ACTION_LABEL, IMPACT_EMOJI, IMPACT_LABEL, SOURCE_LABEL } from "../labels.js";
import type { Alert } from "../types.js";
import { firstSentence, sentences, truncate } from "../util/text.js";

export interface SlackMessage {
  text: string;
  blocks: unknown[];
}

export const ISSUE_LINK_LABEL = "Access GitHub issue for more information";

/** Short enough that nothing in the message wraps into a wall of text. */
const MAX_LEAD_CHARS = 240;
const MAX_POINT_CHARS = 160;
const MAX_POINTS = 4;
const MAX_ACTION_CHARS = 220;

/** Slack's mrkdwn treats these as control characters inside text nodes. */
function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function link(url: string, label: string): string {
  return `<${url}|${escape(truncate(label, 140))}>`;
}

function section(text: string): unknown {
  return { type: "section", text: { type: "mrkdwn", text } };
}

/**
 * The one sentence at the top. It has to say which competitor did what, so the
 * competitor's name is added only when the sentence does not already have it.
 */
export function leadSentence(alert: Alert): string {
  const label = COMPETITORS[alert.item.competitor].label;
  const lead = firstSentence(alert.analysis.summary, MAX_LEAD_CHARS);
  return lead.toLowerCase().includes(label.toLowerCase()) ? lead : `${label}: ${lead}`;
}

/**
 * The substance under "What you need to KNOW". Analyses written before the
 * rename have no key points, so the rest of their summary stands in.
 */
export function knowPoints(alert: Alert): string[] {
  const { keyPoints, summary } = alert.analysis;
  const source = keyPoints.length > 0 ? keyPoints : sentences(summary).slice(1);
  return source
    .map((point) => truncate(point.trim(), MAX_POINT_CHARS))
    .filter(Boolean)
    .slice(0, MAX_POINTS);
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
  const { item, analysis, model, image, issue, issueNote } = alert;
  const competitor = COMPETITORS[item.competitor];
  const lead = leadSentence(alert);
  const points = knowPoints(alert);

  const blocks: unknown[] = [
    // Always first, always present: the picture is what makes the alert
    // readable at a glance in a busy channel. alt_text is plain text, so it is
    // the one string here that must not be mrkdwn-escaped.
    { type: "image", image_url: image.url, alt_text: truncate(image.altText || lead, 300) },
    section(`*${escape(lead)}*`),
  ];

  if (points.length > 0) {
    blocks.push(
      section(
        `*What you need to KNOW*\n${points.map((point) => `• ${escape(point)}`).join("\n")}`,
      ),
    );
  }

  blocks.push(
    section(`*Impact*  ${IMPACT_EMOJI[analysis.impact]} ${IMPACT_LABEL[analysis.impact]}`),
    section(
      `*Recommended action*\n${ACTION_LABEL[analysis.action]} — ${escape(
        firstSentence(analysis.actionDetail, MAX_ACTION_CHARS),
      )}`,
    ),
  );

  if (issue) {
    blocks.push(section(`*${link(issue.url, ISSUE_LINK_LABEL)}*`));
  } else if (issueNote) {
    blocks.push(section(`_${escape(issueNote)}_`));
  }

  const footer = [
    `${competitor.label} · ${SOURCE_LABEL[item.source]}`,
    model === FALLBACK_MODEL
      ? "not model-analyzed (CURSOR_API_KEY unset) — the summary is lifted from the source"
      : `analyzed with ${model}`,
  ].join(" · ");

  blocks.push({
    type: "context",
    elements: [
      { type: "mrkdwn", text: `${escape(footer)} · ${link(item.url, "source")}` },
    ],
  });

  return { text: truncate(lead, 220), blocks };
}
