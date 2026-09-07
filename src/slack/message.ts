import { COMPETITORS } from "../config.js";
import { FALLBACK_MODEL } from "../analysis/fallback.js";
import type { Action, AnalyzedItem, Severity, SourceId } from "../types.js";
import { truncate } from "../util/text.js";

export interface SlackMessage {
  text: string;
  blocks: unknown[];
}

const SEVERITY_LABEL: Record<Severity, string> = {
  minor: "Minor",
  notable: "Notable",
  major: "Major",
};

const ACTION_LABEL: Record<Action, string> = {
  update_pages: "Update pages",
  new_compare_page: "New compare page",
  consider_building: "Consider building",
  consider_enhancing: "Consider enhancing",
};

const SOURCE_LABEL: Record<SourceId, string> = {
  changelog: "changelog",
  blog: "blog",
  x: "X",
  newsletter: "newsletter",
};

/** Slack's mrkdwn treats these as control characters inside text nodes. */
function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function link(url: string, label: string): string {
  return `<${url}|${escape(truncate(label, 140))}>`;
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
    elements?: Array<{ text?: string }>;
  }>) {
    if (block.type === "section" && block.text?.text) {
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

export function buildSlackMessage(analyzed: AnalyzedItem): SlackMessage {
  const { item, analysis, model } = analyzed;
  const competitor = COMPETITORS[item.competitor];
  const context = `${SEVERITY_LABEL[analysis.severity]} · ${SOURCE_LABEL[item.source]}`;

  const blocks: unknown[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${competitor.label} · ${context}*\n${link(item.url, item.title)}`,
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: escape(truncate(analysis.summary, 900)) },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${ACTION_LABEL[analysis.action]}* — ${escape(truncate(analysis.actionDetail, 1_400))}`,
      },
    },
  ];

  if (analysis.posthogRefs.length > 0) {
    const refs = analysis.posthogRefs
      .slice(0, 3)
      .map((ref) => {
        const edit = ref.suggestedEdit
          ? `\n   _Suggested edit:_ ${escape(truncate(ref.suggestedEdit, 300))}`
          : "";
        return `• ${link(ref.url, ref.url.replace("https://posthog.com", ""))} — ${escape(
          truncate(ref.claim, 220),
        )}${edit}`;
      })
      .join("\n");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*PostHog pages to check*\n${refs}` },
    });
  }

  const footer =
    model === FALLBACK_MODEL
      ? "Not model-analyzed (CURSOR_API_KEY unset) — summary is lifted straight from the source."
      : `Analyzed with ${model}`;
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: escape(footer) }],
  });

  return {
    text: `${competitor.label} · ${context}: ${truncate(item.title, 140)}`,
    blocks,
  };
}
