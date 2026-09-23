import { describe, expect, it } from "vitest";
import {
  articleProblem,
  articleQuery,
  asksAQuestion,
  countWords,
  EDITORIAL_DIRS,
  isEditorialUrl,
  isHowTo,
  MIN_ARTICLE_WORDS,
  sharedThesis,
  similarPieces,
  thesisTerms,
  thesisWordsNeeded,
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

describe("thesisTerms", () => {
  it("keeps the distinctive words of a headline and drops the shape of a title", () => {
    expect(thesisTerms("Should you install the SDK, or send events from your warehouse?")).toEqual([
      "instal",
      "sdk",
      "send",
      "event",
      "warehous",
    ]);
    expect(thesisTerms("The ultimate guide to PostHog vs Amplitude in 2026")).toEqual(["amplitud"]);
  });

  it("asks for half the thesis, and never fewer than two words", () => {
    expect(thesisWordsNeeded(["a", "b", "c", "d", "e"])).toBe(3);
    expect(thesisWordsNeeded(["a", "b"])).toBe(2);
    expect(thesisWordsNeeded(["a"])).toBe(2);
  });

  it("reads the words a page's title shares with the thesis", () => {
    expect(sharedThesis(["instal", "sdk", "warehous"], "Installing the SDK in a warehouse-first stack")).toEqual([
      "instal",
      "sdk",
      "warehous",
    ]);
  });
});

describe("asksAQuestion and isHowTo", () => {
  it("knows a question piece by its shape", () => {
    expect(asksAQuestion("Should you install the SDK, or send events from your warehouse?")).toBe(true);
    expect(asksAQuestion("Why we don't use cookies")).toBe(true);
    expect(asksAQuestion("Is your funnel lying to you")).toBe(true);
    expect(asksAQuestion("The case for installing the SDK")).toBe(false);
    expect(asksAQuestion("How to send warehouse events to PostHog")).toBe(false);
  });

  it("knows a how-to by where it lives or how it opens", () => {
    expect(isHowTo("https://posthog.com/tutorials/anything", "Warehouse events, end to end")).toBe(true);
    expect(isHowTo("https://posthog.com/blog/x", "How to send warehouse events to PostHog")).toBe(true);
    expect(isHowTo("https://posthog.com/blog/x", "Should you send warehouse events?")).toBe(false);
    expect(isHowTo("not a url", "How to do it")).toBe(true);
  });
});

/**
 * The Amplitude SDK case, as it went wrong on 2026-09-23. The product verdict
 * was right, the analyst recommended a piece, and the gate blocked it because
 * three PostHog pages the analyst had not opened scored near the top of a body
 * search for the draft's words: a Django set-up tutorial, a data study, and an
 * RSS how-to. None of them asks the reader whether to install an SDK. A page
 * that does must still count.
 */
describe("similarPieces", () => {
  const DJANGO = "https://posthog.com/tutorials/django-analytics";
  const DATA_STUDY = "https://posthog.com/blog/writing-a-data-study";
  const RSS = "https://posthog.com/tutorials/rss-items";
  const WAREHOUSE_HOWTO = "https://posthog.com/blog/how-to-send-warehouse-events";
  const REAL_MATCH = "https://posthog.com/blog/sdk-or-warehouse";
  const PRODUCT = "https://posthog.com/product-analytics";

  const areaWords =
    "Install the PostHog SDK, send events, and set up feature flags. Events land in your warehouse and the SDK captures the rest. Install the SDK with pip, send an event, check the warehouse. ";

  const falseFriends = [
    {
      url: DJANGO,
      title: "Setting up Django analytics, feature flags, and more",
      kind: "marketing" as const,
      text: areaWords.repeat(3),
    },
    {
      url: DATA_STUDY,
      title: "The behind the scenes of writing a data study",
      kind: "marketing" as const,
      text: `${areaWords.repeat(2)} We pulled events from the warehouse and the SDK to write the study.`,
    },
    {
      url: RSS,
      title: "How to capture new RSS items in PostHog",
      kind: "marketing" as const,
      text: `${areaWords.repeat(2)} Capture each RSS item as an event with the SDK or from your warehouse.`,
    },
    {
      url: WAREHOUSE_HOWTO,
      title: "How to send warehouse events to PostHog",
      kind: "marketing" as const,
      text: "A walkthrough of sending events from a data warehouse into PostHog without installing the SDK.",
    },
    {
      url: PRODUCT,
      title: "Product analytics",
      kind: "marketing" as const,
      text: "Install the SDK and send events from anywhere, warehouse included, to analyze them.",
    },
    {
      url: "https://posthog.com/docs/libraries",
      title: "SDKs",
      text: "Install the SDK for your platform. Events from a warehouse arrive through the batch import.",
    },
  ];

  const realMatch = {
    url: REAL_MATCH,
    title: "Should you install the PostHog SDK or send events from your warehouse?",
    kind: "marketing" as const,
    text: "Install the SDK or send events from your warehouse: the case for each, and what you lose without the SDK on the client.",
  };

  it("does not take a Django tutorial, a data study, or an RSS how-to for a piece on whether to install the SDK", () => {
    const index = corpus(...falseFriends);
    // They are what a body search finds: the words are all there.
    expect(index.search(articleQuery(piece), { kinds: ["marketing"] }).map((hit) => hit.url)).toContain(DJANGO);
    expect(similarPieces(piece, index, new Set())).toEqual({ strong: [], unread: [] });
  });

  it("does not take a how-to on one side of the question for the question", () => {
    const index = corpus(falseFriends[3] as (typeof falseFriends)[number]);
    expect(similarPieces(piece, index, new Set())).toEqual({ strong: [], unread: [] });
  });

  it("takes a PostHog post whose own headline asks the same question, and only that one", () => {
    const index = corpus(...falseFriends, realMatch);
    const found = similarPieces(piece, index, new Set());
    expect(found.strong.map((hit) => hit.url)).toEqual([REAL_MATCH]);
    expect(found.unread.map((hit) => hit.url)).toEqual([REAL_MATCH]);
  });

  it("only blocks on the pieces the analysis never opened", () => {
    const index = corpus(...falseFriends, realMatch);
    const found = similarPieces(piece, index, new Set([REAL_MATCH]));
    expect(found.strong.map((hit) => hit.url)).toEqual([REAL_MATCH]);
    expect(found.unread).toEqual([]);
  });

  it("still holds a piece that is not a question to the same half-the-headline bar", () => {
    const opinion = {
      ...piece,
      articleTitle: "The case for installing the SDK before you touch the warehouse",
    };
    const sameCase = {
      url: "https://posthog.com/blog/case-for-the-sdk",
      title: "The case for installing an SDK, warehouse or not",
      kind: "marketing" as const,
      text: "Installing the SDK first, and sending warehouse events after.",
    };
    const found = similarPieces(opinion, corpus(...falseFriends, sameCase), new Set());
    expect(found.strong.map((hit) => hit.url)).toEqual([sameCase.url]);
  });

  it("finds nothing in an empty corpus, or for a headline with too few words to be a thesis", () => {
    const index = corpus(...falseFriends, realMatch);
    expect(similarPieces(piece, EMPTY_CORPUS, new Set())).toEqual({ strong: [], unread: [] });
    expect(
      similarPieces({ ...piece, articleTitle: "", detail: "the" }, index, new Set()),
    ).toEqual({ strong: [], unread: [] });
    expect(similarPieces({ ...piece, articleTitle: "SDKs" }, index, new Set())).toEqual({
      strong: [],
      unread: [],
    });
  });

  it("searches on the headline and the ask", () => {
    expect(articleQuery(piece)).toContain("Should you install the SDK");
    expect(articleQuery(piece)).toContain("Publish a PostHog take");
  });
});
