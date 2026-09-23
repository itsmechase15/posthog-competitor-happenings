import type { Browser } from "playwright-core";
import { afterAll, describe, expect, it, vi } from "vitest";
import { launchBrowser } from "../src/media/browser.js";
import {
  DEFAULT_TEMPLATE_URLS,
  DRAFT_DIR,
  DRAFT_STAMP,
  isBlogPost,
  MAX_SHOTS,
  nextScroll,
  planDraft,
  scrollDraftExpression,
  sectionHeadings,
  stageDraftExpression,
  templateCandidates,
  type ScrollPosition,
  type StageDraftOutcome,
} from "../src/media/draftPage.js";
import {
  BrowserDraftVisualMaker,
  commitMessage,
  TextOnlyDraftVisualMaker,
  type DraftCapture,
} from "../src/media/draftVisual.js";
import type { AnalyzedItem, RecommendedAction } from "../src/types.js";
import { corpus, EMPTY_CORPUS } from "./helpers.js";

/**
 * The pictures on a `consider_publishing` issue: the draft staged on a real
 * posthog.com post and photographed a screen at a time. The plan needs no
 * browser and is tested flat; the staging runs inside the page, so it is
 * tested against a real Chromium on a page shaped like posthog.com's reader
 * view when the box has one, and skipped when it does not, the way the page
 * before/after is.
 */

const browser: Browser | null = await launchBrowser().catch(() => null);
const withBrowser = browser ? describe : describe.skip;

afterAll(async () => {
  await browser?.close();
});

const CAPTURED_ON = "2026-09-23";

const body = [
  "## Why the SDK still matters",
  "",
  "Sending events from the warehouse skips the SDK, and everything the SDK does on the client goes with it: session ids, autocapture, and flag evaluation before the first request lands.",
  "",
  "- Session replay needs the SDK.",
  "- Feature flags evaluate on the client with it.",
  "",
  "### A smaller point",
  "",
  "> Try both on one product area and compare what you can answer.",
].join("\n");

const piece: RecommendedAction = {
  type: "consider_publishing",
  detail: "Publish a PostHog take on whether to install the SDK or send events from your warehouse.",
  articleTitle: "Should you install the SDK, or send events from your warehouse?",
  articleDraft: `# Should you install the SDK, or send events from your warehouse?\n\n${body}`,
};

const alert: AnalyzedItem = {
  item: {
    id: "1",
    competitor: "amplitude",
    source: "blog",
    externalId: "sdk-or-not",
    title: "Should you install the Amplitude SDK?",
    url: "https://amplitude.com/blog/amplitude-sdk-or-not",
    publishedAt: new Date("2026-09-01T00:00:00Z"),
    raw: {},
  },
  analysis: {
    impact: "minor",
    summary: "Amplitude published a piece on installing its SDK versus warehouse-only ingestion.",
    keyPoints: [],
    actions: [piece],
    posthogRefs: [],
    openQuestions: [],
  },
  model: "claude-opus-5",
};

