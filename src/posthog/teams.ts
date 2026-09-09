/**
 * PostHog's small teams, as https://posthog.com/teams lists them.
 *
 * PostHog is organized into small teams, not into a product org and an
 * engineering org, so "Product and Engineering" names nobody. Every entry here
 * is a team with a page at /teams/<slug>.
 *
 * `emoji` is the team's spirit animal. It is a real field on the team's page,
 * not a guess: each team picks one from a fixed list of animals, and the page
 * renders it as "🦆 Duck" under a "Spirit animal" heading. Only some teams have
 * picked one, and a team that has not gets no emoji rather than an invented
 * one, so an emoji in an issue is always the team's own.
 *
 * `ownsFeatures` is what the team builds, in PostHog's own words for the
 * feature. It is the first thing routing looks at: a signal about experiments
 * belongs to the team whose page says it owns Experiments. `keywords` is the
 * wider vocabulary of the team's work, for a signal that names no feature.
 *
 * Refreshing this list means reading /teams again. Nothing here is inferred
 * from the app's own product list, so a team PostHog renames or splits stays
 * wrong until someone changes this file.
 */
export interface PostHogTeam {
  /** PostHog's own casing: "Feature Flags", "Wizard & Docs", "People & Ops". */
  name: string;
  /** The path segment on /teams, and the `team:` label slug. */
  slug: string;
  /** The team's spirit animal as unicode. Absent where the team has not picked one. */
  emoji?: string;
  url: string;
  /** Lowercase words in a signal that point at this team's work. */
  keywords?: string[];
  /** The features the team owns, as PostHog names them. */
  ownsFeatures?: string[];
}

export const POSTHOG_TEAMS_URL = "https://posthog.com/teams";

function teamUrl(slug: string): string {
  return `${POSTHOG_TEAMS_URL}/${slug}`;
}

