import type { CompetitorConfig } from "../config.js";
import type { CandidateItem, CompetitorId } from "../types.js";
import { collapseWhitespace, truncate } from "../util/text.js";

export const AGENTMAIL_API_BASE = "https://api.agentmail.to/v0";

export interface AgentMailMessage {
  message_id: string;
  thread_id?: string;
  subject?: string;
  preview?: string;
  from?: string;
  timestamp?: string;
  labels?: string[];
}

export interface AgentMailMessageList {
  count?: number;
  messages?: AgentMailMessage[];
}

export function messagesUrl(inboxId: string, after: Date, limit: number): string {
  const params = new URLSearchParams({
    limit: String(limit),
    after: after.toISOString(),
  });
  return `${AGENTMAIL_API_BASE}/inboxes/${encodeURIComponent(inboxId)}/messages?${params.toString()}`;
}

function haystack(message: AgentMailMessage): string {
  return `${message.subject ?? ""} ${message.preview ?? ""} ${message.from ?? ""}`.toLowerCase();
}

/**
 * A newsletter is only interesting if it actually names a competitor, so route
 * each message to the competitor it mentions and drop the rest.
 */
export function routeMessage(
  message: AgentMailMessage,
  competitors: CompetitorConfig[],
): CompetitorId | null {
  const text = haystack(message);
  for (const competitor of competitors) {
    if (competitor.aliases.some((alias) => text.includes(alias))) return competitor.id;
  }
  return null;
}

export function messagesToItems(
  messages: AgentMailMessage[],
  competitors: CompetitorConfig[],
  inboxId: string,
): CandidateItem[] {
  const items: CandidateItem[] = [];

  for (const message of messages) {
    const competitor = routeMessage(message, competitors);
    if (!competitor) continue;

    const subject = collapseWhitespace(message.subject ?? "(no subject)");
    items.push({
      competitor,
      source: "newsletter",
      externalId: message.message_id,
      title: truncate(subject, 160),
      url: `https://app.agentmail.to/inboxes/${encodeURIComponent(inboxId)}/threads/${
        message.thread_id ?? message.message_id
      }`,
      publishedAt: message.timestamp ? new Date(message.timestamp) : null,
      raw: {
        from: message.from ?? null,
        subject,
        preview: truncate(collapseWhitespace(message.preview ?? ""), 4_000),
      },
    });
  }

  return items;
}
