import { describe, expect, it } from "vitest";
import { detectMentions, extractClaims } from "../src/posthog/corpus.js";
import {
  addDiscoverySource,
  canonicalCorpusUrl,
  changelogEntryUrls,
  classifyCorpusUrl,
  isGone,
  mergeDiscoveries,
  urlsFromLlmsTxt,
  urlsFromSitemap,
} from "../src/posthog/discover.js";
import { CANONICAL_DOC_URLS, MARKETING_PAGE_URLS } from "../src/posthog/products.js";
import { extractPage, proseText } from "../src/util/html.js";
import { HttpError } from "../src/util/http.js";

describe("canonicalCorpusUrl", () => {
  it("collapses the markdown copy of a page onto the page", () => {
    // posthog.com serves /docs/experiments and /docs/experiments.md as one
    // page, and holding both would double the corpus and split its history.
    expect(canonicalCorpusUrl("https://posthog.com/docs/experiments.md")).toBe(
      "https://posthog.com/docs/experiments",
    );
  });

  it("drops the query, the fragment, and a trailing slash", () => {
    expect(canonicalCorpusUrl("https://posthog.com/docs/experiments/?utm_source=x#setup")).toBe(
      "https://posthog.com/docs/experiments",
    );
  });
});

describe("classifyCorpusUrl", () => {
  it("holds the product documentation as docs", () => {
    expect(classifyCorpusUrl("https://posthog.com/docs/experiments/holdouts")).toBe("docs");
    expect(classifyCorpusUrl("https://posthog.com/docs/migrate/mixpanel")).toBe("docs");
  });

  it("holds the pages an action may edit as marketing, not as evidence", () => {
    for (const url of [
      "https://posthog.com/compare/mixpanel-vs-posthog",
      "https://posthog.com/blog/posthog-vs-amplitude",
      "https://posthog.com/tutorials/funnels",
      "https://posthog.com/customers/ycombinator",
      "https://posthog.com/pricing",
      "https://posthog.com/experiments",
    ]) {
      expect(classifyCorpusUrl(url), url).toBe("marketing");
    }
  });

  it("holds PostHog's own changelog as its own kind", () => {
    expect(classifyCorpusUrl("https://posthog.com/changelog")).toBe("changelog");
    expect(classifyCorpusUrl("https://posthog.com/changelog/2026-01-surveys")).toBe("changelog");
  });

  it("keeps community Q&A out, which is most of what the sitemap lists", () => {
    // 7,700 of the sitemap's 13,000 URLs are /questions. They name competitors
    // constantly and are neither marketing copy nor product documentation.
    expect(classifyCorpusUrl("https://posthog.com/questions/posthog-and-mixpanel")).toBeNull();
    expect(classifyCorpusUrl("https://posthog.com/handbook/engineering")).toBeNull();
    expect(classifyCorpusUrl("https://posthog.com/careers/engineer")).toBeNull();
  });

  it("keeps out generated API and SDK reference, which is half of what llms.txt lists", () => {
    // 2,800 pages of near-identical endpoint and type stubs. They would double
    // the corpus, skew the lexical index, and rank as strong matches for
    // generic words, which blocks honest actions on evidence nobody read.
    expect(classifyCorpusUrl("https://posthog.com/docs/api/account-notes")).toBeNull();
    expect(classifyCorpusUrl("https://posthog.com/docs/open-api-spec/account_notes_list")).toBeNull();
    expect(classifyCorpusUrl("https://posthog.com/docs/references/posthog-ios")).toBeNull();
  });

  it("keeps the prose docs that say what PostHog ships, including the long tails", () => {
    // One page per CDP destination and per warehouse source is how "does
    // PostHog export to BigQuery?" gets an answer.
    expect(classifyCorpusUrl("https://posthog.com/docs/cdp/batch-exports/bigquery")).toBe("docs");
    expect(classifyCorpusUrl("https://posthog.com/docs/data-warehouse/cutting-costs")).toBe("docs");
  });

  it("keeps out section indexes and anything that is not a page", () => {
    expect(classifyCorpusUrl("https://posthog.com/docs")).toBeNull();
    expect(classifyCorpusUrl("https://posthog.com/")).toBeNull();
    expect(classifyCorpusUrl("https://posthog.com/sitemap/sitemap-0.xml")).toBeNull();
    expect(classifyCorpusUrl("https://posthog.com/whitepaper.pdf")).toBeNull();
  });

  it("keeps out other hosts", () => {
    expect(classifyCorpusUrl("https://mixpanel.com/blog/anything")).toBeNull();
    expect(classifyCorpusUrl("not a url")).toBeNull();
  });
});

