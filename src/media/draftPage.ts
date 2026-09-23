import type { Browser } from "playwright-core";
import type { RecommendedAction } from "../types.js";
import { collapseWhitespace, sanitizeCopy, sha1, truncate } from "../util/text.js";
import { renderMarkdown, splitLeadingHeading } from "./markdown.js";
import { captureDate } from "./pageEdit.js";

/**
 * A `consider_publishing` draft laid out as a post and photographed.
 *
 * The `update_pages` before/after is two shots of the live page, because the
 * page exists and the edit is small. A draft is the other case: the page does
 * not exist yet and the copy is the whole thing, so the honest picture is the
 * draft itself, laid out the way a post is laid out, at the width a post is
 * read at. Nothing about it pretends to be posthog.com. The header says it is a
 * draft, the caption in the issue says nothing was published, and the type is
 * whatever the machine has rather than PostHog's own faces, because a picture
 * of the draft in PostHog's fonts would be a picture of a page that was never
 * written.
 *
 * Long drafts come out as several shots, top of the page first, so an issue
 * shows the whole piece at a size somebody can read, and a reader who wants
 * the text has it under the pictures in a fence.
 */

/** Where every draft lands in the repo, so they are one folder to prune. */
export const DRAFT_DIR = "artifacts/consider-publishing";

/**
 * The width a post is read at. Narrower than the compare-page shots, because
 * a column of prose wider than this is a column nobody reads, and the shot is
 * of prose.
 */
export const DRAFT_VIEWPORT = { width: 960, height: 1_280 } as const;

/** How tall one shot of the page is, in CSS pixels. About a screen of reading. */
export const SLICE_HEIGHT = 1_280;

/**
 * How many shots a draft gets. Four screens is a long post; anything past that
 * is in the fence under the pictures, and an issue with eight screenshots in a
 * row is an issue nobody scrolls to the end of.
 */
export const MAX_SHOTS = 4;

/** A page that has not laid itself out in this long is not going to. */
const RENDER_TIMEOUT_MS = 15_000;

/** What one draft's shots are of, and where each file goes. */
export interface DraftPlan {
  title: string;
  /** The draft body without its leading heading, which the page renders as the title. */
  body: string;
  wordCount: number;
  capturedOn: string;
  /** The file for shot `n`, zero-based. */
  pathFor(index: number): string;
  altFor(index: number, total: number): string;
}

/** The page's own path as a file name fragment: "should-you-install-the-sdk". */
function titleSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "draft"
  );
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

/**
 * Plan one draft's shots, or nothing when there is no draft to lay out.
 *
 * The hash covers the title, the whole draft, and the day, so a re-run the
 * same morning reuses the files and a revised draft gets its own.
 */
