import { describe, expect, it, vi } from "vitest";
import { buildIssueBody, buildIssueDraft } from "../src/github/issue.js";
import {
  buildPageEditPlans,
  highlightUrl,
  planPageEdit,
  visualPaths,
} from "../src/media/pageEdit.js";
import {
  BrowserPageVisualMaker,
  commitMessage,
  NoPageVisualMaker,
  TextOnlyPageVisualMaker,
  type PageVisualMaker,
} from "../src/media/visual.js";
import type { CaptureResult } from "../src/media/livePage.js";
import type {
  AnalyzedItem,
  FeatureImage,
  PageEditPlan,
  PageEditVisual,
  PostHogRef,
  RecommendedAction,
} from "../src/types.js";
import { corpus, EMPTY_CORPUS } from "./helpers.js";

/**
 * The before/after on an `update_pages` issue: two screenshots of the live
 * page, the second with the proposed copy staged in a browser and published
 * nowhere.
 *
 * The plan is still read off the corpus, because the line to look for is the
 * sentence the evidence gate matched, so the tests hold a corpus page. The
 * other half of the job is that missing pictures are survivable: a browser
 * that will not start, a page that has moved on, a commit that is refused –
 * each has to leave an issue somebody can still act on.
 */

const PAGE_URL = "https://posthog.com/compare/best-amplitude-alternatives";
const CAPTURED_ON = "2026-09-16";

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

const before = Buffer.from("before png");
const after = Buffer.from("after png");

const plans = (capturedOn = CAPTURED_ON): PageEditPlan[] =>
  buildPageEditPlans(pageAction, [pageRef], index, capturedOn);

const onlyPlan = (): PageEditPlan => plans()[0] as PageEditPlan;

/** A file store that commits whatever it is given, at a URL it makes up. */
function filesFor(url: string | null) {
  return {
    description: "test store",
    put: vi.fn(async (path: string) => (url === null ? null : `${url}/${path}`)),
  };
}

function maker(
  files: ReturnType<typeof filesFor>,
  capture: () => Promise<CaptureResult[]>,
): BrowserPageVisualMaker {
  return new BrowserPageVisualMaker(index, files, "test-agent", capture);
}

const captured: CaptureResult = { status: "captured", before, after };

describe("a page edit planned off the corpus", () => {
  const plan = onlyPlan();

  it("names the page by its title and where the copy sits, not by its URL alone", () => {
    expect(plan.pageTitle).toBe("The best Amplitude alternatives, compared");
    expect(plan.path).toBe("/compare/best-amplitude-alternatives");
  });

  /**
   * The quote the gate matched is punctuation-folded, so the line has to be
   * grown back out to the sentence it came from. Half a sentence swapped into
   * the live page for the after shot leaves the other half dangling.
   */
  it("carries the whole sentence from the page, not the folded quote", () => {
    expect(plan.oldLine).toBe(`${CLAIM}.`);
    expect(PAGE_TEXT).toContain(plan.oldLine);
  });

  it("diffs a replacement as a line out and a line in", () => {
    expect(plan.mode).toBe("replace");
    expect(plan.diff).toBe(`- ${CLAIM}.\n+ ${PROPOSED}`);
  });

  it("carries the rewrite whole, because that is the deliverable", () => {
    expect(plan.proposedText).toBe(PROPOSED);
  });

  it("links the live page scrolled to the line as it reads today", () => {
    expect(plan.highlightUrl).toContain(`${PAGE_URL}#:~:text=`);
    expect(plan.highlightUrl).toContain("Both%20tools%20require");
  });

  it("knows the quoted line is on the stored page, which is what makes a live miss news", () => {
    expect(plan.quotedOnStoredPage).toBe(true);
    const unquoted = planPageEdit(
      { ...pageRef, claim: "PostHog schedules experiment stops today." },
      { title: "x", text: PAGE_TEXT },
    );
    expect(unquoted?.quotedOnStoredPage).toBe(false);
  });

  /**
   * A rewrite that keeps the quoted line and adds to it is an insert. Diffing
   * it as a replace would print a `-` against copy nobody asked to delete,
   * and the after shot would delete a line the analyst wanted kept.
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

describe("where the two pngs go", () => {
  it("files a pair under the day, the page, and a hash of the edit", () => {
    const plan = onlyPlan();
    expect(plan.beforePath).toMatch(
      /^artifacts\/update-pages\/2026-09-16\/compare-best-amplitude-alternatives-[0-9a-f]{10}-before\.png$/,
    );
    expect(plan.afterPath).toBe(plan.beforePath.replace("-before.png", "-after.png"));
  });

  /** Same edit, same morning, same files: a second run commits nothing new. */
  it("is stable for the same edit on the same day", () => {
    expect(visualPaths(PAGE_URL, CLAIM, PROPOSED, CAPTURED_ON)).toEqual(
      visualPaths(PAGE_URL, CLAIM, PROPOSED, CAPTURED_ON),
    );
  });

  /**
   * The day is in the hash on purpose. A before shot is only true for the day
   * it was taken, so next week's run photographs the page as it is next week
   * rather than embedding a picture that has gone stale.
   */
  it("is a different pair tomorrow, and for a different rewrite", () => {
    const today = visualPaths(PAGE_URL, CLAIM, PROPOSED, CAPTURED_ON).before;
    expect(visualPaths(PAGE_URL, CLAIM, PROPOSED, "2026-09-23").before).not.toBe(today);
    expect(visualPaths(PAGE_URL, CLAIM, `${PROPOSED} Really.`, CAPTURED_ON).before).not.toBe(today);
  });

  it("says what each file is for, and keeps the commit out of CI", () => {
    const plan = onlyPlan();
    expect(commitMessage(plan, "before")).toContain("as it read on 2026-09-16");
    expect(commitMessage(plan, "after")).toContain("published nowhere");
    expect(commitMessage(plan, "after")).toContain("[skip ci]");
  });
});

