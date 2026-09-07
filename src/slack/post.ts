import { createLogger } from "../log.js";
import type { SlackMessage } from "./message.js";

const log = createLogger("slack");

export interface SlackPoster {
  readonly description: string;
  post(message: SlackMessage): Promise<void>;
}

export const SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  ts?: string;
  channel?: string;
}

/**
 * Posts via `chat.postMessage` with a bot token. Preferred over the webhook:
 * it targets a channel by id, works for private channels the bot is in, and
 * returns a real error instead of a bare HTTP status.
 */
export class BotTokenPoster implements SlackPoster {
  readonly description: string;

  constructor(
    private readonly botToken: string,
    private readonly channelId: string,
    private readonly timeoutMs: number,
  ) {
    this.description = `chat.postMessage to ${channelId}`;
  }

  async post(message: SlackMessage): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(SLACK_POST_MESSAGE_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          authorization: `Bearer ${this.botToken}`,
        },
        body: JSON.stringify({
          channel: this.channelId,
          text: message.text,
          blocks: message.blocks,
          // The message already links the source; previews just add noise.
          unfurl_links: false,
          unfurl_media: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`chat.postMessage returned HTTP ${response.status}`);
      }

      // Slack answers 200 even when it refuses the post, so the body decides.
      const body = (await response.json()) as SlackApiResponse;
      if (!body.ok) {
        throw new Error(`chat.postMessage failed: ${body.error ?? "unknown error"}`);
      }
      log.debug(`posted to ${body.channel ?? this.channelId} at ${body.ts ?? "?"}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

export class WebhookPoster implements SlackPoster {
  readonly description = "incoming webhook";

  constructor(
    private readonly webhookUrl: string,
    private readonly timeoutMs: number,
  ) {}

  async post(message: SlackMessage): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(message),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = (await response.text().catch(() => "")).slice(0, 300);
        throw new Error(`Slack webhook returned ${response.status}: ${body}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Prints what would have been posted. Used for dry runs and when Slack is unconfigured. */
export class ConsolePoster implements SlackPoster {
  readonly description: string;

  constructor(private readonly reason: string) {
    this.description = `console (${reason})`;
  }

  async post(message: SlackMessage): Promise<void> {
    log.info(`[${this.reason}] would post to Slack:`);
    console.log(JSON.stringify(message, null, 2));
  }
}
