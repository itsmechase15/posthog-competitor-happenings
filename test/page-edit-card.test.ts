import { describe, expect, it, vi } from "vitest";
import { buildIssueBody, buildIssueDraft } from "../src/github/issue.js";
import {
  cardPath,
  CorpusEditCardMaker,
  NoEditCardMaker,
  TextOnlyEditCardMaker,
  type EditCardMaker,
} from "../src/media/cards.js";
import {
  buildPageEditPlans,
  highlightUrl,
  renderCardHtml,
  toCard,
} from "../src/media/pageEdit.js";
import type {
  AnalyzedItem,
  FeatureImage,
  PageEditCard,
  PostHogRef,
  RecommendedAction,
} from "../src/types.js";
import { corpus, EMPTY_CORPUS } from "./helpers.js";

/**
 * The before/after card on an `update_pages` issue.
 *
 * Everything here is built from the corpus copy the evidence gate matched, so
 * the tests hold a corpus page and assert that what the card shows is on it.
 * The other half of the job is that a missing picture is survivable: a render
 * that throws, an upload that fails, and a page the corpus never held all have
 * to leave an issue somebody can still act on.
 */

const PAGE_URL = "https://posthog.com/compare/best-amplitude-alternatives";

const PAGE_TEXT = [
  "PostHog and Amplitude both run A/B tests on the same event data you already send.",
  "Both tools require manual experiment management, so a test runs until somebody remembers to end it.",
  "Pricing is usage-based on both sides, and PostHog bills product analytics separately from experiments.",
].join(" ");

const CLAIM =
  "Both tools require manual experiment management, so a test runs until somebody remembers to end it";

const PROPOSED =
  "Amplitude schedules an experiment to stop on a date you pick. PostHog experiments stop when you stop them, so a fixed-length test needs someone to end it.";

const index = corpus({
  url: PAGE_URL,
  title: "The best Amplitude alternatives, compared",
  kind: "marketing",
  text: PAGE_TEXT,
});

const pageRef: PostHogRef = {
  url: PAGE_URL,
  claim: CLAIM,
  suggestedEdit: "Say that Amplitude schedules a stop and PostHog does not.",
  proposedText: PROPOSED,
};

const pageAction: RecommendedAction = {
  type: "update_pages",
  detail: "The compare page says neither tool schedules a stop. Amplitude now does.",
};

const productAction: RecommendedAction = {
  type: "consider_enhancing",
  feature: "Experiments",
  gap: "PostHog experiments stop by hand.",
  evidenceUrl: "https://posthog.com/docs/experiments/managing-lifecycle",
  evidenceQuote: "Experiments are started, paused, and stopped by hand.",
  detail: "A scheduled stop is a small form change.",
};

const alert: AnalyzedItem = {
  item: {
    id: "1",
    competitor: "amplitude",
    source: "changelog",
    externalId: "guid-1",
    title: "Schedule experiment stop",
    url: "https://fixture.invalid/releases/schedule-experiment-stop",
    publishedAt: new Date("2026-01-15T00:00:00Z"),
    raw: {},
  },
  analysis: {
    impact: "notable",
    summary: "Amplitude experiments can now be scheduled to stop on their own.",
    keyPoints: ["Set a start time, an end time, or both."],
    actions: [pageAction, productAction],
    posthogRefs: [
      pageRef,
      {
        url: "https://posthog.com/docs/experiments/managing-lifecycle",
        claim: "Experiments are started, paused, and stopped by hand.",
      },
    ],
    openQuestions: [],
  },
  model: "claude-opus-5",
};

const image: FeatureImage = {
  url: "https://cdn.invalid/hero.png",
  altText: "Amplitude: Schedule experiment stop",
  origin: "page",
};

const png = Buffer.from("not really a png");

function stubFiles(url: string | null): { put: ReturnType<typeof vi.fn> } {
  return { put: vi.fn(async () => url) };
}

function filesFor(url: string | null) {
  return { description: "test store", ...stubFiles(url) };
}