describe("which actions get photographed", () => {
  it("plans one for an update_pages action", () => {
    expect(plans()).toHaveLength(1);
  });

  it.each(["consider_enhancing", "consider_building", "new_compare_page"] as const)(
    "plans none for a %s action",
    (type) => {
      expect(buildPageEditPlans({ ...pageAction, type }, [pageRef], index)).toEqual([]);
    },
  );

  it("plans none for a docs page, which is evidence rather than copy to edit", () => {
    const docsRef: PostHogRef = {
      url: "https://posthog.com/docs/experiments/managing-lifecycle",
      claim: "Experiments are started, paused, and stopped by hand.",
      proposedText: "Experiments can be scheduled to stop.",
    };
    expect(buildPageEditPlans(pageAction, [docsRef], index)).toEqual([]);
  });

  it("plans none for a ref with no replacement copy on it", () => {
    expect(buildPageEditPlans(pageAction, [{ url: PAGE_URL, claim: CLAIM }], index)).toEqual([]);
  });

  /**
   * The line to look for on the live page is the sentence the gate matched on
   * the stored page. There is no such sentence for a page we never read.
   */
  it("plans none for a page the corpus does not hold", () => {
    expect(buildPageEditPlans(pageAction, [pageRef], EMPTY_CORPUS)).toEqual([]);
  });
});

describe("photographing one action's page edits", () => {
  it("commits both shots and hands back the URLs the issue embeds", async () => {
    const files = filesFor("https://raw.githubusercontent.com/o/r/main");
    const [visual] = await maker(files, async () => [captured]).make(alert, pageAction);

    expect(visual?.shots?.beforeUrl).toContain("-before.png");
    expect(visual?.shots?.afterUrl).toContain("-after.png");
    expect(files.put).toHaveBeenCalledTimes(2);
    const [path, bytes] = files.put.mock.calls[0] as unknown as [string, Buffer];
    expect(path).toContain("artifacts/update-pages/");
    expect(bytes).toBe(before);
  });

  it("photographs nothing for an action that is not a page edit", async () => {
    const files = filesFor("https://raw.invalid");
    const capture = vi.fn(async () => [captured]);
    expect(await maker(files, capture).make(alert, productAction)).toEqual([]);
    expect(capture).not.toHaveBeenCalled();
    expect(files.put).not.toHaveBeenCalled();
  });

  /**
   * The contract of the whole feature: the pictures are the point and never
   * the only copy of the edit. No browser costs the pictures and nothing else.
   */
  it("keeps the edit when there is no browser, without its pictures", async () => {
    const files = filesFor("https://raw.invalid");
    const [visual] = await maker(files, async () => {
      throw new Error("no Chromium to photograph with");
    }).make(alert, pageAction);

    expect(visual?.shots).toBeNull();
    expect(visual?.diff).toContain(`+ ${PROPOSED}`);
    expect(visual?.proposedText).toBe(PROPOSED);
    expect(files.put).not.toHaveBeenCalled();
  });

  it("keeps the edit when the page will not load, without its pictures", async () => {
    const files = filesFor("https://raw.invalid");
    const [visual] = await maker(files, async () => [
      { status: "skipped", reason: "the page answered 503" },
    ]).make(alert, pageAction);

    expect(visual?.shots).toBeNull();
    expect(visual?.copyMissingLive).toBe(false);
    expect(files.put).not.toHaveBeenCalled();
  });

  /**
   * Half a comparison is worse than none: a before shot captioned as half of
   * a pair, with nothing to compare it to, reads as a broken issue.
   */
  it("drops both pictures when one of the two commits is refused", async () => {
    const files = {
      description: "test store",
      put: vi.fn(async (path: string) => (path.endsWith("-after.png") ? null : "https://raw/x")),
    };
    const [visual] = await maker(files, async () => [captured]).make(alert, pageAction);
    expect(visual?.shots).toBeNull();
  });

  /**
   * The one absence worth saying out loud rather than only logging: the line
   * is on the stored page and gone from the live one, so the page has moved on
   * and the recommendation may have moved with it.
   */
  it("says so when the quoted line is no longer on the live page", async () => {
    const files = filesFor("https://raw.invalid");
    const [visual] = await maker(files, async () => [{ status: "missing" }]).make(
      alert,
      pageAction,
    );

    expect(visual?.shots).toBeNull();
    expect(visual?.copyMissingLive).toBe(true);
  });

  it("has a text-only maker for when nothing should open a browser", async () => {
    const [visual] = await new TextOnlyPageVisualMaker(index, "SKIP_PAGE_VISUALS is set").make(
      alert,
      pageAction,
    );
    expect(visual?.shots).toBeNull();
    expect(visual?.diff).toContain(`- ${CLAIM}.`);
  });

  it("has a maker that makes nothing, for callers with no corpus", async () => {
    const none: PageVisualMaker = new NoPageVisualMaker();
    expect(await none.make(alert, pageAction)).toEqual([]);
  });
});

