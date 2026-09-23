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
  /**
   * The competitor's own pages comparing themselves to PostHog. What they
   * claim PostHog cannot do is the third reason to update a PostHog page, so
   * these go in front of the model alongside PostHog's own copy.
   */
  comparePages: string[];
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
    comparePages: ["https://mixpanel.com/compare/posthog"],
  },
  amplitude: {
    id: "amplitude",
    label: "Amplitude",
    changelogFeed: "https://amplitude.com/releases/feed.xml",
    sitemaps: ["https://amplitude.com/sitemap-root.xml"],
    blogPathPrefixes: ["/blog/"],
    xUsername: "Amplitude_HQ",
    aliases: ["amplitude"],
    comparePages: ["https://amplitude.com/compare/posthog"],
  },
};

export const COMPETITOR_IDS = Object.keys(COMPETITORS) as CompetitorId[];

/** Issues are filed against this app's own repo, where the daily job already runs. */
export const DEFAULT_GITHUB_REPO = "itsmechase15/posthog-competitor-happenings";

/**
 * Renderers that turn a page into an image, tried in order. Used when a
 * competitor's page offers no usable picture of its own, so the alert still
 * opens with a screenshot of the feature rather than nothing.
 *
 * Microlink leads because it is the one that honors a fragment: a Mixpanel
 * changelog entry is an `#anchor` on a page of entries, and a renderer that
 * drops the hash screenshots whatever happens to be at the top instead. It
 * only takes the hash through `{encodedUrl}` – an unencoded `#` never leaves
 * the client. thum.io has no daily quota, so it stays behind it as the
 * fallback for a day microlink turns down.
 */
/**
 * Where the corpus is discovered from. PostHog's own sitemap is the closest
 * thing to an authoritative list of its pages – and still only one input,
 * because a sitemap lags a launch.
 */
export const DEFAULT_DOCS_SITEMAPS = ["https://posthog.com/sitemap/sitemap-0.xml"];

/**
 * The reviewer's model.
 *
 * Not the analyst's. The review exists to catch a claim the analyst was
 * confident about and wrong about, and the model that wrote such a claim is the
 * worst judge of it. A model id the Cursor SDK turns down costs the run
 * nothing: the review is skipped, the label says so, and the issue stands as
 * the analyst filed it.
 */
export const DEFAULT_REVIEW_MODEL = "claude-fable-5-1";

export const DEFAULT_SCREENSHOT_URL_TEMPLATES = [
  "https://api.microlink.io/?url={encodedUrl}&screenshot=true&meta=false&embed=screenshot.url",
  "https://image.thum.io/get/width/1200/crop/900/noanimate/{url}",
];