export function planDraft(action: RecommendedAction, capturedOn = captureDate()): DraftPlan | null {
  const draft = action.articleDraft?.trim();
  if (!draft) return null;

  const { heading, body } = splitLeadingHeading(draft);
  const title = collapseWhitespace(action.articleTitle ?? heading ?? "Untitled draft");
  const digest = sha1(`${title}\n${draft}\n${capturedOn}`).slice(0, 10);
  const stem = `${DRAFT_DIR}/${capturedOn}/${titleSlug(title)}-${digest}`;
  const shortTitle = truncate(title, 90);

  return {
    title,
    body: body.trim(),
    wordCount: countWords(draft),
    capturedOn,
    pathFor: (index) => `${stem}-${index + 1}.png`,
    altFor: (index, total) =>
      total === 1
        ? `Draft of "${shortTitle}", laid out as a post`
        : `Draft of "${shortTitle}", laid out as a post, part ${index + 1} of ${total}`,
  };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The draft as a page: a header saying what it is, the headline, a byline
 * that says draft and the day, and the body. The look is a reading column –
 * the shape a post has on any site – and deliberately not a copy of
 * posthog.com's. See the module comment for why.
 */
export function renderDraftPage(plan: DraftPlan): string {
  const title = escapeHtml(sanitizeCopy(plan.title));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; padding: 0; background: #eeefe9; color: #151515; }
  body { font: 18px/1.65 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
  .frame { max-width: 720px; margin: 0 auto; padding: 32px 24px 64px; }
  .stamp { display: inline-block; font-size: 13px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #151515; background: #f9bd2b; border-radius: 4px; padding: 4px 10px; margin-bottom: 20px; }
  article { background: #fff; border: 1px solid #d0d1c9; border-radius: 8px; padding: 48px 56px; }
  h1 { font-size: 40px; line-height: 1.15; letter-spacing: -0.01em; margin: 0 0 12px; }
  .byline { color: #5b5c58; font-size: 15px; margin: 0 0 32px; padding-bottom: 20px; border-bottom: 1px solid #e5e6e0; }
  h2 { font-size: 28px; line-height: 1.25; margin: 40px 0 12px; }
  h3 { font-size: 22px; line-height: 1.3; margin: 32px 0 8px; }
  h4, h5, h6 { font-size: 18px; margin: 24px 0 8px; }
  p, ul, ol, blockquote, pre { margin: 0 0 20px; }
  li { margin: 0 0 8px; }
  a { color: #f54e00; text-decoration: underline; }
  code { font: 15px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #f3f4ef; border-radius: 4px; padding: 1px 5px; }
  pre { background: #f3f4ef; border-radius: 6px; padding: 16px 18px; overflow: hidden; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 4px solid #f9bd2b; margin-left: 0; padding: 4px 0 4px 20px; color: #3b3c38; }
  hr { border: 0; border-top: 1px solid #e5e6e0; margin: 32px 0; }
</style>
</head>
<body>
<div class="frame">
  <div class="stamp">Draft · not published</div>
  <article>
    <h1>${title}</h1>
    <p class="byline">A draft for posthog.com, ${plan.wordCount} words, written ${escapeHtml(plan.capturedOn)}. Nothing here is live.</p>
    ${renderMarkdown(sanitizeCopy(plan.body))}
  </article>
</div>
</body>
</html>`;
}

/**
 * Where each shot starts and how tall it is, for a page this tall. The last
 * slice is only as tall as what is left, so the final picture is not mostly
 * background; a page taller than the cap allows is cut at the cap, and the
 * fence under the pictures carries the rest.
 */
export function slices(
  pageHeight: number,
  sliceHeight = SLICE_HEIGHT,
  maxShots = MAX_SHOTS,
): Array<{ y: number; height: number }> {
  const out: Array<{ y: number; height: number }> = [];
  for (let y = 0; y < pageHeight && out.length < maxShots; y += sliceHeight) {
    out.push({ y, height: Math.min(sliceHeight, pageHeight - y) });
  }
  return out;
}

export interface DraftCaptureOptions {
  userAgent: string;
}

/**
 * Lay the page out in a headless browser and photograph it in slices.
 *
 * No network: the page is the string above, so nothing is fetched, nothing
 * is routed, and nothing about a third party can change what it looks like
 * between two runs. Throws when the browser will not play along, and the
 * caller files the issue with the draft in text.
 */
export async function captureDraft(
  browser: Browser,
  plan: DraftPlan,
  options: DraftCaptureOptions,
): Promise<Buffer[]> {
  const context = await browser.newContext({
    viewport: { ...DRAFT_VIEWPORT },
    deviceScaleFactor: 2,
    colorScheme: "light",
    reducedMotion: "reduce",
    userAgent: options.userAgent,
  });
  try {
    const page = await context.newPage();
    await page.route("**/*", (route) => route.abort());
    await page.setContent(renderDraftPage(plan), {
      waitUntil: "load",
      timeout: RENDER_TIMEOUT_MS,
    });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const shots: Buffer[] = [];
    for (const slice of slices(height)) {
      shots.push(
        await page.screenshot({
          type: "png",
          fullPage: true,
          clip: { x: 0, y: slice.y, width: DRAFT_VIEWPORT.width, height: slice.height },
        }),
      );
    }
    return shots;
  } finally {
    await context.close().catch(() => undefined);
  }
}