describe("a page edit read off the corpus", () => {
  const [plan] = buildPageEditPlans(pageAction, [pageRef], index);

  it("names the page by its title and where the copy sits, not by its URL alone", () => {
    expect(plan?.pageTitle).toBe("The best Amplitude alternatives, compared");
    expect(plan?.path).toBe("/compare/best-amplitude-alternatives");
  });

  /**
   * The quote the gate matched is punctuation-folded, so the line has to be
   * grown back out to the sentence it came from. A card that stops one full
   * stop short reads as a rendering fault on the one thing it has to be
   * trusted about.
   */
  it("shows the whole sentence from the page, not the folded quote", () => {
    expect(plan?.oldLine).toBe(`${CLAIM}.`);
    expect(PAGE_TEXT).toContain(plan?.oldLine);
  });

  it("puts the page's own copy either side of the edit", () => {
    expect(plan?.contextAbove).toBe(
      "PostHog and Amplitude both run A/B tests on the same event data you already send.",
    );
    expect(plan?.contextBelow).toBe(
      "Pricing is usage-based on both sides, and PostHog bills product analytics separately from experiments.",
    );
  });

  it("diffs a replacement as a line out and a line in", () => {
    expect(plan?.mode).toBe("replace");
    expect(plan?.diff).toBe(`- ${CLAIM}.\n+ ${PROPOSED}`);
  });

  it("carries the rewrite whole, because that is the deliverable", () => {
    expect(plan?.proposedText).toBe(PROPOSED);
  });

  it("links the live page scrolled to the line as it reads today", () => {
    expect(plan?.highlightUrl).toContain(`${PAGE_URL}#:~:text=`);
    expect(plan?.highlightUrl).toContain("Both%20tools%20require");
  });

  /**
   * A rewrite that keeps the quoted line and adds to it is an insert. Diffing
   * it as a replace would print a `-` against copy nobody asked to delete.
   */
  it("reads a rewrite that keeps the current line as an insert", () => {
    const [insert] = buildPageEditPlans(
      pageAction,
      [{ ...pageRef, proposedText: `${CLAIM}.\nAmplitude added a scheduled stop.` }],
      index,
    );
    expect(insert?.mode).toBe("insert");
    expect(insert?.diff).toBe(`  ${CLAIM}.\n+ Amplitude added a scheduled stop.`);
    expect(insert?.newLines).toEqual(["Amplitude added a scheduled stop."]);
  });

  it("escapes a fragment's own punctuation, so the link still matches", () => {
    expect(highlightUrl("https://posthog.com/pricing", "Pay-as-you-go, after the free tier")).toBe(
      "https://posthog.com/pricing#:~:text=Pay%2Das%2Dyou%2Dgo%2C%20after%20the%20free%20tier",
    );
  });

  it("asks for no fragment when the line is too short for a browser to match", () => {
    expect(highlightUrl(PAGE_URL, "Both tools")).toBeNull();
  });
});

describe("which actions get a card", () => {
  it("builds one for an update_pages action", () => {
    expect(buildPageEditPlans(pageAction, [pageRef], index)).toHaveLength(1);
  });

  it.each(["consider_enhancing", "consider_building", "new_compare_page"] as const)(
    "builds none for a %s action",
    (type) => {
      expect(buildPageEditPlans({ ...pageAction, type }, [pageRef], index)).toEqual([]);
    },
  );

  it("builds none for a docs page, which is evidence rather than copy to edit", () => {
    const docsRef: PostHogRef = {
      url: "https://posthog.com/docs/experiments/managing-lifecycle",
      claim: "Experiments are started, paused, and stopped by hand.",
      proposedText: "Experiments can be scheduled to stop.",
    };
    expect(buildPageEditPlans(pageAction, [docsRef], index)).toEqual([]);
  });

  it("builds none for a ref with no replacement copy on it", () => {
    expect(buildPageEditPlans(pageAction, [{ url: PAGE_URL, claim: CLAIM }], index)).toEqual([]);
  });

  /**
   * The surrounding copy has to come off a page we hold. Picking it off a page
   * the corpus never read would mean showing a marketer context nobody checked.
   */
  it("builds none for a page the corpus does not hold", () => {
    expect(buildPageEditPlans(pageAction, [pageRef], EMPTY_CORPUS)).toEqual([]);
  });
});

