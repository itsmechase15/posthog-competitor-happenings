import { truncate } from "../util/text.js";

/**
 * A PostHog product, the words that point at it, and the docs pages that say
 * what it can already do.
 *
 * This list exists because the competitor-mention index is the wrong evidence
 * for "PostHog can't do X". Compare pages are marketing copy written at a
 * point in time; docs are the product. Before the bot recommends building or
 * enhancing anything, the docs for the product it names go in front of the
 * model.
 *
 * `docs` is deliberately short. The first entry is the product's overview page,
 * and the ones after it are the pages that answer the questions competitors
 * keep shipping against: scheduling, lifecycle, rollout, and alerting. Every
 * URL here is one a person can open.
 */
export interface PostHogProduct {
  /** The name to use in an action's `feature`, e.g. "Experiments". */
  name: string;
  /** Lowercase substrings in a signal, or a model's own words, that point here. */
  keywords: string[];
  /** Canonical docs pages, overview first. */
  docs: string[];
}

export const POSTHOG_PRODUCTS: PostHogProduct[] = [
  {
    name: "Experiments",
    keywords: [
      "experiment",
      "a/b test",
      "ab test",
      "a/b/n",
      "split test",
      "holdout",
      "variant",
      "statistical significance",
    ],
    docs: [
      "https://posthog.com/docs/experiments",
      "https://posthog.com/docs/experiments/managing-lifecycle",
      "https://posthog.com/docs/experiments/holdouts",
      "https://posthog.com/docs/experiments/statistics",
    ],
  },
  {
    name: "Feature flags",
    keywords: [
      "feature flag",
      "feature gate",
      "flag",
      "rollout",
      "roll out",
      "kill switch",
      "targeting rule",
      "release toggle",
    ],
    docs: [
      "https://posthog.com/docs/feature-flags",
      "https://posthog.com/docs/feature-flags/scheduled-flag-changes",
      "https://posthog.com/docs/feature-flags/rollout-strategies",
      "https://posthog.com/docs/feature-flags/creating-feature-flags",
    ],
  },
  {
    name: "Product analytics",
    keywords: [
      "funnel",
      "retention",
      "cohort",
      "insight",
      "dashboard",
      "trend",
      "segmentation",
      "user path",
      "lifecycle chart",
      "product analytics",
    ],
    docs: [
      "https://posthog.com/docs/product-analytics",
      "https://posthog.com/docs/product-analytics/insights",
      "https://posthog.com/docs/product-analytics/dashboards",
      "https://posthog.com/docs/product-analytics/subscriptions",
    ],
  },
  {
    name: "Web analytics",
    keywords: ["web analytics", "pageview", "bounce rate", "utm", "referrer", "web vitals"],
    docs: ["https://posthog.com/docs/web-analytics"],
  },
  {
    name: "Session replay",
    keywords: ["session replay", "session recording", "replay", "heatmap", "screen recording"],
    docs: [
      "https://posthog.com/docs/session-replay",
      "https://posthog.com/docs/session-replay/how-to-watch-recordings",
    ],
  },
  {
    name: "Surveys",
    keywords: ["survey", "nps", "csat", "feedback widget", "in-app poll"],
    docs: ["https://posthog.com/docs/surveys"],
  },
  {
    name: "Error tracking",
    keywords: ["error tracking", "exception", "stack trace", "crash report", "issue tracking"],
    docs: ["https://posthog.com/docs/error-tracking"],
  },
  {
    name: "Data warehouse",
    keywords: ["data warehouse", "warehouse", "snowflake", "bigquery", "redshift", "external data"],
    docs: ["https://posthog.com/docs/data-warehouse"],
  },
  {
    name: "Data pipelines",
    keywords: [
      "pipeline",
      "destination",
      "webhook",
      "reverse etl",
      "data export",
      "batch export",
      "transformation",
      "sync",
    ],
    docs: ["https://posthog.com/docs/cdp", "https://posthog.com/docs/cdp/destinations"],
  },
  {
    name: "LLM analytics",
    keywords: ["llm", "prompt", "token usage", "ai observability", "generation", "trace", "agent"],
    docs: [
      "https://posthog.com/docs/llm-analytics",
      "https://posthog.com/docs/ai-engineering",
    ],
  },
  {
    name: "Max AI",
    keywords: ["ai assistant", "copilot", "natural language query", "ask ai", "chat with your data"],
    docs: ["https://posthog.com/docs/max-ai"],
  },
  {
    name: "Revenue analytics",
    keywords: ["revenue", "mrr", "arr", "subscription", "stripe", "monetization"],
    docs: ["https://posthog.com/docs/revenue-analytics"],
  },
  {
    name: "Logs",
    keywords: ["log", "logging", "log search", "observability"],
    docs: ["https://posthog.com/docs/logs"],
  },
  {
    name: "Alerts",
    keywords: ["alert", "anomaly detection", "threshold", "notification", "subscribe to a report"],
    docs: ["https://posthog.com/docs/alerts", "https://posthog.com/docs/data/annotations"],
  },
  {
    name: "Notebooks",
    keywords: ["notebook", "canvas", "shared analysis"],
    docs: ["https://posthog.com/docs/notebooks"],
  },
];

