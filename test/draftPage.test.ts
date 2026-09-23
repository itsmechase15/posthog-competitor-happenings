import type { Browser } from "playwright-core";
import { afterAll, describe, expect, it, vi } from "vitest";
import { launchBrowser } from "../src/media/browser.js";
import {
  captureDraft,
  DRAFT_DIR,
  DRAFT_VIEWPORT,
  MAX_SHOTS,
  planDraft,
  renderDraftPage,
  SLICE_HEIGHT,
  slices,
} from "../src/media/draftPage.js";
import {
  BrowserDraftVisualMaker,
  commitMessage,
  TextOnlyDraftVisualMaker,
} from "../src/media/draftVisual.js";
import type { AnalyzedItem, RecommendedAction } from "../src/types.js";

/**
 * The pictures on a `consider_publishing` issue: the draft laid out as a post
 * and photographed a screen at a time. The plan and the page need no browser
 * and are tested flat; the capture is tested against a real Chromium when the
 * box has one, and skipped when it does not, the way the page before/after is.
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

  it("says in the alt text which part of the piece a shot is", () => {
    expect(plan?.altFor(0, 1)).toBe(
      'Draft of "Should you install the SDK, or send events from your warehouse?", laid out as a post',
    );
    expect(plan?.altFor(1, 3)).toContain("part 2 of 3");
  });

  it("falls back to the draft's own heading when the action has no title", () => {
    expect(planDraft({ ...piece, articleTitle: undefined }, CAPTURED_ON)?.title).toBe(
      "Should you install the SDK, or send events from your warehouse?",
    );
  });
});

describe("renderDraftPage", () => {
  const html = renderDraftPage(planDraft(piece, CAPTURED_ON)!);

  it("says it is a draft and prints the headline once", () => {
    expect(html).toContain("Draft · not published");
    expect(html).toContain("Nothing here is live.");
    expect(html.match(/<h1>/g)).toHaveLength(1);
  });

  it("lays the body out as a post", () => {
    expect(html).toContain("<h2>Why the SDK still matters</h2>");
    expect(html).toContain("<li>Session replay needs the SDK.</li>");
    expect(html).toContain("<blockquote>");
  });

  it("writes the dash PostHog writes, even when the draft did not", () => {
    const plan = planDraft({ ...piece, articleDraft: "# T\n\nOne — two." }, CAPTURED_ON)!;
    expect(renderDraftPage(plan)).toContain("One \u2013 two.");
    expect(renderDraftPage(plan)).not.toContain("\u2014");
  });
});

describe("slices", () => {
  it("cuts a tall page into screens, the last only as tall as what is left", () => {
    expect(slices(SLICE_HEIGHT * 2 + 300)).toEqual([
      { y: 0, height: SLICE_HEIGHT },
      { y: SLICE_HEIGHT, height: SLICE_HEIGHT },
      { y: SLICE_HEIGHT * 2, height: 300 },
    ]);
  });

  it("takes a short page in one", () => {
    expect(slices(900)).toEqual([{ y: 0, height: 900 }]);
  });

  it("stops at the cap, and leaves the rest to the text", () => {
    expect(slices(SLICE_HEIGHT * 10)).toHaveLength(MAX_SHOTS);
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

describe("BrowserDraftVisualMaker", () => {
  it("photographs a piece to publish and hands back one URL per shot, in order", async () => {
    const files = filesFor(RAW);
    const maker = new BrowserDraftVisualMaker(files, "agent", async () => [
      Buffer.from("one"),
      Buffer.from("two"),
    ]);
    const visual = await maker.make(alert, piece);
    expect(visual?.shots).toHaveLength(2);
    expect(visual?.shots[0]?.url).toMatch(new RegExp(`^${RAW}/${DRAFT_DIR}/.*-1\\.png$`));
    expect(visual?.shots[1]?.alt).toContain("part 2 of 2");
    expect(visual?.wordCount).toBeGreaterThan(0);
    expect(files.put).toHaveBeenCalledTimes(2);
    expect(files.put.mock.calls[0]?.[2]).toContain("[skip ci]");
  });

  it("makes nothing for any other action", async () => {
    const maker = new BrowserDraftVisualMaker(filesFor(RAW), "agent", async () => [Buffer.from("x")]);
    expect(await maker.make(alert, { type: "consider_building", detail: "Build it." })).toBeNull();
  });

  it("files the draft in text when there is no browser", async () => {
    const maker = new BrowserDraftVisualMaker(filesFor(RAW), "agent", async () => {
      throw new Error("no Chromium to photograph with");
    });
    const visual = await maker.make(alert, piece);
    expect(visual).not.toBeNull();
    expect(visual?.shots).toEqual([]);
    expect(visual?.title).toBe(piece.articleTitle);
  });

  it("drops every shot when one will not commit, rather than posting a piece with its ending missing", async () => {
    const files = { description: "flaky", put: vi.fn() };
    files.put.mockResolvedValueOnce(`${RAW}/a-1.png`).mockResolvedValueOnce(null);
    const maker = new BrowserDraftVisualMaker(files, "agent", async () => [
      Buffer.from("one"),
      Buffer.from("two"),
    ]);
    const visual = await maker.make(alert, piece);
    expect(visual?.shots).toEqual([]);
    expect(files.put).toHaveBeenCalledTimes(2);
  });

  it("writes a commit message that says what the picture is", () => {
    const plan = planDraft(piece, CAPTURED_ON)!;
    const message = commitMessage(plan, 1, 3);
    expect(message).toContain("part 2 of 3");
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

withBrowser("captureDraft, in a real browser", () => {
  it("photographs a short draft in one shot at the reading width", async () => {
    const plan = planDraft(piece, CAPTURED_ON)!;
    const shots = await captureDraft(browser as Browser, plan, { userAgent: "test-agent" });
    expect(shots).toHaveLength(1);
    const png = shots[0] as Buffer;
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    // Width is in the IHDR chunk at byte 16, and the page is shot at 2x.
    expect(png.readUInt32BE(16)).toBe(DRAFT_VIEWPORT.width * 2);
  });

  it("photographs a long draft in several, and no more than the cap", async () => {
    const long = planDraft(
      { ...piece, articleDraft: `# Long\n\n${`${body}\n\n`.repeat(30)}` },
      CAPTURED_ON,
    )!;
    const shots = await captureDraft(browser as Browser, long, { userAgent: "test-agent" });
    expect(shots.length).toBeGreaterThan(1);
    expect(shots.length).toBeLessThanOrEqual(MAX_SHOTS);
  });
});