describe("the card as HTML", () => {
  const [plan] = buildPageEditPlans(pageAction, [pageRef], index);

  it("renders both sides of the edit, with the page's own copy around them", () => {
    const html = renderCardHtml(plan as NonNullable<typeof plan>);
    expect(html).toContain(CLAIM);
    expect(html).toContain("Amplitude schedules an experiment to stop on a date you pick.");
    expect(html).toContain(">Before<");
    expect(html).toContain(">After<");
    expect(html).toContain("PostHog and Amplitude both run A/B tests");
  });

  it("marks where new copy goes on an insert, and only on an insert", () => {
    const [insert] = buildPageEditPlans(
      pageAction,
      [{ ...pageRef, proposedText: `${CLAIM}.\nAmplitude added a scheduled stop.` }],
      index,
    );
    expect(renderCardHtml(insert as NonNullable<typeof insert>)).toContain("new copy goes here");
    expect(renderCardHtml(plan as NonNullable<typeof plan>)).not.toContain("new copy goes here");
  });

  it("uses the bundled font when it was read, and the system stack when it was not", () => {
    const withFont = renderCardHtml(plan as NonNullable<typeof plan>, {
      fontCss: "@font-face { font-family: 'Inter'; }",
    });
    expect(withFont).toContain("@font-face");
    expect(withFont).toContain("font-family: Inter,");
    expect(renderCardHtml(plan as NonNullable<typeof plan>)).not.toContain("font-family: Inter,");
  });

  it("escapes copy, so a page that quotes HTML does not rewrite the card", () => {
    const [risky] = buildPageEditPlans(
      pageAction,
      [{ ...pageRef, proposedText: '<script>alert("x")</script> Use the SDK.' }],
      index,
    );
    const html = renderCardHtml(risky as NonNullable<typeof risky>);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  /** Same plan, same bytes: that is what lets the file name be a hash of it. */
  it("is stable, so an unchanged edit keeps the file it already has", () => {
    const html = renderCardHtml(plan as NonNullable<typeof plan>, { renderedOn: "2026-09-16" });
    const again = renderCardHtml(plan as NonNullable<typeof plan>, { renderedOn: "2026-09-16" });
    const day = new Date("2026-09-16T09:00:00Z");
    expect(cardPath(plan as NonNullable<typeof plan>, html, day)).toBe(
      cardPath(plan as NonNullable<typeof plan>, again, day),
    );
  });

  it("files a card under the day and the page it belongs to", () => {
    const html = renderCardHtml(plan as NonNullable<typeof plan>);
    expect(cardPath(plan as NonNullable<typeof plan>, html, new Date("2026-09-16T09:00:00Z"))).toMatch(
      /^artifacts\/update-pages\/2026-09-16\/compare-best-amplitude-alternatives-[0-9a-f]{8}\.png$/,
    );
  });
});

describe("making the cards for one action", () => {
  it("renders, commits, and hands back the URL the issue embeds", async () => {
    const files = filesFor(
      "https://raw.githubusercontent.com/o/r/main/artifacts/update-pages/2026-09-16/compare-x.png",
    );
    const maker = new CorpusEditCardMaker(index, files, async () => png, () => new Date("2026-09-16T09:00:00Z"));

    const [card] = await maker.cardsFor(alert, pageAction);
    expect(card?.imageUrl).toBe(
      "https://raw.githubusercontent.com/o/r/main/artifacts/update-pages/2026-09-16/compare-x.png",
    );
    expect(files.put).toHaveBeenCalledOnce();
    const [path, bytes, message] = files.put.mock.calls[0] as [string, Buffer, string];
    expect(path).toContain("artifacts/update-pages/2026-09-16/");
    expect(bytes).toBe(png);
    expect(message).toContain("/compare/best-amplitude-alternatives");
  });

  it("makes no cards at all for an action that is not a page edit", async () => {
    const files = filesFor("https://raw.invalid/card.png");
    const maker = new CorpusEditCardMaker(index, files, async () => png);
    expect(await maker.cardsFor(alert, productAction)).toEqual([]);
    expect(files.put).not.toHaveBeenCalled();
  });

  /**
   * The contract of the whole feature: a picture is the point of a card and
   * never the only copy of it. A render that throws costs the image and
   * nothing else.
   */
  it("keeps the card when the render fails, without its picture", async () => {
    const files = filesFor("https://raw.invalid/card.png");
    const maker = new CorpusEditCardMaker(index, files, async () => {
      throw new Error("no Chromium to render with");
    });

    const [card] = await maker.cardsFor(alert, pageAction);
    expect(card?.imageUrl).toBeNull();
    expect(card?.diff).toContain(`+ ${PROPOSED}`);
    expect(card?.proposedText).toBe(PROPOSED);
    expect(files.put).not.toHaveBeenCalled();
  });

  it("keeps the card when the commit fails, without its picture", async () => {
    const maker = new CorpusEditCardMaker(index, filesFor(null), async () => png);
    const [card] = await maker.cardsFor(alert, pageAction);
    expect(card?.imageUrl).toBeNull();
    expect(card?.proposedText).toBe(PROPOSED);
  });

  it("has a text-only maker for when there is nothing to render with", async () => {
    const maker = new TextOnlyEditCardMaker(index, "no browser");
    const [card] = await maker.cardsFor(alert, pageAction);
    expect(card?.imageUrl).toBeNull();
    expect(card?.diff).toContain(`- ${CLAIM}.`);
  });

  it("has a maker that makes nothing, for callers with no corpus", async () => {
    const maker: EditCardMaker = new NoEditCardMaker();
    expect(await maker.cardsFor(alert, pageAction)).toEqual([]);
  });
});

describe("the card in the issue body", () => {
  const cards = buildPageEditPlans(pageAction, [pageRef], index).map((plan) =>
    toCard(plan, "https://raw.githubusercontent.com/o/r/main/artifacts/update-pages/x.png"),
  );
  const body = buildIssueBody(alert, image, pageAction, cards);

  it("heads the section with the page title and the path", () => {
    expect(body).toContain(
      "### The best Amplitude alternatives, compared \u2013 /compare/best-amplitude-alternatives",
    );
  });

  it("says what the edit does in one line, in the analyst's words", () => {
    expect(body).toContain(
      "**What this edit does** \u2013 Say that Amplitude schedules a stop and PostHog does not.",
    );
  });

  /** Inline, so a marketer sees the change in the issue rather than a link to it. */
  it("embeds the PNG as an image", () => {
    expect(body).toContain(
      "![Before and after for /compare/best-amplitude-alternatives: Say that Amplitude schedules a stop and PostHog does not.](https://raw.githubusercontent.com/o/r/main/artifacts/update-pages/x.png)",
    );
  });

  it("shows the same edit as a diff GitHub colours", () => {
    expect(body).toContain(`\`\`\`diff\n- ${CLAIM}.\n+ ${PROPOSED}\n\`\`\``);
  });

  it("gives the copy to paste whole, in a block that selects cleanly", () => {
    expect(body).toContain(`**Paste this**\n\n\`\`\`text\n${PROPOSED}\n\`\`\``);
  });

  it("widens the fence when the copy itself has backticks in it", () => {
    const [risky] = buildPageEditPlans(
      pageAction,
      [{ ...pageRef, proposedText: "Call ```posthog.capture()``` first." }],
      index,
    );
    const withCode = buildIssueBody(alert, image, pageAction, [
      toCard(risky as NonNullable<typeof risky>, null),
    ]);
    expect(withCode).toContain(
      "````text\nCall ```posthog.capture()``` first.\n````",
    );
  });

  it("links the page with today's line highlighted", () => {
    expect(body).toContain(
      "[Open /compare/best-amplitude-alternatives with today's line highlighted](https://posthog.com/compare/best-amplitude-alternatives#:~:text=",
    );
  });

  it("opens the issue without an image when the card lost its picture", () => {
    const textOnly = buildPageEditPlans(pageAction, [pageRef], index).map((plan) =>
      toCard(plan, null),
    );
    const fallback = buildIssueBody(alert, image, pageAction, textOnly);
    expect(fallback).not.toContain("raw.githubusercontent.com");
    expect(fallback).toContain(`\`\`\`diff\n- ${CLAIM}.`);
    expect(fallback).toContain("**Paste this**");
    expect(fallback).toContain(PROPOSED);
  });

  /**
   * A before/after on a product issue would draw the docs paragraph the gap
   * was read off as if it were the change being asked for.
   */
  it("never puts a card on an action that is not a page edit", () => {
    const product = buildIssueDraft(alert, image, productAction, cards as PageEditCard[]).body;
    expect(product).not.toContain("raw.githubusercontent.com/o/r/main/artifacts");
    expect(product).not.toContain("**Paste this**");
  });

  it("keeps the quoted-copy shape for a page with no card", () => {
    const uncarded = buildIssueBody(alert, image, pageAction, []);
    expect(uncarded).toContain(`### ${PAGE_URL}`);
    expect(uncarded).toContain("**On the page today**");
    expect(uncarded).toContain(PROPOSED);
  });
});