/** Alphabetical by slug, which is the order /teams lists them in. */
export const POSTHOG_TEAMS: PostHogTeam[] = [
  {
    name: "AI Gateway",
    slug: "ai-gateway",
    url: teamUrl("ai-gateway"),
    keywords: ["ai gateway", "model routing", "model provider", "llm proxy", "byok", "inference"],
    ownsFeatures: ["AI gateway"],
  },
  {
    name: "AI Observability",
    slug: "ai-observability",
    url: teamUrl("ai-observability"),
    keywords: [
      "llm analytics",
      "ai observability",
      "llm observability",
      "generation",
      "prompt",
      "token usage",
      "ai agent trace",
      "eval",
    ],
    ownsFeatures: ["LLM analytics", "AI observability"],
  },
  {
    name: "AI Research",
    slug: "ai-research",
    emoji: "🐬",
    url: teamUrl("ai-research"),
    keywords: ["machine learning", "embedding", "clustering", "model training", "semantic search"],
  },
  {
    name: "Analytics Platform",
    slug: "analytics-platform",
    url: teamUrl("analytics-platform"),
    keywords: ["query performance", "query engine", "insight loading", "materialization"],
    ownsFeatures: ["Insights", "Dashboards"],
  },
  {
    name: "APM",
    slug: "apm",
    url: teamUrl("apm"),
    keywords: ["apm", "log", "logging", "log search", "tracing", "span", "latency", "uptime"],
    ownsFeatures: ["Logs", "Traces"],
  },
  {
    name: "Batch Exports",
    slug: "batch-exports",
    url: teamUrl("batch-exports"),
    keywords: ["batch export", "bulk export", "s3 export", "scheduled export"],
    ownsFeatures: ["Batch exports"],
  },
  {
    name: "Billing",
    slug: "billing",
    url: teamUrl("billing"),
    keywords: ["billing", "invoice", "usage limit", "spend", "plan", "quota", "credit"],
    ownsFeatures: ["Billing"],
  },
  {
    name: "Blitzscale",
    slug: "blitzscale",
    url: teamUrl("blitzscale"),
  },
  {
    name: "Builder Relations",
    slug: "builder-relations",
    emoji: "🐒",
    url: teamUrl("builder-relations"),
    keywords: ["community", "hackathon", "meetup", "developer advocacy", "open source community"],
  },
  {
    name: "ClickHouse",
    slug: "clickhouse",
    emoji: "🐻",
    url: teamUrl("clickhouse"),
    keywords: ["clickhouse", "cluster", "columnar store", "data retention", "storage tiering"],
  },
  {
    name: "Client Libraries",
    slug: "client-libraries",
    url: teamUrl("client-libraries"),
    keywords: [
      "sdk",
      "client library",
      "javascript library",
      "react native",
      "ios",
      "android",
      "flutter",
      "autocapture",
    ],
    ownsFeatures: ["SDKs"],
  },
  {
    name: "Cloud Foundations",
    slug: "cloud-foundations",
    emoji: "🦏",
    url: teamUrl("cloud-foundations"),
    keywords: [
      "aws",
      "kubernetes",
      "networking",
      "dns",
      "cloudflare",
      "iam",
      "infrastructure",
      "region",
      "data residency",
    ],
  },
  {
    name: "Cloud Platform",
    slug: "cloud-platform",
    url: teamUrl("cloud-platform"),
    keywords: ["deployment", "ci/cd", "helm chart", "incident management", "self-hosted"],
  },
  {
    name: "Conversations",
    slug: "conversations",
    emoji: "🐙",
    url: teamUrl("conversations"),
    keywords: ["conversation", "shared inbox", "support ticket", "live chat", "in-app message"],
    ownsFeatures: ["Conversations"],
  },
  {
    name: "Customer Analytics",
    slug: "customer-analytics",
    url: teamUrl("customer-analytics"),
    keywords: ["customer context", "user interview", "product-market fit", "account view"],
    ownsFeatures: ["Customer analytics"],
  },
  {
    name: "Customer Success EU",
    slug: "customer-success-eu",
    url: teamUrl("customer-success-eu"),
  },
  {
    name: "Customer Success NA",
    slug: "customer-success-na",
    url: teamUrl("customer-success-na"),
  },
  {
    name: "Data Modeling",
    slug: "data-modeling",
    url: teamUrl("data-modeling"),
    keywords: [
      "data model",
      "materialized view",
      "transformation",
      "dag",
      "saved query",
      "sql view",
    ],
    ownsFeatures: ["Data modeling", "Materialized views", "Endpoints"],
  },
  {
    name: "Data Tools",
    slug: "data-tools",
    emoji: "🦜",
    url: teamUrl("data-tools"),
    keywords: ["sql editor", "hogql", "notebook", "sql query", "ad hoc query"],
    ownsFeatures: ["SQL editor", "Notebooks", "HogQL"],
  },
  {
    name: "Demand Gen",
    slug: "demand-gen",
    url: teamUrl("demand-gen"),
    keywords: ["paid ads", "landing page", "ad campaign", "seo", "demand gen"],
  },
  {
    name: "Developer Experience",
    slug: "developer-experience",
    url: teamUrl("developer-experience"),
    keywords: ["developer experience", "build time", "local development", "internal tooling"],
  },
  {
    name: "Editorial",
    slug: "editorial",
    emoji: "🐓",
    url: teamUrl("editorial"),
    keywords: ["blog", "blog post", "newsletter", "social post", "article", "changelog entry"],
    ownsFeatures: ["Blog", "Newsletter"],
  },
  {
    name: "Error Tracking",
    slug: "error-tracking",
    url: teamUrl("error-tracking"),
    keywords: [
      "error tracking",
      "exception",
      "stack trace",
      "crash report",
      "issue grouping",
      "symbolication",
    ],
    ownsFeatures: ["Error tracking"],
  },
  {
    name: "Experiments",
    slug: "experiments",
    url: teamUrl("experiments"),
    keywords: [
      "experiment",
      "a/b test",
      "ab test",
      "a/b/n",
      "split test",
      "variant",
      "holdout",
      "statistical significance",
      "multivariate test",
    ],
    ownsFeatures: ["Experiments"],
  },
  {
    name: "Feature Flags",
    slug: "feature-flags",
    emoji: "🦫",
    url: teamUrl("feature-flags"),
    keywords: [
      "feature flag",
      "feature gate",
      "rollout",
      "targeting rule",
      "kill switch",
      "release toggle",
      "early access feature",
    ],
    ownsFeatures: ["Feature flags"],
  },
  {
    name: "Forward Deployed Engineering",
    slug: "forward-deployed-engineering",
    url: teamUrl("forward-deployed-engineering"),
    keywords: ["migration project", "implementation project", "guardrail", "diagnostics"],
  },
  {
    name: "Graphics",
    slug: "graphics",
    emoji: "🦐",
    url: teamUrl("graphics"),
    keywords: ["illustration", "artwork", "merch", "team crest", "brand art", "thumbnail art"],
  },
  {
    name: "Growth",
    slug: "growth",
    emoji: "🦦",
    url: teamUrl("growth"),
    keywords: [
      "activation",
      "conversion rate",
      "signup flow",
      "free tier",
      "upgrade",
      "paywall",
      "self-serve",
      "growth loop",
    ],
  },
  {
    name: "GTM Engineering",
    slug: "gtm-engineering",
    emoji: "🐳",
    url: teamUrl("gtm-engineering"),
    keywords: ["crm", "salesforce", "lead routing", "revenue tooling", "sales automation"],
  },
  {
    name: "Ingestion",
    slug: "ingestion",
    url: teamUrl("ingestion"),
    keywords: [
      "ingestion",
      "reverse proxy",
      "proxy",
      "first-party domain",
      "custom domain",
      "subdomain",
      "cname",
      "event capture",
      "event pipeline",
      "ad blocker",
      "rate limit",
      "deduplication",
    ],
    ownsFeatures: ["Ingestion", "Reverse proxy", "Managed reverse proxy"],
  },
  {
    name: "Managed Warehouse",
    slug: "managed-warehouse",
    url: teamUrl("managed-warehouse"),
    keywords: ["data warehouse", "warehouse", "snowflake", "bigquery", "redshift", "table storage"],
    ownsFeatures: ["Data warehouse"],
  },
  {
    name: "Marketing",
    slug: "marketing",
    emoji: "🦆",
    url: teamUrl("marketing"),
    keywords: [
      "compare page",
      "comparison page",
      "marketing page",
      "product marketing",
      "positioning",
      "messaging",
      "pricing page",
      "brand",
    ],
    ownsFeatures: ["Marketing pages", "Compare pages", "Product marketing"],
  },
  {
    name: "MCP Analytics",
    slug: "mcp-analytics",
    url: teamUrl("mcp-analytics"),
    keywords: ["mcp", "model context protocol", "agent tool", "tool call"],
    ownsFeatures: ["MCP server"],
  },
  {
    name: "Onboarding",
    slug: "onboarding",
    url: teamUrl("onboarding"),
    keywords: ["onboarding", "getting started", "first event", "setup checklist", "install flow"],
    ownsFeatures: ["Onboarding"],
  },
  {
    name: "People & Ops",
    slug: "people",
    emoji: "🐂",
    url: teamUrl("people"),
    keywords: ["hiring process", "payroll", "benefits", "internal ops"],
  },
  {
    name: "Platform Features",
    slug: "platform-features",
    emoji: "🦖",
    url: teamUrl("platform-features"),
    keywords: [
      "permission",
      "access control",
      "sso",
      "saml",
      "audit log",
      "organization",
      "project settings",
      "api key",
      "role",
    ],
    ownsFeatures: ["Access control", "SSO", "Audit logs"],
  },
  {
    name: "Platform UX",
    slug: "platform-ux",
    url: teamUrl("platform-ux"),
    keywords: ["navigation", "design system", "in-app ux", "empty state", "keyboard shortcut"],
  },
  {
    name: "PostHog Desktop",
    slug: "posthog-desktop",
    url: teamUrl("posthog-desktop"),
    keywords: ["desktop app", "native app", "menu bar app"],
    ownsFeatures: ["PostHog Desktop"],
  },
  {
    name: "Product Analytics",
    slug: "product-analytics",
    emoji: "🦊",
    url: teamUrl("product-analytics"),
    keywords: [
      "product analytics",
      "funnel",
      "retention",
      "cohort",
      "trend",
      "insight",
      "dashboard",
      "user path",
      "lifecycle",
      "segmentation",
      "breakdown",
    ],
    ownsFeatures: ["Product analytics", "Funnels", "Retention", "Cohorts", "Insights", "Dashboards"],
  },
  {
    name: "Product-Led Sales West",
    slug: "product-led-sales-west",
    url: teamUrl("product-led-sales-west"),
  },
  {
    name: "Replay",
    slug: "replay",
    emoji: "🦮",
    url: teamUrl("replay"),
    keywords: [
      "session replay",
      "session recording",
      "replay",
      "heatmap",
      "screen recording",
      "console log capture",
    ],
    ownsFeatures: ["Session replay", "Replay Vision", "Heatmaps"],
  },
  {
    name: "New Business Sales",
    slug: "sales-cs",
    url: teamUrl("sales-cs"),
  },
  {
    name: "Product-Led Sales East",
    slug: "sales-product-led",
    url: teamUrl("sales-product-led"),
  },
  {
    name: "Security",
    slug: "security",
    url: teamUrl("security"),
    keywords: ["security", "vulnerability", "compliance", "soc 2", "hipaa", "penetration test"],
  },
  {
    name: "Self-Driving",
    slug: "self-driving",
    emoji: "🦧",
    url: teamUrl("self-driving"),
    keywords: ["signal", "anomaly detection", "digest", "automatic insight", "alert inbox"],
    ownsFeatures: ["Signals", "Inbox"],
  },
  {
    name: "Support",
    slug: "support",
    url: teamUrl("support"),
    keywords: ["support request", "help request", "customer question"],
    ownsFeatures: ["Support"],
  },
  {
    name: "Surveys",
    slug: "surveys",
    url: teamUrl("surveys"),
    keywords: ["survey", "nps", "csat", "feedback widget", "in-app poll", "response rate"],
    ownsFeatures: ["Surveys"],
  },
  {
    name: "Talent",
    slug: "talent",
    emoji: "🐸",
    url: teamUrl("talent"),
    keywords: ["recruiting", "candidate", "job ad"],
  },
  {
    name: "Warehouse Sources",
    slug: "warehouse-sources",
    url: teamUrl("warehouse-sources"),
    keywords: [
      "warehouse source",
      "source connector",
      "data import",
      "stripe sync",
      "hubspot sync",
      "postgres source",
      "incremental sync",
    ],
    ownsFeatures: ["Warehouse sources"],
  },
  {
    name: "Web Analytics",
    slug: "web-analytics",
    url: teamUrl("web-analytics"),
    keywords: [
      "web analytics",
      "pageview",
      "bounce rate",
      "utm",
      "referrer",
      "web vitals",
      "session duration",
      "channel attribution",
    ],
    ownsFeatures: ["Web analytics", "Web vitals"],
  },
  {
    name: "Website",
    slug: "website",
    emoji: "🏎️",
    url: teamUrl("website"),
    keywords: ["posthog.com", "website", "site navigation", "page layout", "site build"],
    ownsFeatures: ["posthog.com"],
  },
  {
    name: "Wizard & Docs",
    slug: "wizard-and-docs",
    emoji: "🦉",
    url: teamUrl("wizard-and-docs"),
    keywords: ["docs", "documentation", "tutorial", "api reference", "setup wizard", "code sample"],
    ownsFeatures: ["Docs", "Setup wizard"],
  },
  {
    name: "Workflows",
    slug: "workflows",
    url: teamUrl("workflows"),
    keywords: [
      "workflow",
      "automation",
      "destination",
      "webhook",
      "data pipeline",
      "reverse etl",
      "event delivery",
      "marketing campaign",
      "email send",
      "transformation",
    ],
    ownsFeatures: ["Workflows", "CDP", "Data pipelines", "Destinations", "Messaging"],
  },
  {
    name: "YouTube",
    slug: "youtube",
    url: teamUrl("youtube"),
    emoji: "🐕",
    keywords: ["youtube", "video", "video thumbnail"],
  },
];