describe("planDraft", () => {
  const plan = planDraft(piece, CAPTURED_ON);

  it("plans nothing for an action with no draft", () => {
    expect(planDraft({ ...piece, articleDraft: undefined }, CAPTURED_ON)).toBeNull();
    expect(planDraft({ type: "consider_building", detail: "Build it." }, CAPTURED_ON)).toBeNull();
  });

  it("takes the title off the action and the leading heading off the body", () => {
    expect(plan?.title).toBe("Should you install the SDK, or send events from your warehouse?");
    expect(plan?.body.startsWith("## Why the SDK still matters")).toBe(true);
  });

  it("carries the body as HTML for the post's container, and its headings for the table of contents", () => {
    expect(plan?.html).toContain("<h2>Why the SDK still matters</h2>");
    expect(plan?.html).toContain("<li>Session replay needs the SDK.</li>");
    expect(plan?.headings).toEqual(["Why the SDK still matters", "A smaller point"]);
  });

  it("names each file under the day, by the headline and a hash", () => {
    expect(plan?.pathFor(0)).toMatch(
      new RegExp(`^${DRAFT_DIR}/${CAPTURED_ON}/should-you-install-the-sdk-[a-z-]+-[0-9a-f]{10}-1\\.png$`),
    );
    expect(plan?.pathFor(1)).toMatch(/-2\.png$/);
  });

  it("gives a rewritten draft, or another day, its own files", () => {
    const revised = planDraft({ ...piece, articleDraft: `${piece.articleDraft}\n\nOne more line.` }, CAPTURED_ON);
    expect(revised?.pathFor(0)).not.toBe(plan?.pathFor(0));
    expect(planDraft(piece, "2026-09-24")?.pathFor(0)).not.toBe(plan?.pathFor(0));
    expect(planDraft(piece, CAPTURED_ON)?.pathFor(0)).toBe(plan?.pathFor(0));
  });

  it("says in the alt text what the shot is and which part of the piece", () => {
    expect(plan?.altFor(0, 1)).toBe(
      'Draft of "Should you install the SDK, or send events from your warehouse?", staged on a posthog.com blog page',
    );
    expect(plan?.altFor(1, 3)).toContain("part 2 of 3");
  });

  it("falls back to the draft's own heading when the action has no title", () => {
    expect(planDraft({ ...piece, articleTitle: undefined }, CAPTURED_ON)?.title).toBe(
      "Should you install the SDK, or send events from your warehouse?",
    );
  });

  it("writes the dash PostHog writes, even when the draft did not", () => {
    const dashed = planDraft({ ...piece, articleDraft: "# One — two\n\nThree — four." }, CAPTURED_ON);
    expect(dashed?.title).toBe("Should you install the SDK, or send events from your warehouse?");
    expect(dashed?.html).toContain("Three \u2013 four.");
    expect(dashed?.html).not.toContain("\u2014");
  });
});

describe("sectionHeadings", () => {
  it("lists the h2 and h3 lines in order, marks stripped, and skips the h1", () => {
    expect(sectionHeadings("# Title\n\n## First **bold**\n\ntext\n\n### Second `code`\n\n#### Fourth")).toEqual([
      "First bold",
      "Second code",
    ]);
  });
});

describe("templateCandidates", () => {
  const NEAREST = "https://posthog.com/blog/sdk-or-warehouse";
  const LONG = "https://posthog.com/blog/a-long-explainer";
  const SHORT = "https://posthog.com/blog/a-stub";
  const index = corpus(
    { url: LONG, kind: "marketing", title: "Long", text: "word ".repeat(600) },
    { url: SHORT, kind: "marketing", title: "Short", text: "too short to be a post" },
    { url: "https://posthog.com/blog/explainers", kind: "marketing", title: "Category", text: "word ".repeat(600) },
    { url: NEAREST, kind: "marketing", title: "Nearest", text: "word ".repeat(600) },
    { url: "https://posthog.com/docs/libraries", title: "SDKs", text: "word ".repeat(600) },
    { url: "https://posthog.com/tutorials/import-events", kind: "marketing", title: "Tutorial", text: "word ".repeat(600) },
  );

  it("borrows the layout from the post nearest the draft first, then the corpus's long posts, then the known one", () => {
    expect(templateCandidates({ ...piece, similarPages: [NEAREST, "https://posthog.com/tutorials/import-events"] }, index)).toEqual([
      NEAREST,
      LONG,
      "https://posthog.com/blog/explainers",
      ...DEFAULT_TEMPLATE_URLS,
    ]);
    expect(templateCandidates(piece, corpus({ url: SHORT, kind: "marketing", title: "Short", text: "stub" }))).toEqual(
      DEFAULT_TEMPLATE_URLS,
    );
  });

  it("falls back to the known post with no corpus", () => {
    expect(templateCandidates(piece, null)).toEqual(DEFAULT_TEMPLATE_URLS);
    expect(templateCandidates(piece, EMPTY_CORPUS)).toEqual(DEFAULT_TEMPLATE_URLS);
  });

  it("knows a post from the blog index, a category page, and the rest of the site", () => {
    expect(isBlogPost(LONG)).toBe(true);
    expect(isBlogPost("https://posthog.com/blog")).toBe(false);
    expect(isBlogPost("https://posthog.com/blog/explainers")).toBe(true);
    expect(isBlogPost("https://posthog.com/tutorials/x")).toBe(false);
    expect(isBlogPost("https://amplitude.com/blog/x")).toBe(false);
  });
});

