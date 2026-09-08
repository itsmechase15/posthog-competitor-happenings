import { truncate } from "../util/text.js";

/**
 * A PostHog product: what to call it, where to link it, the words that point
 * at it, and the docs pages that say what it can already do.
 *
 * The docs are why this list is more than a link table. The competitor-mention
 * index is the wrong evidence for "PostHog can't do X": compare pages are
 * marketing copy written at a point in time, and docs are the product. Before
 * the bot recommends building or enhancing anything, the docs for the product
 * it names go in front of the model.
 *
 * `docs` is deliberately short. The first entry is the product's overview page,
 * and the ones after it answer the questions competitors keep shipping
 * against: scheduling, lifecycle, rollout, and statistics. Every URL here is
 * one that has been opened and checked.
 */
export interface PostHogProduct {
  /** PostHog's own casing, which is sentence case: "Feature flags", not "Feature Flags". */
  label: string;
  /**
   * The product marketing page, for an action title that links the product it
   * names. Left off where PostHog has no such page: a feature with no URL
   * stays unlinked, which reads fine, where a guessed URL sends the reader to
   * a 404.
   */
  url?: string;
  /** Other ways a model writes the same product. Matched case-insensitively, like the label. */
  aliases?: string[];
  /** Lowercase substrings in a signal, or in a model's own words, that point here. */
  keywords: string[];
  /** Canonical docs pages, overview first. */
  docs: string[];
}

export const POSTHOG_PRODUCTS: PostHogProduct[] = [
  {
    label: "Experiments",
    url: "https://posthog.com/experiments",
    aliases: ["experiment", "a/b testing", "ab testing"],
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
    label: "Feature flags",
    url: "https://posthog.com/feature-flags",
    aliases: ["feature flag", "feature gates", "feature gating"],
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
    label: "Product analytics",
    url: "https://posthog.com/product-analytics",
    aliases: ["analytics", "insights", "dashboards"],
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
    label: "Web analytics",
    url: "https://posthog.com/web-analytics",
    keywords: ["web analytics", "pageview", "bounce rate", "utm", "referrer", "web vitals"],
    docs: ["https://posthog.com/docs/web-analytics"],
  },
  {
    label: "Session replay",
    url: "https://posthog.com/session-replay",
    aliases: ["session recording", "session recordings", "replays"],
    keywords: ["session replay", "session recording", "replay", "heatmap", "screen recording"],
    docs: [
      "https://posthog.com/docs/session-replay",
      "https://posthog.com/docs/session-replay/how-to-watch-recordings",
    ],
  },
  {
    label: "Surveys",
    url: "https://posthog.com/surveys",
    aliases: ["survey"],
    keywords: ["survey", "nps", "csat", "feedback widget", "in-app poll"],
    docs: ["https://posthog.com/docs/surveys"],
  },
  {
    label: "Error tracking",
    url: "https://posthog.com/error-tracking",
    aliases: ["exception tracking", "issue tracking"],
    keywords: ["error tracking", "exception", "stack trace", "crash report", "issue tracking"],
    docs: ["https://posthog.com/docs/error-tracking"],
  },
  {
    label: "Data warehouse",
    url: "https://posthog.com/data-stack",
    aliases: ["warehouse", "data stack"],
    keywords: ["data warehouse", "warehouse", "snowflake", "bigquery", "redshift", "external data"],
    docs: ["https://posthog.com/docs/data-warehouse"],
  },
  {
    label: "Data pipelines",
    url: "https://posthog.com/cdp",
    aliases: ["cdp", "pipelines", "destinations"],
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
    label: "LLM analytics",
    url: "https://posthog.com/ai-observability",
    aliases: ["ai observability", "llm observability", "llm analytics"],
    keywords: ["llm", "prompt", "token usage", "ai observability", "generation", "trace", "agent"],
    docs: ["https://posthog.com/docs/llm-analytics", "https://posthog.com/docs/ai-engineering"],
  },
  {
    label: "Max AI",
    aliases: ["max"],
    keywords: ["ai assistant", "copilot", "natural language query", "ask ai", "chat with your data"],
    docs: ["https://posthog.com/docs/max-ai"],
  },
  {
    label: "Revenue analytics",
    keywords: ["revenue", "mrr", "arr", "subscription", "stripe", "monetization"],
    docs: ["https://posthog.com/docs/revenue-analytics"],
  },
  {
    label: "Logs",
    url: "https://posthog.com/logs",
    aliases: ["logging"],
    keywords: ["log", "logging", "log search", "observability"],
    docs: ["https://posthog.com/docs/logs"],
  },
  {
    label: "Alerts",
    aliases: ["alerting"],
    keywords: ["alert", "anomaly detection", "threshold", "notification", "subscribe to a report"],
    docs: ["https://posthog.com/docs/alerts", "https://posthog.com/docs/data/annotations"],
  },
  {
    label: "Notebooks",
    keywords: ["notebook", "canvas", "shared analysis"],
    docs: ["https://posthog.com/docs/notebooks"],
  },
];

/**
 * A capability that cuts across products, and the pages that show where
 * PostHog already has it.
 *
 * Products alone are not enough. A signal about scheduling an experiment stop
 * reads as an Experiments signal, but the page that decides whether "PostHog
 * cannot schedule anything" is true belongs to Feature flags. Without these,
 * the docs in context only ever confirm the gap and never qualify it.
 */
