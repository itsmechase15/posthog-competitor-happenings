import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config.js";
import { createPoster } from "../src/pipeline.js";
import {
  BotTokenPoster,
  checkBotToken,
  messagePermalink,
  SLACK_AUTH_TEST_URL,
  SLACK_POST_MESSAGE_URL,
  WebhookPoster,
} from "../src/slack/post.js";
import type { SlackMessage } from "../src/slack/message.js";

const message: SlackMessage = {
  text: "Amplitude · Notable · changelog: Schedule experiment stop",
  blocks: [{ type: "section", text: { type: "mrkdwn", text: "hello" } }],
};

function mockFetch(response: Response) {
  const spy = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", spy);
  return spy;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BotTokenPoster", () => {
  it("calls chat.postMessage with the bot token and channel", async () => {
    const fetchSpy = mockFetch(jsonResponse({ ok: true, ts: "1", channel: "C0TESTCHAN1" }));
    await new BotTokenPoster("xoxb-test", "C0TESTCHAN1", 5_000).post(message);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(SLACK_POST_MESSAGE_URL);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer xoxb-test");

    const body = JSON.parse(init.body as string);
    expect(body.channel).toBe("C0TESTCHAN1");
    expect(body.text).toBe(message.text);
    expect(body.blocks).toEqual(message.blocks);
    expect(body.unfurl_links).toBe(false);
  });

  it("throws on an ok:false body even though Slack answers 200", async () => {
    mockFetch(jsonResponse({ ok: false, error: "not_in_channel" }));
    await expect(new BotTokenPoster("xoxb-test", "C1", 5_000).post(message)).rejects.toThrow(
      /not_in_channel/,
    );
  });

  it("names the scope Slack says is missing", async () => {
    mockFetch(
      jsonResponse({ ok: false, error: "missing_scope", needed: "chat:write", provided: "im:read" }),
    );
    await expect(new BotTokenPoster("xoxb-test", "C1", 5_000).post(message)).rejects.toThrow(
      /missing_scope \(needs chat:write, token has im:read\)/,
    );
  });

  it("throws on a transport-level failure", async () => {
    mockFetch(new Response("nope", { status: 502 }));
    await expect(new BotTokenPoster("xoxb-test", "C1", 5_000).post(message)).rejects.toThrow(
      /HTTP 502/,
    );
  });

  it("names the channel it targets", () => {
    expect(new BotTokenPoster("xoxb-test", "C0TESTCHAN1", 5_000).description).toContain(
      "C0TESTCHAN1",
    );
  });

  it("logs the permalink so a CI run records that the message landed", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockFetch(jsonResponse({ ok: true, ts: "1757343375.123456", channel: "C0TESTCHAN1" }));
    await new BotTokenPoster("xoxb-test", "C0TESTCHAN1", 5_000).post(message);

    const lines = logSpy.mock.calls.map((call) => String(call[0]));
    expect(lines.join("\n")).toContain(
      "https://slack.com/archives/C0TESTCHAN1/p1757343375123456",
    );
    logSpy.mockRestore();
  });

  it("still reports delivery when Slack omits the timestamp", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockFetch(jsonResponse({ ok: true }));
    await new BotTokenPoster("xoxb-test", "C1", 5_000).post(message);

    expect(logSpy.mock.calls.map((call) => String(call[0])).join("\n")).toContain("posted to C1");
    logSpy.mockRestore();
  });
});

describe("messagePermalink", () => {
  it("drops the dot from the timestamp", () => {
    expect(messagePermalink("C1", "1757343375.123456")).toBe(
      "https://slack.com/archives/C1/p1757343375123456",
    );
  });
});

describe("checkBotToken", () => {
  function authResponse(body: unknown, scopes?: string): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "content-type": "application/json",
        ...(scopes === undefined ? {} : { "x-oauth-scopes": scopes }),
      },
    });
  }

  it("passes a token that carries chat:write", async () => {
    const fetchSpy = mockFetch(
      authResponse({ ok: true, team: "PostHog", user: "competitor-bot" }, "chat:write,im:read"),
    );
    const check = await checkBotToken("xoxb-test", 5_000);

    expect(fetchSpy.mock.calls[0]?.[0]).toBe(SLACK_AUTH_TEST_URL);
    expect(check.ok).toBe(true);
    expect(check.detail).toContain("competitor-bot in PostHog");
  });

  it("fails a token that cannot post, and says what to add", async () => {
    mockFetch(authResponse({ ok: true, team: "PostHog", user: "competitor-bot" }, "im:read"));
    const check = await checkBotToken("xoxb-test", 5_000);

    expect(check.ok).toBe(false);
    expect(check.detail).toContain("missing chat:write");
    expect(check.detail).toContain("im:read");
  });

  it("fails a token Slack does not recognise", async () => {
    mockFetch(jsonResponse({ ok: false, error: "invalid_auth" }));
    expect(await checkBotToken("xoxb-test", 5_000)).toEqual({
      ok: false,
      detail: "auth.test refused the token: invalid_auth",
    });
  });

  it("accepts a token when Slack reports no scope header at all", async () => {
    mockFetch(authResponse({ ok: true, team: "PostHog", user: "competitor-bot" }));
    expect((await checkBotToken("xoxb-test", 5_000)).ok).toBe(true);
  });
});

describe("WebhookPoster", () => {
  it("posts the message as the webhook body", async () => {
    const fetchSpy = mockFetch(new Response("ok", { status: 200 }));
    await new WebhookPoster("https://hooks.slack.invalid/x", 5_000).post(message);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.slack.invalid/x");
    expect(JSON.parse(init.body as string)).toEqual(message);
  });

  it("throws on a non-2xx response", async () => {
    mockFetch(new Response("invalid_payload", { status: 400 }));
    await expect(
      new WebhookPoster("https://hooks.slack.invalid/x", 5_000).post(message),
    ).rejects.toThrow(/400/);
  });
});

describe("createPoster", () => {
  const config = (overrides: Partial<Config>): Config =>
    ({
      dryRun: false,
      slackBotToken: undefined,
      slackChannelId: "C0TESTCHAN1",
      slackWebhookUrl: undefined,
      httpTimeoutMs: 5_000,
      ...overrides,
    }) as Config;

  it("prefers the bot token when both are configured", () => {
    const poster = createPoster(
      config({ slackBotToken: "xoxb-test", slackWebhookUrl: "https://hooks.slack.invalid/x" }),
    );
    expect(poster).toBeInstanceOf(BotTokenPoster);
    expect(poster.description).toContain("C0TESTCHAN1");
  });

  it("falls back to the webhook when there is no bot token", () => {
    expect(
      createPoster(config({ slackWebhookUrl: "https://hooks.slack.invalid/x" })),
    ).toBeInstanceOf(WebhookPoster);
  });

  it("prints instead of posting during a dry run, even when fully configured", () => {
    const poster = createPoster(
      config({ dryRun: true, slackBotToken: "xoxb-test", slackWebhookUrl: "https://x.invalid" }),
    );
    expect(poster.description).toContain("dry run");
  });

  it("prints and says why when Slack is not configured at all", () => {
    expect(createPoster(config({})).description).toContain("SLACK_BOT_TOKEN");
  });

  it("refuses to guess a channel for a bot token that was given none", () => {
    expect(() =>
      createPoster(config({ slackBotToken: "xoxb-test", slackChannelId: undefined })),
    ).toThrow(/SLACK_CHANNEL_ID/);
  });
});