export interface Config {
  dryRun: boolean;
  databaseUrl: string | undefined;
  /** Bot token for `chat.postMessage`. Preferred over the webhook when both are set. */
  slackBotToken: string | undefined;
  /**
   * Channel the bot posts to. No default: a built-in id would be one
   * workspace's channel, and every other install would post at it by accident.
   */
  slackChannelId: string | undefined;
  /** Fallback delivery when no bot token is configured. */
  slackWebhookUrl: string | undefined;
  /** Token used to open the issue each Slack message links to. Set for free inside Actions. */
  githubToken: string | undefined;
  /** `owner/repo` the issues are filed against. */
  githubRepo: string;
  /**
   * URL templates whose `{url}` (or `{encodedUrl}`) is replaced with the page
   * to screenshot, tried in order until one serves an image.
   */
  screenshotUrlTemplates: string[];
  cursorApiKey: string | undefined;
  cursorModel: string;
  /** "local" runs the agent on this machine; "cloud" uses a no-repo cloud agent. */
  cursorRuntime: "local" | "cloud";
  /**
   * The model that reviews each filed action against the same docs corpus. A
   * different model from the analyst on purpose: a second opinion from the
   * model that wrote the claim is not a second opinion.
   */
  reviewModel: string;
  /**
   * The model that rewrites an action the reviewer asked to revise. Defaults to
   * the analyst's model, because writing PostHog copy is the analyst's job and
   * the reviewer's job is deciding whether the copy is true.
   */
  updaterModel: string;
  /** Skip the review pass entirely. For a fast local run, not for the daily job. */
  skipReview: boolean;
  /**
   * Stop photographing the page for the before/after on an `update_pages`
   * issue, and the draft staged on a blog post for a `consider_publishing` one. They are the
   * one thing in the app that runs a browser and commits to the repo, so they
   * share a switch – an issue without the pictures says the same thing in
   * words.
   */
  skipPageVisuals: boolean;
  /**
   * Reviews allowed in one run. Past it, an action keeps the issue it was filed
   * with and picks up a `review:skipped` label saying nobody looked.
   */
  reviewMaxPerRun: number;
  xBearerToken: string | undefined;
  agentMailApiKey: string | undefined;
  /** Inbox the newsletters are read from. No default, for the same reason. */
  agentMailInboxId: string | undefined;
  /** Items published before this many days ago are ignored. */
  lookbackDays: number;
  /** Hard cap on items analyzed and posted in one run, so a feed glitch can't flood Slack. */
  maxItemsPerRun: number;
  /** Hard cap on new items accepted from a single competitor+source pair. */
  maxItemsPerSource: number;
  /** Cap on PostHog.com pages fetched in one run. */
  posthogMaxPages: number;
  /**
   * Re-fetch a corpus page this long after it was last read, when nothing has
   * reasoned against it lately. The cold tier.
   */
  posthogRefreshDays: number;
  /**
   * The same, for a page an analyst has read recently. Those are the pages
   * recommendations rest on, so they are kept closer to current.
   */
  docsHotRefreshDays: number;
  /** Skip the PostHog.com corpus refresh entirely (useful for fast local runs). */
  skipPosthogIndex: boolean;
  /** Sitemaps discovery reads, filtered to PostHog docs and marketing pages. */
  docsSitemaps: string[];
  /** One discovery input among several, never the corpus itself. Unset skips it. */
  docsLlmsTxt: string | undefined;
  /**
   * A single file carrying every docs page's body, used once to seed an empty
   * corpus and never read again. posthog.com does not publish one today, so
   * this is unset and the first run fills the corpus a page at a time.
   */
  docsLlmsFullTxt: string | undefined;
  /** PostHog's own changelog index. Its entries are evidence that something shipped. */
  posthogChangelogIndex: string | undefined;
  /** Where the per-run markdown copy of the corpus is written for the analyst to search. */
  docsWorkspaceDir: string;
  /** How many corpus pages are read at once. Small: this is somebody else's website. */
  docsFetchConcurrency: number;
  /** How many corpus excerpts are pre-loaded into the prompt as a starting point. */
  retrievalTopK: number;
  /** Excerpts allowed from any one docs section, so one area cannot fill the prompt. */
  retrievalPerSection: number;
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

/** A comma-separated variable, for the settings that accept more than one value. */
function list(name: string): string[] | undefined {
  const raw = str(name);
  if (raw === undefined) return undefined;
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
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
    slackChannelId: str("SLACK_CHANNEL_ID"),
    slackWebhookUrl: str("SLACK_WEBHOOK_URL"),
    githubToken: str("GITHUB_TOKEN") ?? str("GH_TOKEN"),
    githubRepo: str("GITHUB_REPOSITORY") ?? DEFAULT_GITHUB_REPO,
    screenshotUrlTemplates: list("SCREENSHOT_URL_TEMPLATE") ?? DEFAULT_SCREENSHOT_URL_TEMPLATES,
    cursorApiKey: str("CURSOR_API_KEY"),
    cursorModel: str("CURSOR_MODEL") ?? "claude-opus-5",
    cursorRuntime: runtime,
    reviewModel: str("REVIEW_MODEL") ?? DEFAULT_REVIEW_MODEL,
    updaterModel: str("UPDATER_MODEL") ?? str("CURSOR_MODEL") ?? "claude-opus-5",
    skipReview: bool("SKIP_REVIEW", false),
    skipPageVisuals: bool("SKIP_PAGE_VISUALS", false),
    reviewMaxPerRun: int("REVIEW_MAX_PER_RUN", 12),
    xBearerToken: str("X_BEARER_TOKEN"),
    agentMailApiKey: str("AGENTMAIL_API_KEY"),
    agentMailInboxId: str("AGENTMAIL_INBOX_ID"),
    lookbackDays: int("LOOKBACK_DAYS", 7),
    maxItemsPerRun: int("MAX_ITEMS_PER_RUN", 12),
    maxItemsPerSource: int("MAX_ITEMS_PER_SOURCE", 8),
    // The sitemap lists about 3,500 docs pages and `llms.txt` names a couple
    // of thousand more, so discovery lands around 6,600. The budget clears
    // that with room, because the coverage gate is only as good as the corpus
    // behind it: a partial corpus blocks honest actions and misses others.
    // Conditional requests keep the steady-state cost to a few thousand 304s.
    posthogMaxPages: int("POSTHOG_MAX_PAGES", 8_000),
    posthogRefreshDays: int("POSTHOG_REFRESH_DAYS", 14),
    docsHotRefreshDays: int("DOCS_HOT_REFRESH_DAYS", 3),
    skipPosthogIndex: bool("SKIP_POSTHOG_INDEX", false),
    docsSitemaps: list("DOCS_SITEMAPS") ?? DEFAULT_DOCS_SITEMAPS,
    docsLlmsTxt: str("DOCS_LLMS_TXT") ?? "https://posthog.com/llms.txt",
    docsLlmsFullTxt: str("DOCS_LLMS_FULL_TXT"),
    posthogChangelogIndex: str("POSTHOG_CHANGELOG_INDEX") ?? "https://posthog.com/changelog",
    docsWorkspaceDir: str("DOCS_WORKSPACE_DIR") ?? ".docs-workspace",
    docsFetchConcurrency: int("DOCS_FETCH_CONCURRENCY", 6),
    retrievalTopK: int("RETRIEVAL_TOP_K", 10),
    retrievalPerSection: int("RETRIEVAL_PER_SECTION", 4),
    httpTimeoutMs: int("HTTP_TIMEOUT_MS", 20_000),
    userAgent:
      str("USER_AGENT") ??
      "posthog-competitor-happenings/0.1 (+https://github.com/PostHog/marketing)",
  };
}