describe("mergeDiscoveries", () => {
  it("keeps every source that offered a URL, because none of them is the corpus", () => {
    const merged = mergeDiscoveries([
      { source: "sitemap", urls: ["https://posthog.com/docs/experiments"] },
      { source: "llms", urls: ["https://posthog.com/docs/experiments.md"] },
      { source: "catalog", urls: ["https://posthog.com/docs/experiments"] },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.sources).toEqual(["sitemap", "llms", "catalog"]);
  });

  it("takes a URL any one source names, even when the others miss it", () => {
    const merged = mergeDiscoveries([
      { source: "sitemap", urls: [] },
      { source: "llms", urls: ["https://posthog.com/docs/surveys/new-thing"] },
    ]);

    expect(merged.map((entry) => entry.url)).toEqual(["https://posthog.com/docs/surveys/new-thing"]);
  });

  it("drops what is not corpus material, whoever offered it", () => {
    const merged = mergeDiscoveries([
      { source: "sitemap", urls: ["https://posthog.com/questions/x", "https://elsewhere.test/y"] },
    ]);
    expect(merged).toEqual([]);
  });
});

describe("addDiscoverySource", () => {
  it("folds the crawl in after the pages it came off were read", () => {
    const existing = mergeDiscoveries([
      { source: "sitemap", urls: ["https://posthog.com/docs/experiments"] },
    ]);
    const withCrawl = addDiscoverySource(existing, "crawl", [
      "https://posthog.com/docs/experiments",
      "https://posthog.com/docs/experiments/holdouts",
    ]);

    expect(withCrawl).toHaveLength(2);
    expect(withCrawl.find((e) => e.url.endsWith("/experiments"))?.sources).toEqual([
      "sitemap",
      "crawl",
    ]);
    expect(withCrawl.find((e) => e.url.endsWith("/holdouts"))?.sources).toEqual(["crawl"]);
  });
});

describe("urlsFromSitemap", () => {
  it("reads a urlset without following anything", () => {
    const xml = `<?xml version="1.0"?><urlset><url><loc>https://posthog.com/docs/a</loc></url><url><loc>https://posthog.com/docs/b</loc></url></urlset>`;
    expect(urlsFromSitemap(xml).urls).toEqual([
      "https://posthog.com/docs/a",
      "https://posthog.com/docs/b",
    ]);
  });

  it("reports an index's children rather than fetching them", () => {
    const xml = `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://posthog.com/sitemap/sitemap-0.xml</loc></sitemap></sitemapindex>`;
    const parsed = urlsFromSitemap(xml);
    expect(parsed.urls).toEqual([]);
    expect(parsed.children).toEqual(["https://posthog.com/sitemap/sitemap-0.xml"]);
  });
});

describe("urlsFromLlmsTxt", () => {
  it("reads both the markdown links and the bare URLs", () => {
    const text = `# PostHog
- [Experiments](https://posthog.com/docs/experiments): run A/B tests
Also see https://posthog.com/docs/surveys.`;

    expect(urlsFromLlmsTxt(text)).toEqual([
      "https://posthog.com/docs/experiments",
      "https://posthog.com/docs/surveys",
    ]);
  });
});

describe("changelogEntryUrls", () => {
  it("takes the changelog's own entries and leaves the rest of the nav", () => {
    const html = `<a href="/changelog/2026-01">January</a><a href="/docs/experiments">Docs</a><a href="https://posthog.com/changelog/2025-12">December</a>`;
    expect(changelogEntryUrls(html, "https://posthog.com/changelog")).toEqual([
      "https://posthog.com/changelog/2026-01",
      "https://posthog.com/changelog/2025-12",
    ]);
  });
});

describe("isGone", () => {
  it("separates a page that has gone from one we merely could not reach", () => {
    expect(isGone(new HttpError(404, "https://posthog.com/docs/x", ""))).toBe(true);
    expect(isGone(new HttpError(410, "https://posthog.com/docs/x", ""))).toBe(true);
    expect(isGone(new HttpError(503, "https://posthog.com/docs/x", ""))).toBe(false);
    expect(isGone(new Error("ECONNRESET"))).toBe(false);
  });
});

describe("the catalog's pinned URLs", () => {
  it("are all corpus material, or the corpus would drop the pages the bot routes to", () => {
    for (const url of [...CANONICAL_DOC_URLS, ...MARKETING_PAGE_URLS]) {
      expect(classifyCorpusUrl(url), url).not.toBeNull();
    }
  });

  it("hold the docs as evidence and the product pages as copy", () => {
    expect(CANONICAL_DOC_URLS.every((url) => classifyCorpusUrl(url) === "docs")).toBe(true);
    expect(MARKETING_PAGE_URLS.every((url) => classifyCorpusUrl(url) === "marketing")).toBe(true);
  });
});

describe("detectMentions", () => {
  it("names the competitors a page talks about", () => {
    expect(detectMentions("PostHog and Mixpanel both do funnels")).toEqual(["mixpanel"]);
    expect(detectMentions("Compared with Amplitude and Mixpanel")).toEqual([
      "mixpanel",
      "amplitude",
    ]);
    expect(detectMentions("Nothing relevant here")).toEqual([]);
  });
});

describe("extractClaims", () => {
  const html = `<html><body><main>
    <h2>Pricing</h2>
    <p>Mixpanel charges per monthly tracked user, which gets expensive once your product grows beyond a hobby project.</p>
    <p>PostHog bills on events, and the first million every month are free of charge for everyone.</p>
    <h2>Replay</h2>
    <p>Short line.</p>
  </main></body></html>`;

  it("takes the paragraphs that name a competitor, tagged with their section", () => {
    const claims = extractClaims("https://posthog.com/compare/mixpanel-vs-posthog", extractPage(html).blocks);

    expect(claims).toHaveLength(1);
    expect(claims[0]?.competitor).toBe("mixpanel");
    expect(claims[0]?.heading).toBe("Pricing");
    expect(claims[0]?.paragraph).toContain("per monthly tracked user");
  });

  it("leaves out a line too short to be a claim anyone could edit", () => {
    const claims = extractClaims("https://posthog.com/x", [
      { heading: null, paragraph: "Mixpanel is fine." },
    ]);
    expect(claims).toEqual([]);
  });
});

describe("proseText", () => {
  it("drops the in-page contents list a docs page opens with", () => {
    const html = `<html><body><main>
      <ul><li>How to schedule a change</li><li>Edit a scheduled change</li></ul>
      <p>You can schedule a feature flag change to happen on a future date.</p>
    </main></body></html>`;

    const text = proseText(extractPage(html).blocks);
    expect(text).toContain("You can schedule a feature flag change");
    expect(text).not.toContain("Edit a scheduled change");
  });
});
