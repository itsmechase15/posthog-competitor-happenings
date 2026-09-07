import "dotenv/config";
import type { CompetitorId } from "./types.js";

export interface CompetitorConfig {
  id: CompetitorId;
  label: string;
  /** RSS changelog feed. */
  changelogFeed: string;
  /**
   * Sitemaps to diff for blog/launch posts. Sitemap indexes are followed one
   * level deep, so pointing at an index is fine.
   */
  sitemaps: string[];
  /** Only sitemap URLs whose path starts with one of these become candidates. */
  blogPathPrefixes: string[];
  /** Official X handle, without the leading @. */
  xUsername: string;
  /** Lowercase strings that count as a mention of this competitor. */
  aliases: string[];
}

export const COMPETITORS: Record<CompetitorId, CompetitorConfig> = {
  mixpanel: {
    id: "mixpanel",
    label: "Mixpanel",
    changelogFeed: "https://docs.mixpanel.com/changelogs/rss.xml",
    sitemaps: ["https://mixpanel.com/blog/sitemap.xml"],
    blogPathPrefixes: ["/blog/"],
    xUsername: "mixpanel",
    aliases: ["mixpanel"],
  },
  amplitude: {
    id: "amplitude",
    label: "Amplitude",
    changelogFeed: "https://amplitude.com/releases/feed.xml",
    sitemaps: ["https://amplitude.com/sitemap-root.xml"],
    blogPathPrefixes: ["/blog/"],
    xUsername: "Amplitude_HQ",
    aliases: ["amplitude"],
  },
};

export const COMPETITOR_IDS = Object.keys(COMPETITORS) as CompetitorId[];

/** The private #posthog-competitor-happenings channel. */
export const DEFAULT_SLACK_CHANNEL_ID = "C0C07A1DM09";

export interface Config {
  dryRun: boolean;
  databaseUrl: string | undefined;
  /** Bot token for `chat.postMessage`. Preferred over the webhook when both are set. */
  slackBotToken: string | undefined;
  /** Channel the bot posts to. Defaults to #posthog-competitor-happenings. */
  slackChannelId: string;
  /** Fallback delivery when no bot token is configured. */
  slackWebhookUrl: string | undefined;
  cursorApiKey: string | undefined;
  cursorModel: string;
  /** "local" runs the agent on this machine; "cloud" uses a no-repo cloud agent. */
  cursorRuntime: "local" | "cloud";
  xBearerToken: string | undefined;
  agentMailApiKey: string | undefined;
  agentMailInboxId: string;
  /** Items published before this many days ago are ignored. */
  lookbackDays: number;
  /** Hard cap on items analyzed and posted in one run, so a feed glitch can't flood Slack. */
  maxItemsPerRun: number;
  /** Hard cap on new items accepted from a single competitor+source pair. */
  maxItemsPerSource: number;
  /** Cap on PostHog.com pages fetched in one run. */
  posthogMaxPages: number;
  /** Re-fetch an indexed PostHog page once it is this old. */
  posthogRefreshDays: number;
  /** Skip the PostHog.com crawl entirely (useful for fast local runs). */
  skipPosthogIndex: boolean;
  /**
   * Analyze a competitor+source pair's backlog on the very first run instead of
   * recording it silently. Dry runs only — it exists so you can preview a real
   * Slack message without a seeded database.
   */
  forceAnalyze: boolean;
  httpTimeoutMs: number;
  userAgent: string;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be an integer, got "${raw}"`);
  }
  return parsed;
}

function str(name: string): string | undefined {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === "" ? undefined : raw.trim();
}

export function loadConfig(): Config {
  const runtime = (str("CURSOR_RUNTIME") ?? "local").toLowerCase();
  if (runtime !== "local" && runtime !== "cloud") {
    throw new Error(`CURSOR_RUNTIME must be "local" or "cloud", got "${runtime}"`);
  }

  const dryRun = bool("DRY_RUN", false);
  const forceAnalyze = bool("FORCE_ANALYZE", false);
  if (forceAnalyze && !dryRun) {
    throw new Error("FORCE_ANALYZE is only allowed with DRY_RUN=true — it bypasses seed protection");
  }

  return {
    dryRun,
    forceAnalyze,
    databaseUrl: str("DATABASE_URL"),
    slackBotToken: str("SLACK_BOT_TOKEN"),
    slackChannelId: str("SLACK_CHANNEL_ID") ?? DEFAULT_SLACK_CHANNEL_ID,
    slackWebhookUrl: str("SLACK_WEBHOOK_URL"),
    cursorApiKey: str("CURSOR_API_KEY"),
    cursorModel: str("CURSOR_MODEL") ?? "claude-opus-5",
    cursorRuntime: runtime,
    xBearerToken: str("X_BEARER_TOKEN"),
    agentMailApiKey: str("AGENTMAIL_API_KEY"),
    agentMailInboxId: str("AGENTMAIL_INBOX_ID") ?? "chasemccaskill@agentmail.to",
    lookbackDays: int("LOOKBACK_DAYS", 7),
    maxItemsPerRun: int("MAX_ITEMS_PER_RUN", 12),
    maxItemsPerSource: int("MAX_ITEMS_PER_SOURCE", 8),
    posthogMaxPages: int("POSTHOG_MAX_PAGES", 60),
    posthogRefreshDays: int("POSTHOG_REFRESH_DAYS", 14),
    skipPosthogIndex: bool("SKIP_POSTHOG_INDEX", false),
    httpTimeoutMs: int("HTTP_TIMEOUT_MS", 20_000),
    userAgent:
      str("USER_AGENT") ??
      "posthog-competitor-happenings/0.1 (+https://github.com/PostHog/marketing)",
  };
}
