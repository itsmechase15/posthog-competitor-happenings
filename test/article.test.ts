import { describe, expect, it } from "vitest";
import {
  articleProblem,
  articleQuery,
  countWords,
  EDITORIAL_DIRS,
  isEditorialUrl,
  MIN_ARTICLE_WORDS,
  similarPieces,
} from "../src/analysis/article.js";
import type { RecommendedAction } from "../src/types.js";
import { corpus, EMPTY_CORPUS } from "./helpers.js";

/**
 * What makes a `consider_publishing` action a draft rather than a request for
 * one, and whether PostHog has already written it. Both are the code half of
 * the rule the prompt states, so both are measured here in the prompt's own
 * numbers.
 */

const paragraph =
  "Sending events straight from your warehouse means you skip the SDK, and you also skip everything the SDK does for you: session ids, autocapture, feature flag evaluation on the client, and the first pageview a visitor makes before your pipeline has heard of them. ";

/** A draft long enough to be one. */
const DRAFT = `# Should you install the SDK, or send events from your warehouse?

${paragraph.repeat(3)}

## What the SDK does that a warehouse cannot

${paragraph.repeat(3)}

## When warehouse-only is the right call

${paragraph.repeat(2)}

Try both on one product area and compare what you can answer.`;

const piece: RecommendedAction = {
  type: "consider_publishing",
  detail:
    "Publish a PostHog take on whether to install the SDK or send events from your warehouse – Amplitude has one, and PostHog's blog has nothing on the choice.",
  articleTitle: "Should you install the SDK, or send events from your warehouse?",
  articleDraft: DRAFT,
};

describe("countWords", () => {
  it("counts runs of non-space, markdown marks and all", () => {
    expect(countWords("# One two\n\nthree **four**")).toBe(5);
    expect(countWords("   ")).toBe(0);
  });
});

describe("isEditorialUrl", () => {
  it("knows PostHog's own writing from the rest of the site", () => {
    expect(isEditorialUrl("https://posthog.com/blog/sdk-or-warehouse")).toBe(true);
    expect(isEditorialUrl("https://posthog.com/tutorials/warehouse-events")).toBe(true);
    expect(isEditorialUrl("https://posthog.com/newsletter/the-sdk-question")).toBe(true);
    expect(isEditorialUrl("https://posthog.com/founders/hiring")).toBe(true);
    expect(isEditorialUrl("https://posthog.com/product-engineers/why-ship")).toBe(true);
  });

  it("does not count a compare page, a product page, or the docs", () => {
    expect(isEditorialUrl("https://posthog.com/compare/amplitude-vs-posthog")).toBe(false);
    expect(isEditorialUrl("https://posthog.com/experiments")).toBe(false);
    expect(isEditorialUrl("https://posthog.com/docs/libraries")).toBe(false);
    expect(isEditorialUrl("https://amplitude.com/blog/amplitude-sdk-or-not")).toBe(false);
    expect(isEditorialUrl("not a url")).toBe(false);
  });

  it("names the same sections as directories the analyst can open", () => {
    expect(EDITORIAL_DIRS).toContain("pages/blog/");
    expect(EDITORIAL_DIRS).toContain("pages/tutorials/");
  });
});

describe("articleProblem", () => {
  it("accepts a titled draft long enough to be one", () => {
    expect(countWords(DRAFT)).toBeGreaterThanOrEqual(MIN_ARTICLE_WORDS);
    expect(articleProblem(piece)).toBeNull();
  });

  it("refuses a piece with no draft, which is a job with the writing left in it", () => {
    expect(articleProblem({ ...piece, articleDraft: undefined })).toMatch(/carries no draft/);
  });

  it("refuses a draft with no headline", () => {
    expect(articleProblem({ ...piece, articleTitle: undefined })).toMatch(/no working title/);
  });

  it("refuses a draft too short to be more than a brief, and says how short", () => {
    const short = articleProblem({ ...piece, articleDraft: paragraph.repeat(2) });
    expect(short).toMatch(/runs \d+ words/);
    expect(short).toContain(`under ${MIN_ARTICLE_WORDS}`);
  });

  it("refuses a draft that opens by describing the post rather than being it", () => {
    const brief = articleProblem({
      ...piece,
      articleDraft: `# Title\n\nThis post should cover the trade-offs of SDK versus warehouse ingestion. ${paragraph.repeat(8)}`,
    });
    expect(brief).toMatch(/opens by describing the post/);
  });
});

describe("similarPieces", () => {
  const BLOG = "https://posthog.com/blog/sdk-or-warehouse";
  const TUTORIAL = "https://posthog.com/tutorials/warehouse-events";
  const PRODUCT = "https://posthog.com/product-analytics";

  const index = corpus(
    {
      url: BLOG,
      title: "Should you install the SDK or send events from your warehouse?",
      kind: "marketing",
      text: "Install the SDK or send events from your warehouse: the case for each, and what you lose without the SDK on the client.",
    },
    {
      url: TUTORIAL,
      title: "How to send warehouse events to PostHog",
      kind: "marketing",
      text: "A tutorial on sending events from a data warehouse into PostHog without installing the SDK.",
    },
    {
      url: PRODUCT,
      title: "Product analytics",
      kind: "marketing",
      text: "Install the SDK and send events from anywhere, warehouse included, to analyze them.",
    },
    {
      url: "https://posthog.com/docs/libraries",
      title: "SDKs",
      text: "Install the SDK for your platform. Events from a warehouse arrive through the batch import.",
    },
  );

  it("finds PostHog's own post on the angle, and only among the editorial sections", () => {
    const found = similarPieces(piece, index, new Set());
    expect(found.strong.map((hit) => hit.url)).toContain(BLOG);
    expect(found.strong.map((hit) => hit.url)).not.toContain(PRODUCT);
    expect(found.strong.map((hit) => hit.url)).not.toContain("https://posthog.com/docs/libraries");
  });

  it("only blocks on the pieces the analysis never opened", () => {
    const found = similarPieces(piece, index, new Set([BLOG, TUTORIAL]));
    expect(found.strong.length).toBeGreaterThan(0);
    expect(found.unread).toEqual([]);
  });

  it("finds nothing in an empty corpus, or for a headline with no words in it", () => {
    expect(similarPieces(piece, EMPTY_CORPUS, new Set())).toEqual({ strong: [], unread: [] });
    expect(
      similarPieces({ ...piece, articleTitle: "", detail: "the" }, index, new Set()),
    ).toEqual({ strong: [], unread: [] });
  });

  it("searches on the headline and the ask", () => {
    expect(articleQuery(piece)).toContain("Should you install the SDK");
    expect(articleQuery(piece)).toContain("Publish a PostHog take");
  });
});