/** A team as an issue reads it: "Marketing 🦆", or "Experiments" with no animal picked. */
export function teamLabel(team: PostHogTeam): string {
  return team.emoji ? `${team.name} ${team.emoji}` : team.name;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * A name as a lookup key. Strips the emoji, because a name that came back
 * through a stored issue or a model that copied the rendered label reads as
 * "Marketing 🦆", and that is the same team as "Marketing".
 */
function lookupKey(value: string): string {
  return normalize(
    value
      .replace(/[^\p{Letter}\p{Number}&\-. ]+/gu, " ")
      .replace(/^the\s+/i, "")
      .replace(/\s+team$/i, ""),
  );
}

const BY_KEY = new Map<string, PostHogTeam>(
  POSTHOG_TEAMS.flatMap((team) =>
    [team.slug, team.name, team.name.replace(/&/g, "and")].map(
      (key) => [normalize(key), team] as const,
    ),
  ),
);

/**
 * The team a name or slug refers to, or undefined when it is not one of
 * PostHog's. Forgiving about how a model writes it – "Feature flags",
 * "feature-flags", and "the Feature Flags team" all find the same team – and
 * unforgiving about names that are not on /teams, which is the point: a model
 * that suggests "Platform" or "Core Engineering" gets nothing back.
 */
export function findTeam(name: string): PostHogTeam | undefined {
  const wanted = normalize(name);
  if (!wanted) return undefined;
  return BY_KEY.get(wanted) ?? BY_KEY.get(lookupKey(name));
}

/**
 * The teams that own a feature, by the names their pages use. Matched both
 * ways round so "Feature flags" finds the team that owns "Feature flags" and
 * "PostHog Experiments (A/B testing)" finds Experiments.
 */
export function teamsOwningFeature(feature: string): PostHogTeam[] {
  const wanted = normalize(feature);
  if (!wanted) return [];

  const named = findTeam(feature);
  const owners = POSTHOG_TEAMS.filter((team) =>
    (team.ownsFeatures ?? []).some((owned) => {
      const key = normalize(owned);
      return key === wanted || wanted.includes(key);
    }),
  );

  return [...new Set([...(named ? [named] : []), ...owners])];
}

/**
 * The teams a piece of text is about, most relevant first.
 *
 * An owned feature outscores a keyword, because a team's page saying it owns
 * Experiments is stronger evidence than the word "variant" appearing once.
 */
export function matchTeams(text: string, limit = POSTHOG_TEAMS.length): PostHogTeam[] {
  const haystack = ` ${normalize(text)} `;

  const scored = POSTHOG_TEAMS.map((team) => {
    let score = 0;
    for (const owned of team.ownsFeatures ?? []) {
      if (haystack.includes(normalize(owned))) score += 4;
    }
    for (const keyword of team.keywords ?? []) {
      if (haystack.includes(normalize(keyword))) score += 2;
    }
    return { team, score };
  }).filter((entry) => entry.score > 0);

  scored.sort((a, b) => b.score - a.score || a.team.name.localeCompare(b.team.name));
  return scored.slice(0, limit).map((entry) => entry.team);
}