describe("the before and after in the issue body", () => {
  const shot = (plan: PageEditPlan): PageEditVisual => ({
    ...plan,
    copyMissingLive: false,
    shots: {
      beforeUrl: "https://raw.githubusercontent.com/o/r/main/artifacts/update-pages/x-before.png",
      afterUrl: "https://raw.githubusercontent.com/o/r/main/artifacts/update-pages/x-after.png",
      beforeAlt: plan.beforeAlt,
      afterAlt: plan.afterAlt,
    },
  });

  const visuals = plans().map(shot);
  const body = buildIssueBody(alert, image, pageAction, visuals);

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

  /** Stacked and captioned, so a reader knows which picture is the real page. */
  it("embeds both screenshots, and dates the one that is the real page", () => {
    expect(body).toContain("**Before** \u2013 the live page on 2026-09-16");
    expect(body).toContain(
      "![The best Amplitude alternatives, compared as it reads today, with the quoted line in place](https://raw.githubusercontent.com/o/r/main/artifacts/update-pages/x-before.png)",
    );
    expect(body).toContain(
      "](https://raw.githubusercontent.com/o/r/main/artifacts/update-pages/x-after.png)",
    );
  });

  /**
   * The after shot is a page with words on it nobody has published. Somebody
   * scrolling an issue about a posthog.com page must not come away thinking
   * the edit is live.
   */
  it("says the after shot was staged in a browser and published nowhere", () => {
    expect(body).toContain(
      "**After** \u2013 the same page with the proposed copy staged in a browser only. Nothing was published.",
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
    const withCode = buildIssueBody(alert, image, pageAction, [shot(risky as PageEditPlan)]);
    expect(withCode).toContain("````text\nCall ```posthog.capture()``` first.\n````");
  });

  it("links the page with today's line highlighted", () => {
    expect(body).toContain(
      "[Open /compare/best-amplitude-alternatives with today's line highlighted](https://posthog.com/compare/best-amplitude-alternatives#:~:text=",
    );
  });

  it("opens the issue without pictures when the pair could not be taken", () => {
    const textOnly = plans().map((plan) => ({
      ...plan,
      shots: null,
      copyMissingLive: false,
    }));
    const fallback = buildIssueBody(alert, image, pageAction, textOnly);
    expect(fallback).not.toContain("raw.githubusercontent.com");
    expect(fallback).toContain(`\`\`\`diff\n- ${CLAIM}.`);
    expect(fallback).toContain("**Paste this**");
    expect(fallback).toContain(PROPOSED);
  });

  it("warns when the live page no longer has the copy the edit replaces", () => {
    const moved = plans().map((plan) => ({ ...plan, shots: null, copyMissingLive: true }));
    const warned = buildIssueBody(alert, image, pageAction, moved);
    expect(warned).toContain("was not on the live page on 2026-09-16");
    expect(warned).toContain("read it before you edit it");
    expect(warned).toContain("**Paste this**");
  });

  /**
   * A before/after on a product issue would photograph the docs paragraph the
   * gap was read off as if it were the change being asked for.
   */
  it("never photographs an action that is not a page edit", () => {
    const product = buildIssueDraft(alert, image, productAction, visuals).body;
    expect(product).not.toContain("raw.githubusercontent.com/o/r/main/artifacts");
    expect(product).not.toContain("**Paste this**");
  });

  it("keeps the quoted-copy shape for a page with no plan", () => {
    const unplanned = buildIssueBody(alert, image, pageAction, []);
    expect(unplanned).toContain(`### ${PAGE_URL}`);
    expect(unplanned).toContain("**On the page today**");
    expect(unplanned).toContain(PROPOSED);
  });
});
