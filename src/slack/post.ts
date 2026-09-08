import { createLogger } from "../log.js";
import type { SlackMessage } from "./message.js";

const log = createLogger("slack");

export interface SlackPoster {
  readonly description: string;
  post(message: SlackMessage): Promise<void>;
}

export const SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";
export const SLACK_AUTH_TEST_URL = "https://slack.com/api/auth.test";

/** Slack lists the scopes a token actually carries in this response header. */
const SCOPES_HEADER = "x-oauth-scopes";

/** The only scope `chat.postMessage` needs. */
const REQUIRED_SCOPE = "chat:write";

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  ts?: string;
  channel?: string;
  /** Present on a `missing_scope` refusal, and the whole fix when it is. */
  needed?: string;
  provided?: string;
}

interface SlackAuthTestResponse extends SlackApiResponse {
  team?: string;
  user?: string;
}

export interface SlackCredentialCheck {
  ok: boolean;
  /** One line, safe to log: identities and scope names, never the token. */
  detail: string;
}

/**
 * Ask Slack what the token is and what it may do, before anything with side
 * effects runs. A token missing `chat:write` fails here rather than after an
 * issue has already been opened for a message that cannot be delivered.
 */
export async function checkBotToken(
  botToken: string,
  timeoutMs: number,
): Promise<SlackCredentialCheck> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(SLACK_AUTH_TEST_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${botToken}` },
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => ({}))) as SlackAuthTestResponse;

    if (!body.ok) {
      return { ok: false, detail: `auth.test refused the token: ${body.error ?? "unknown error"}` };
    }

    const scopes = (response.headers.get(SCOPES_HEADER) ?? "")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean);
    const identity = `${body.user ?? "unknown bot"} in ${body.team ?? "unknown workspace"}`;
    const granted = scopes.length > 0 ? scopes.join(", ") : "none reported";

    if (scopes.length > 0 && !scopes.includes(REQUIRED_SCOPE)) {
      return {
        ok: false,
        detail: `${identity} cannot post: the token is missing ${REQUIRED_SCOPE}. Granted: ${granted}. Add the scope in api.slack.com → OAuth & Permissions, reinstall the app, then update SLACK_BOT_TOKEN`,
      };
    }

    return { ok: true, detail: `${identity}, scopes: ${granted}` };
  } catch (error) {
    return {
      ok: false,
      detail: `auth.test could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timer);
  }
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
        // A scope refusal names the scope that is missing; without it the
        // error is just "missing_scope" and nobody knows what to grant.
        const scopes = body.needed
          ? ` (needs ${body.needed}, token has ${body.provided || "nothing"})`
          : "";
        throw new Error(`chat.postMessage failed: ${body.error ?? "unknown error"}${scopes}`);
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
