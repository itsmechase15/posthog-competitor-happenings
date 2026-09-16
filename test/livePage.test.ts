import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchBrowser } from "../src/media/browser.js";
import {
  captureEdit,
  stageExpression,
  VIEWPORT,
  type StageInput,
  type StageOutcome,
} from "../src/media/livePage.js";
import { planPageEdit } from "../src/media/pageEdit.js";
import type { PostHogRef } from "../src/types.js";

/**
 * The browser half of the before/after, run against fixtures shaped like the
 * markup posthog.com actually serves.
 *
 * Skipped whole when there is no Chromium on the box, so `npm test` stays
 * green on a bare machine. CI installs one, because this is the part that can
 * be wrong: the locate-and-edit function runs inside the page, where a
 * mistake is invisible to the type checker.
 */
const browser: Browser | null = await launchBrowser().catch(() => null);
const withBrowser = browser ? describe : describe.skip;

const CLAIM =
  "Both tools require manual experiment management, so a test runs until somebody remembers to end it.";
const PROPOSED =
  "Amplitude schedules an experiment to stop on a date you pick. PostHog experiments stop when you stop them.";

/** The shape of the page: a nav, a sidebar, and prose with links and code in it. */
const MARKETING_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>The best Amplitude alternatives</title>
<style>
  body { margin: 0; font: 16px/1.6 system-ui, sans-serif; }
  nav { position: sticky; top: 0; height: 56px; background: #1d1f27; color: #fff; }
  aside { position: sticky; top: 56px; float: left; width: 240px; }
  main { margin-left: 260px; padding: 24px 32px; max-width: 720px; }
</style></head>
<body>
<nav>PostHog</nav>
<aside><ul><li>Experiments</li><li>${CLAIM}</li></ul></aside>
<main><article><div class="prose">
<h1>The best Amplitude alternatives, compared</h1>
<p>PostHog and Amplitude both run A/B tests on the event data you already send.</p>
<div><p id="target">Experiments run on your own events. ${CLAIM} See <a href="/docs/experiments">the docs</a> or call <code>posthog.getFeatureFlag()</code>.</p></div>
<p>Pricing is usage-based on both sides.</p>
</div></article></main>
</body></html>`;

const ref = (overrides: Partial<PostHogRef> = {}): PostHogRef => ({
  url: "https://posthog.com/compare/best-amplitude-alternatives",
  claim: CLAIM,
  proposedText: PROPOSED,
  ...overrides,
});

const input = (overrides: Partial<StageInput> = {}): StageInput => ({
  action: "locate",
  oldLine: CLAIM,
  proposedText: PROPOSED,
  mode: "replace",
  ...overrides,
});

const stage = (page: Page, overrides: Partial<StageInput> = {}): Promise<StageOutcome> =>
  page.evaluate<StageOutcome>(stageExpression(input(overrides)));

withBrowser("finding the line on the live page and putting the copy in", () => {
  let page: Page;

  beforeAll(async () => {
    page = await (browser as Browser).newPage({ viewport: { width: 1_280, height: 900 } });
  });

  afterAll(async () => {
    await page?.close().catch(() => undefined);
  });

  const load = async (html = MARKETING_PAGE): Promise<void> => {
    await page.setContent(html, { waitUntil: "load" });
  };

  const targetText = (): Promise<string> =>
    page.evaluate(() => document.querySelector("#target")?.textContent ?? "");

  /** Every run of copy the after shot marks as the recommendation. */
  const marks = () => page.locator("[data-happenings-highlight]");

  it("puts the copy where the quoted line was, and leaves the rest of the paragraph", async () => {
    await load();
    expect((await stage(page)).status).toBe("ok");
    expect((await stage(page, { action: "apply" })).status).toBe("ok");

    const text = await targetText();
    expect(text).toContain(PROPOSED);
    expect(text).not.toContain(CLAIM);
    expect(text).toContain("Experiments run on your own events.");
    // The link and the code sample were never part of the quoted line.
    expect(await page.locator("#target a").count()).toBe(1);
    expect(await page.locator("#target code").innerText()).toBe("posthog.getFeatureFlag()");
  });

  it("edits the prose and not the sidebar copy that repeats it", async () => {
    await load();
    await stage(page);
    await stage(page, { action: "apply" });
    expect(await page.locator("aside li").nth(1).innerText()).toContain(CLAIM);
  });

  it("marks the paragraph rather than the div that wraps it", async () => {
    await load();
    await stage(page);
    expect(await page.locator("p[data-happenings-edit]").count()).toBe(1);
  });

  /** The gate folds punctuation away, so the browser side has to as well. */
  it("matches a line the page punctuates differently", async () => {
    await load();
    const outcome = await stage(page, {
      oldLine:
        "Both  tools require manual experiment management, so a test runs until somebody remembers to end it",
    });
    expect(outcome.status).toBe("ok");
  });

  it("leaves the line alone for an insert and puts the copy next to it", async () => {
    await load();
    await stage(page, { mode: "insert" });
    expect((await stage(page, { action: "apply", mode: "insert" })).status).toBe("ok");

    expect(await targetText()).toContain(CLAIM);
    const inserted = page.locator("[data-happenings-inserted]");
    expect(await inserted.count()).toBe(1);
    expect(await inserted.innerText()).toBe(PROPOSED);
    expect(await inserted.evaluate((node) => node.tagName)).toBe("P");
  });

  it("gives copy written as two paragraphs two paragraphs on the page", async () => {
    await load();
    const copy = `${PROPOSED}\nPostHog will not stop one for you.`;
    await stage(page, { proposedText: copy });
    await stage(page, { action: "apply", proposedText: copy });

    expect(await targetText()).toContain(PROPOSED);
    expect(await page.locator("[data-happenings-inserted]").innerText()).toContain(
      "will not stop one for you",
    );
  });

  /**
   * The mark is the whole reason the after shot is readable at thumbnail size,
   * so it is checked on both paths: what the copy replaced, and what it was
   * added next to. Nothing but the proposed copy is allowed inside one.
   */
  it("highlights the copy it swapped in, and nothing that was already there", async () => {
    await load();
    await stage(page);
    expect(await marks().count()).toBe(0);

    await stage(page, { action: "apply" });
    expect(await marks().count()).toBe(1);
    expect(await marks().innerText()).toBe(PROPOSED);
    expect(await targetText()).toContain("Experiments run on your own events.");
    expect(await page.locator("#target a").count()).toBe(1);
  });

  it("highlights inserted copy, one mark per paragraph of it", async () => {
    await load();
    const copy = `${CLAIM} ${PROPOSED}\nPostHog will not stop one for you.`;
    await stage(page, { mode: "insert", proposedText: copy });
    await stage(page, { action: "apply", mode: "insert", proposedText: copy });

    expect(await marks().count()).toBe(2);
    for (const mark of await marks().all()) {
      expect(await mark.evaluate((node) => node.tagName)).toBe("MARK");
      expect(
        await mark.evaluate((node) => node.closest("[data-happenings-inserted]") !== null),
      ).toBe(true);
    }
    // The line the copy was added next to is not the recommendation, so it
    // keeps the page's own styling.
    expect(await targetText()).toContain(CLAIM);
    const edited = page.locator("[data-happenings-edit]").first();
    expect(await edited.locator("[data-happenings-highlight]").count()).toBe(0);
  });

  /** The page's own `mark` styling must not be able to turn the mark off. */
  it("keeps the highlight visible on a page that styles mark for itself", async () => {
    await load(
      MARKETING_PAGE.replace(
        "</style>",
        "mark { background: transparent !important; color: inherit !important; }</style>",
      ),
    );
    await stage(page);
    await stage(page, { action: "apply" });

    const background = await marks().evaluate(
      (node) => window.getComputedStyle(node).backgroundColor,
    );
    expect(background).toBe("rgb(249, 189, 43)");
  });

  it("says the line is missing when the page does not have it", async () => {
    await load();
    expect(
      (await stage(page, { oldLine: "PostHog deletes your experiments on Friday." })).status,
    ).toBe("missing");
  });

  it("refuses to guess when the line runs across two blocks", async () => {
    await load(
      `<main><p>Both tools require manual experiment management,</p><p>so a test runs until somebody remembers to end it.</p></main>`,
    );
    expect((await stage(page)).status).toBe("split");
  });

  it("puts the page back as it was, so a second pair is not taken of a page half edited", async () => {
    await load();
    const original = await targetText();
    await stage(page);
    await stage(page, { action: "apply" });
    expect((await stage(page, { action: "restore" })).status).toBe("ok");

    expect(await targetText()).toBe(original);
    expect(await page.locator("[data-happenings-inserted]").count()).toBe(0);
    expect(await page.locator("[data-happenings-edit]").count()).toBe(0);
    expect(await marks().count()).toBe(0);
  });

  it("will not apply an edit nothing located, and will not restore one nothing applied", async () => {
    await load();
    expect((await stage(page, { action: "apply" })).status).toBe("failed");
    expect((await stage(page, { action: "restore" })).status).toBe("failed");
  });

  it("scrolls the line into the window and reports where, so both shots match", async () => {
    await load();
    const located = await stage(page);
    if (located.status !== "ok") throw new Error(`the line was ${located.status}`);
    const applied = await stage(page, { action: "apply", scrollY: located.scrollY });
    expect(applied).toMatchObject({ status: "ok", scrollY: located.scrollY });
  });

  it("hides a banner sitting on the paragraph, and keeps the sidebar that is not", async () => {
    await load(
      MARKETING_PAGE.replace(
        "</body>",
        `<div id="chat" style="position: fixed; left: 300px; top: 100px; width: 400px; height: 400px; background: #f9bd2b;">chat</div></body>`,
      ),
    );
    await stage(page);
    expect(await page.locator("#chat").evaluate((node) => node.style.visibility)).toBe("hidden");
    expect(await page.locator("aside").evaluate((node) => node.style.visibility)).toBe("");
  });

  it("measures how far past the window the new copy runs, so the window can grow", async () => {
    await page.setViewportSize({ width: 1_280, height: 300 });
    await load();
    await stage(page);
    const long = Array.from(
      { length: 60 },
      () => "PostHog experiments stop when you stop them.",
    ).join(" ");
    const applied = await stage(page, { action: "apply", proposedText: long });
    if (applied.status !== "ok") throw new Error(`the copy was ${applied.status}`);
    expect(applied.overflowBy).toBeGreaterThan(0);
    await page.setViewportSize({ width: 1_280, height: 900 });
  });
});

withBrowser("photographing the page before and after", () => {
  let server: Server;
  let origin: string;
  let status = 200;
  let body = MARKETING_PAGE;

  beforeAll(async () => {
    server = createServer((_request, response) => {
      response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
      response.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const capture = (overrides: Partial<PostHogRef> = {}) =>
    captureEdit(
      // Planned without a stored page, so the line looked for is the ref's own
      // claim: the fixture server is not posthog.com and the corpus has never
      // heard of it.
      (browser as Browser),
      planPageEdit(ref({ url: `${origin}/compare`, ...overrides }), undefined) as NonNullable<
        ReturnType<typeof planPageEdit>
      >,
      { userAgent: "posthog-competitor-happenings/0.1 (test)" },
    );

  /** A PNG's own idea of how big it is, straight out of the IHDR chunk. */
  const size = (png: Buffer): { width: number; height: number } => ({
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  });

  /**
   * How many pixels of the shot are the highlighter yellow.
   *
   * The point of the mark is that it is visible in the PNG, so the PNG is what
   * is asked. Decoded in the same browser the shot was taken with rather than
   * by adding an image library to a repo that reads changelogs.
   */
  const highlighted = async (png: Buffer): Promise<number> => {
    const decoder = await (browser as Browser).newPage();
    try {
      return await decoder.evaluate(async (source: string) => {
        const image = new Image();
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = reject;
          image.src = source;
        });
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) return -1;
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        let count = 0;
        for (let at = 0; at < data.length; at += 4) {
          const near = (value: number | undefined, wanted: number): boolean =>
            value !== undefined && Math.abs(value - wanted) <= 6;
          if (near(data[at], 0xf9) && near(data[at + 1], 0xbd) && near(data[at + 2], 0x2b)) {
            count += 1;
          }
        }
        return count;
      }, `data:image/png;base64,${png.toString("base64")}`);
    } finally {
      await decoder.close().catch(() => undefined);
    }
  };

  it("comes back with two different pngs of the same page", async () => {
    status = 200;
    body = MARKETING_PAGE;
    const result = await capture();

    expect(result.status).toBe("captured");
    if (result.status !== "captured") return;
    for (const png of [result.before, result.after]) {
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      expect(png.byteLength).toBeGreaterThan(1_000);
    }
    expect(result.before.equals(result.after)).toBe(false);
  });

  /**
   * The mark is only worth anything if it survives as far as the file the
   * issue embeds, so it is counted there: yellow in the after shot, none of it
   * in the before.
   */
  it("puts the highlight in the after shot and leaves the before as the page reads", async () => {
    status = 200;
    body = MARKETING_PAGE;
    const result = await capture();

    expect(result.status).toBe("captured");
    if (result.status !== "captured") return;
    expect(await highlighted(result.before)).toBe(0);
    expect(await highlighted(result.after)).toBeGreaterThan(1_000);
  });

  /**
   * Copy that overran the window is re-shot in a taller one, and the pair is
   * only a pair if both sides grew together. The mark has to come back with
   * it: the second attempt puts the page back and stages the edit again.
   */
  it("keeps the highlight when the window grows for copy that overran it", async () => {
    status = 200;
    body = MARKETING_PAGE;
    const long = Array.from(
      { length: 100 },
      () => "PostHog experiments stop when you stop them.",
    ).join(" ");
    const result = await capture({ proposedText: long });

    expect(result.status).toBe("captured");
    if (result.status !== "captured") return;
    expect(size(result.after)).toEqual(size(result.before));
    expect(size(result.after).height).toBeGreaterThan(VIEWPORT.height * 2);
    expect(await highlighted(result.before)).toBe(0);
    expect(await highlighted(result.after)).toBeGreaterThan(1_000);
  });

  it("says the line is missing when the live page has moved on", async () => {
    status = 200;
    body = MARKETING_PAGE.replaceAll(
      CLAIM,
      "Amplitude schedules a stop, and so does PostHog now.",
    );
    expect((await capture()).status).toBe("missing");
  });

  it("gives up quietly on a page that answers with an error", async () => {
    status = 503;
    body = "<html><body>down</body></html>";
    const result = await capture();
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") expect(result.reason).toContain("503");
  });
});

afterAll(async () => {
  await browser?.close().catch(() => undefined);
});