describe("nextScroll", () => {
  const at = (overrides: Partial<ScrollPosition>): ScrollPosition => ({
    scrollTop: 0,
    viewportHeight: 1200,
    covered: 56,
    bottom: 3000,
    ...overrides,
  });

  it("steps down by a screen less the chrome pinned over the top", () => {
    expect(nextScroll(at({}), 0)).toBe(1144);
    expect(nextScroll(at({ scrollTop: 1144 }), 1144)).toBe(2288);
  });

  it("stops once the draft's end is on screen", () => {
    expect(nextScroll(at({ scrollTop: 2288 }), 2288)).toBeNull();
    expect(nextScroll(at({ bottom: 900 }), 0)).toBeNull();
  });

  it("stops when the page would not scroll as far as asked", () => {
    expect(nextScroll(at({ scrollTop: 1000 }), 1144)).toBeNull();
  });

  it("stops rather than loop when the chrome covers the whole window", () => {
    expect(nextScroll(at({ covered: 1200 }), 0)).toBeNull();
  });
});

/** A file store that commits whatever it is given, at a URL it makes up. */
function filesFor(url: string | null) {
  return {
    description: "test store",
    put: vi.fn(async (path: string, _bytes: Buffer, _message: string) =>
      url === null ? null : `${url}/${path}`,
    ),
  };
}

const RAW = "https://raw.githubusercontent.com/o/r/main";
const STAGED_ON = DEFAULT_TEMPLATE_URLS[0] as string;

describe("BrowserDraftVisualMaker", () => {
  it("photographs a piece to publish and hands back one URL per shot, in order, naming the post it was staged on", async () => {
    const files = filesFor(RAW);
    const maker = new BrowserDraftVisualMaker(null, files, "agent", async () => ({
      status: "captured",
      shots: [Buffer.from("one"), Buffer.from("two")],
      stagedOn: STAGED_ON,
    }));
    const visual = await maker.make(alert, piece);
    expect(visual?.shots).toHaveLength(2);
    expect(visual?.shots[0]?.url).toMatch(new RegExp(`^${RAW}/${DRAFT_DIR}/.*-1\\.png$`));
    expect(visual?.shots[1]?.alt).toContain("part 2 of 2");
    expect(visual?.stagedOn).toBe(STAGED_ON);
    expect(visual?.wordCount).toBeGreaterThan(0);
    expect(files.put).toHaveBeenCalledTimes(2);
    expect(files.put.mock.calls[0]?.[2]).toContain("[skip ci]");
  });

  it("hands the capture the posts to try, nearest first", async () => {
    const capture = vi.fn<DraftCapture>(async () => ({ status: "skipped", reason: "test" }));
    const maker = new BrowserDraftVisualMaker(null, filesFor(RAW), "agent", capture);
    await maker.make(alert, { ...piece, similarPages: ["https://posthog.com/blog/nearest"] });
    expect(capture.mock.calls[0]?.[1]).toEqual(["https://posthog.com/blog/nearest", ...DEFAULT_TEMPLATE_URLS]);
  });

  it("makes nothing for any other action", async () => {
    const maker = new BrowserDraftVisualMaker(null, filesFor(RAW), "agent", async () => ({
      status: "captured",
      shots: [Buffer.from("x")],
      stagedOn: STAGED_ON,
    }));
    expect(await maker.make(alert, { type: "consider_building", detail: "Build it." })).toBeNull();
  });

  it("files the draft in text when there is no browser, and when no post will take it", async () => {
    const thrown = new BrowserDraftVisualMaker(null, filesFor(RAW), "agent", async () => {
      throw new Error("no Chromium to photograph with");
    });
    const visual = await thrown.make(alert, piece);
    expect(visual?.shots).toEqual([]);
    expect(visual?.title).toBe(piece.articleTitle);
    expect(visual?.stagedOn).toBeUndefined();

    const skipped = new BrowserDraftVisualMaker(null, filesFor(RAW), "agent", async () => ({
      status: "skipped",
      reason: "the page has no article body to put the draft in",
    }));
    expect((await skipped.make(alert, piece))?.shots).toEqual([]);
  });

  it("drops every shot when one will not commit, rather than posting a piece with its ending missing", async () => {
    const files = { description: "flaky", put: vi.fn() };
    files.put.mockResolvedValueOnce(`${RAW}/a-1.png`).mockResolvedValueOnce(null);
    const maker = new BrowserDraftVisualMaker(null, files, "agent", async () => ({
      status: "captured",
      shots: [Buffer.from("one"), Buffer.from("two")],
      stagedOn: STAGED_ON,
    }));
    const visual = await maker.make(alert, piece);
    expect(visual?.shots).toEqual([]);
    expect(files.put).toHaveBeenCalledTimes(2);
  });

  it("writes a commit message that says what the picture is", () => {
    const plan = planDraft(piece, CAPTURED_ON)!;
    const message = commitMessage(plan, 1, 3);
    expect(message).toContain("part 2 of 3");
    expect(message).toContain("staged on a posthog.com blog post");
    expect(message).toContain("Published nowhere");
    expect(message).toContain("[skip ci]");
  });
});