/**
 * Every canonical docs URL, deduplicated. This is the whole set the indexer is
 * asked to keep fresh: a bounded list, not a crawl of posthog.com.
 */
export const CANONICAL_DOC_URLS: string[] = [
  ...new Set(POSTHOG_PRODUCTS.flatMap((product) => product.docs)),
];

export function findProductByName(name: string): PostHogProduct | undefined {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return undefined;
  return POSTHOG_PRODUCTS.find(
    (product) =>
      product.name.toLowerCase() === wanted ||
      // "Experiment", "experiments (A/B testing)", and "PostHog Experiments"
      // all mean the same product.
      wanted.includes(product.name.toLowerCase()) ||
      product.keywords.some((keyword) => wanted === keyword),
  );
}

/** Which product a canonical docs URL belongs to. */
export function productForDocUrl(url: string): PostHogProduct | undefined {
  return POSTHOG_PRODUCTS.find((product) => product.docs.includes(url));
}

/**
 * The products a piece of text is about, most-mentioned first. Used on a
 * competitor signal to pick which docs to put in the prompt, and on a model's
 * own action detail to find the docs that could contradict it.
 */
export function matchProducts(text: string, limit = POSTHOG_PRODUCTS.length): PostHogProduct[] {
  const lower = ` ${text.toLowerCase()} `;

  const scored = POSTHOG_PRODUCTS.map((product) => {
    let score = 0;
    for (const keyword of product.keywords) {
      const hits = countOccurrences(lower, keyword);
      // A product's first keywords are its most specific ones, so an early
      // match counts for more than a late one.
      if (hits > 0) score += hits * (product.keywords.indexOf(keyword) === 0 ? 3 : 1);
    }
    if (lower.includes(product.name.toLowerCase())) score += 3;
    return { product, score };
  }).filter((entry) => entry.score > 0);

  scored.sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name));
  return scored.slice(0, limit).map((entry) => entry.product);
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * The docs URLs to put in front of the model for one signal, bounded so a
 * signal that touches everything cannot fill the prompt. Products are taken in
 * relevance order and each contributes its overview page before any of them
 * contributes a second page, so a broad signal still gets breadth.
 */
export function docUrlsForText(
  text: string,
  options: { maxProducts?: number; maxUrls?: number } = {},
): string[] {
  const maxProducts = options.maxProducts ?? 3;
  const maxUrls = options.maxUrls ?? 6;
  const products = matchProducts(text, maxProducts);
  if (products.length === 0) return [];

  const picked: string[] = [];
  const depth = Math.max(...products.map((product) => product.docs.length));

  for (let rank = 0; rank < depth && picked.length < maxUrls; rank += 1) {
    for (const product of products) {
      const url = product.docs[rank];
      if (!url || picked.includes(url)) continue;
      picked.push(url);
      if (picked.length >= maxUrls) break;
    }
  }

  return picked;
}

/** The `feature` an action should name, given the product its docs came from. */
export function featureLabelFor(url: string): string | undefined {
  return productForDocUrl(url)?.name;
}

export function describeProducts(products: PostHogProduct[]): string {
  return truncate(products.map((product) => product.name).join(", "), 200);
}