export interface PostHogCapability {
  name: string;
  keywords: string[];
  docs: string[];
}

export const POSTHOG_CAPABILITIES: PostHogCapability[] = [
  {
    name: "Scheduling",
    keywords: [
      "schedule",
      "scheduled",
      "scheduling",
      "end date",
      "end time",
      "start date",
      "automatically stop",
      "auto-stop",
      "stop automatically",
      "on a cron",
      "recurring",
      "time-based",
    ],
    docs: [
      "https://posthog.com/docs/feature-flags/scheduled-flag-changes",
      "https://posthog.com/docs/experiments/managing-lifecycle",
    ],
  },
  {
    name: "Alerting",
    keywords: ["alert", "alerting", "notify", "notification", "threshold", "anomaly"],
    docs: ["https://posthog.com/docs/alerts"],
  },
  {
    name: "Automation",
    keywords: ["automation", "workflow", "trigger", "no-code rule", "if this then"],
    docs: ["https://posthog.com/docs/cdp", "https://posthog.com/docs/alerts"],
  },
];

/**
 * Every canonical docs URL, deduplicated. This is the whole set the indexer is
 * asked to keep fresh: a bounded list, not a crawl of posthog.com.
 */
export const CANONICAL_DOC_URLS: string[] = [
  ...new Set([
    ...POSTHOG_PRODUCTS.flatMap((product) => product.docs),
    ...POSTHOG_CAPABILITIES.flatMap((capability) => capability.docs),
  ]),
];

/** A model writes "feature flags", "Feature Flags", and "Feature  Flags" for the same thing. */
function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

const BY_NAME = new Map<string, PostHogProduct>(
  POSTHOG_PRODUCTS.flatMap((product) =>
    [product.label, ...(product.aliases ?? [])].map((name) => [normalize(name), product] as const),
  ),
);

/**
 * The product a feature name refers to, or undefined when the name is not one
 * we recognize. Callers that render a link read `url`, which is only set where
 * PostHog has a product page.
 */
export function findPostHogProduct(feature: string | undefined): PostHogProduct | undefined {
  return feature ? BY_NAME.get(normalize(feature)) : undefined;
}

/**
 * The same lookup, but forgiving, for a feature name a model wrote in its own
 * words: "PostHog Experiments (A/B testing)" has to find Experiments.
 */
export function findProductByName(name: string): PostHogProduct | undefined {
  const wanted = normalize(name);
  if (!wanted) return undefined;

  const exact = findPostHogProduct(name);
  if (exact) return exact;

  return POSTHOG_PRODUCTS.find(
    (product) =>
      wanted.includes(normalize(product.label)) ||
      (product.aliases ?? []).some((alias) => wanted.includes(normalize(alias))) ||
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
    // Only when the label is not already one of the keywords, so a product
    // whose name is its own first keyword is not counted twice.
    const label = normalize(product.label);
    if (!product.keywords.includes(label) && lower.includes(label)) score += 3;
    return { product, score };
  }).filter((entry) => entry.score > 0);

  scored.sort((a, b) => b.score - a.score || a.product.label.localeCompare(b.product.label));
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

/** The cross-product capabilities a piece of text is about. */
export function matchCapabilities(text: string): PostHogCapability[] {
  const lower = ` ${text.toLowerCase()} `;
  return POSTHOG_CAPABILITIES.filter((capability) =>
    capability.keywords.some((keyword) => lower.includes(keyword)),
  );
}

/**
 * The docs URLs to put in front of the model for one signal, bounded so a
 * signal that touches everything cannot fill the prompt.
 *
 * Capability pages come first: they are what tells "PostHog cannot schedule
 * anything" apart from "flags schedule, experiments do not". Products follow in
 * relevance order, each contributing its overview page before any of them
 * contributes a second, so a broad signal still gets breadth.
 */
export function docUrlsForText(
  text: string,
  options: { maxProducts?: number; maxUrls?: number; maxCapabilityUrls?: number } = {},
): string[] {
  const maxProducts = options.maxProducts ?? 3;
  const maxUrls = options.maxUrls ?? 6;
  const maxCapabilityUrls = options.maxCapabilityUrls ?? 3;
  const products = matchProducts(text, maxProducts);
  if (products.length === 0) return [];

  const picked: string[] = [];
  const add = (url: string | undefined): void => {
    if (!url || picked.includes(url) || picked.length >= maxUrls) return;
    picked.push(url);
  };

  const capabilityUrls = [
    ...new Set(matchCapabilities(text).flatMap((capability) => capability.docs)),
  ].slice(0, maxCapabilityUrls);
  for (const url of capabilityUrls) add(url);

  const depth = Math.max(...products.map((product) => product.docs.length));
  for (let rank = 0; rank < depth && picked.length < maxUrls; rank += 1) {
    for (const product of products) add(product.docs[rank]);
  }

  return picked;
}

/** The `feature` an action should name, given the product its docs came from. */
export function featureLabelFor(url: string): string | undefined {
  return productForDocUrl(url)?.label;
}

export function describeProducts(products: PostHogProduct[]): string {
  return truncate(products.map((product) => product.label).join(", "), 200);
}
