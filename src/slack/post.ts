import { createLogger } from "../log.js";
import type { SlackMessage } from "./message.js";

const log = createLogger("slack");

export interface SlackPoster {
  post(message: SlackMessage): Promise<void>;
}

export class WebhookPoster implements SlackPoster {
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

/** Prints what would have been posted. Used for DRY_RUN and when the webhook is unset. */
export class ConsolePoster implements SlackPoster {
  constructor(private readonly reason: string) {}

  async post(message: SlackMessage): Promise<void> {
    log.info(`[${this.reason}] would post to Slack:`);
    console.log(JSON.stringify(message, null, 2));
  }
}