describe("TextOnlyDraftVisualMaker", () => {
  it("plans the draft without pictures", async () => {
    const visual = await new TextOnlyDraftVisualMaker("no browser").make(alert, piece);
    expect(visual?.shots).toEqual([]);
    expect(visual?.title).toBe(piece.articleTitle);
    expect(await new TextOnlyDraftVisualMaker("x").make(alert, { type: "update_pages", detail: "Fix it." })).toBeNull();
  });
});

/**
 * A page shaped like posthog.com's reader view: a fixed header, a scrolling
 * viewport inside the window rather than the window itself, a hero image, the
 * headline, a byline with authors and a date, two tables of contents built
 * from the post's headings, the article body in `.reader-content-container`,
 * and a cookie banner pinned to the bottom corner.
 */
const READER_VIEW = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Product engineer vs software engineer</title>
<style>
  html, body { margin: 0; height: 100%; font: 16px/1.6 system-ui, sans-serif; }
  header { position: fixed; top: 0; left: 0; right: 0; height: 56px; background: #1d1f27; color: #fff; z-index: 10; }
  .viewport { position: absolute; top: 56px; bottom: 0; left: 0; right: 0; overflow-y: auto; }
  .prose { max-width: 680px; margin: 0 auto; padding: 24px; }
  #cookies { position: fixed; right: 16px; bottom: 16px; width: 300px; height: 120px; background: #fff; border: 1px solid #ccc; }
</style></head>
<body>
<header>PostHog</header>
<div class="viewport">
<main><article class="prose">
  <aside id="jump"><h4>Jump to:</h4><ul><li><button>Old heading one</button></li><li><button>Old heading two</button></li></ul></aside>
  <div class="hero"><img alt="hero" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" /></div>
  <h1 class="mx-auto max-w-2xl">Product engineer vs software engineer: How are they different?</h1>
  <div class="byline"><ul><li><a href="/community/profiles/1">Ian Vanagas</a></li><li><a href="/community/profiles/2">Jina Yoon</a></li></ul><p class="date">Dec 08, 2025</p><ul><li><a href="/blog/explainers">Explainers</a></li></ul></div>
  <div id="mobile-toc"><h4>Contents</h4><ul><li><button>Old heading one</button></li><li><button>Old heading two</button></li></ul></div>
  <div class="reader-content-container"><div class="inner">
    <p>Software companies were once dominated by two roles.</p>
    <h2>Old heading one</h2>
    <p>${"Words about the old post. ".repeat(80)}</p>
    <h2>Old heading two</h2>
    <p>${"More words about the old post. ".repeat(80)}</p>
  </div></div>
</article></main>
</div>
<div id="cookies">Legally-required cookie banner</div>
</body></html>`;

withBrowser("stageDraft, in a real browser", () => {
  const plan = planDraft(piece, CAPTURED_ON)!;
  const input = { title: plan.title, html: plan.html, headings: plan.headings, stamp: DRAFT_STAMP, date: "Draft, 2026-09-23" };

  async function staged(html = plan.html) {
    const context = await (browser as Browser).newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.setContent(READER_VIEW);
    const outcome = await page.evaluate<StageDraftOutcome>(stageDraftExpression({ ...input, html }));
    return { context, page, outcome };
  }

  it("turns the post into the draft: headline, body, stamp, byline, tables of contents", async () => {
    const { context, page, outcome } = await staged();
    try {
      expect(outcome).toEqual({ status: "ok" });
      expect(await page.textContent("h1")).toBe(plan.title);
      expect(await page.innerHTML(".reader-content-container .inner")).toContain("<h2>Why the SDK still matters</h2>");
      expect(await page.textContent("[data-happenings-draft-stamp]")).toBe(DRAFT_STAMP);
      // The stamp sits in the headline's column and directly above it.
      expect(await page.getAttribute("[data-happenings-draft-stamp]", "class")).toBe("mx-auto max-w-2xl");
      expect(await page.evaluate(() => document.querySelector("[data-happenings-draft-stamp]")?.nextElementSibling?.tagName)).toBe("H1");
      // The borrowed post's authors go, its date becomes the draft's, its categories stay.
      expect(await page.isVisible('a[href="/community/profiles/1"]')).toBe(false);
      expect(await page.textContent(".date")).toBe("Draft, 2026-09-23");
      expect(await page.isVisible('a[href="/blog/explainers"]')).toBe(true);
      // Both tables of contents list the draft's headings now.
      expect(await page.$$eval("#jump button", (buttons) => buttons.map((b) => b.textContent))).toEqual(plan.headings);
      expect(await page.$$eval("#mobile-toc button", (buttons) => buttons.map((b) => b.textContent))).toEqual(plan.headings);
      // The hero image and the cookie banner are out of the picture; the header stays.
      expect(await page.isVisible(".hero")).toBe(false);
      expect(await page.isVisible("#cookies")).toBe(false);
      expect(await page.isVisible("header")).toBe(true);
    } finally {
      await context.close();
    }
  });

  it("scrolls the element that scrolls, and measures the chrome pinned over the article", async () => {
    // A draft long enough to need more than one screen.
    const { context, page } = await staged(plan.html.repeat(8));
    try {
      const top = await page.evaluate<ScrollPosition>(scrollDraftExpression(0));
      expect(top.scrollTop).toBe(0);
      expect(top.viewportHeight).toBe(900 - 56);
      expect(top.bottom).toBeGreaterThan(top.viewportHeight);
      // The header is fixed to the window, above the scrolling viewport, so it covers none of it.
      expect(top.covered).toBe(0);
      const down = await page.evaluate<ScrollPosition>(scrollDraftExpression(500));
      expect(down.scrollTop).toBe(500);
      expect(down.bottom).toBe(top.bottom);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    } finally {
      await context.close();
    }
  });

  it("refuses a page with no article body rather than photograph half a swap", async () => {
    const context = await (browser as Browser).newContext();
    const page = await context.newPage();
    try {
      await page.setContent("<main><h1>Title</h1><p>one</p></main>");
      const outcome = await page.evaluate<StageDraftOutcome>(stageDraftExpression(input));
      expect(outcome).toEqual({ status: "failed", reason: "the page has no article body to put the draft in" });
      await page.setContent("<main><div><p>a</p><p>b</p><p>c</p></div></main>");
      expect(await page.evaluate<StageDraftOutcome>(stageDraftExpression(input))).toEqual({
        status: "failed",
        reason: "the page has no headline to replace",
      });
    } finally {
      await context.close();
    }
  });

  it("caps a long draft at the shot limit", () => {
    let shots = 0;
    let asked = 0;
    for (;;) {
      shots += 1;
      const next = nextScroll({ scrollTop: asked, viewportHeight: 1200, covered: 0, bottom: 100_000 }, asked);
      if (next === null || shots >= MAX_SHOTS) break;
      asked = next;
    }
    expect(shots).toBe(MAX_SHOTS);
  });
});
