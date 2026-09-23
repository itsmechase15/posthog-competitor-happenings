import type { Browser } from "playwright-core";
import type { CorpusIndex } from "../posthog/retrieval.js";
import type { RecommendedAction } from "../types.js";
import { collapseWhitespace, sanitizeCopy, sha1, truncate } from "../util/text.js";
import { openLivePage, VIEWPORT, type CaptureOptions } from "./livePage.js";
import { renderMarkdown, splitLeadingHeading } from "./markdown.js";
import { captureDate } from "./pageEdit.js";

/**
 * A `consider_publishing` draft, staged into a real posthog.com blog post and
 * photographed.
 *
 * The `update_pages` before/after opens the live page in a headless browser,
 * puts the proposed copy into that tab's own DOM, and shoots it, so the picture
 * on the issue is posthog.com with the recommendation in it. A draft gets the
 * same treatment for the same reason: a marketer deciding on a piece wants to
 * see it as a post on the site, in the site's type, at the site's width, under
 * the site's navigation, and a reading column in system fonts is a mock of a
 * page rather than the page. So a real PostHog post is opened, its headline
 * becomes the draft's headline, its body becomes the draft, its table of
 * contents becomes the draft's headings, and the page is photographed a screen
 * at a time from the top.
 *
 * What says it is a draft is a stamp above the headline and the byline, not a
 * different page: the authors of the post the layout was borrowed from are
 * hidden, because a draft they did not write must not carry their names, and
 * the date reads as the day the draft was made. The caption on the issue says
 * the rest. **Nothing is published by any of this.** The draft lives in one
 * tab's in-memory DOM between the load and the screenshots, and the tab is
 * thrown away.
 *
 * Which post is borrowed is decided by `templateCandidates`: a PostHog post the
 * corpus ranked nearest the draft first, then any post in the corpus, then a
 * known one, tried in turn until one loads and has an article body to put the
 * draft in. Every path gives up quietly, and the issue carries the draft in a
 * fence either way.
 */

/** Where every draft lands in the repo, so they are one folder to prune. */
export const DRAFT_DIR = "artifacts/consider-publishing";

/** How tall one shot of the page is, in CSS pixels. About a screen of reading. */
export const SLICE_HEIGHT = 1_200;

/**
 * How many shots a draft gets. Four screens is a long post; anything past that
 * is in the fence under the pictures, and an issue with eight screenshots in a
 * row is an issue nobody scrolls to the end of.
 */
export const MAX_SHOTS = 4;

/** Room under the last paragraph, so the final shot does not end on the last word. */
const TAIL_PX = 64;

/** How many posts to try before giving up on the pictures. */
const MAX_TEMPLATE_ATTEMPTS = 4;

/**
 * A post to borrow the layout from when the corpus offers none: a run with no
 * corpus, or one whose corpus holds no blog. A long explainer that has been on
 * posthog.com for a while, so the reader view it renders in is the one every
 * post gets.
 */
export const DEFAULT_TEMPLATE_URLS = [
  "https://posthog.com/blog/product-engineer-vs-software-engineer",
];

/** The stamp above the headline, and the byline date, which say what the page is. */
export const DRAFT_STAMP = "Proposed draft \u00b7 not published";

/** What one draft's shots are of, and where each file goes. */
export interface DraftPlan {
  title: string;
  /** The draft body without its leading heading, which the page renders as the headline. */
  body: string;
  /** The body as HTML, ready to put into the post's article container. */
  html: string;
  /** The draft's section headings, in order, for the post's table of contents. */
  headings: string[];
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

/** The h2 and h3 lines of a markdown draft, as the table of contents lists them. */
export function sectionHeadings(markdown: string): string[] {
  return markdown
    .split("\n")
    .map((line) => /^\s*#{2,3}\s+(.*?)\s*#*\s*$/.exec(line)?.[1])
    .filter((heading): heading is string => Boolean(heading))
    .map((heading) => collapseWhitespace(heading.replace(/[*_`]/g, "")));
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
  const title = collapseWhitespace(sanitizeCopy(action.articleTitle ?? heading ?? "Untitled draft"));
  const digest = sha1(`${title}\n${draft}\n${capturedOn}`).slice(0, 10);
  const stem = `${DRAFT_DIR}/${capturedOn}/${titleSlug(title)}-${digest}`;
  const shortTitle = truncate(title, 90);
  const cleanBody = sanitizeCopy(body).trim();

  return {
    title,
    body: cleanBody,
    html: renderMarkdown(cleanBody),
    headings: sectionHeadings(cleanBody),
    wordCount: countWords(draft),
    capturedOn,
    pathFor: (index) => `${stem}-${index + 1}.png`,
    altFor: (index, total) =>
      total === 1
        ? `Draft of "${shortTitle}", staged on a posthog.com blog page`
        : `Draft of "${shortTitle}", staged on a posthog.com blog page, part ${index + 1} of ${total}`,
  };
}

/** A posthog.com blog post, as opposed to the blog index or a category page. */
export function isBlogPost(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    if (hostname !== "posthog.com" && hostname !== "www.posthog.com") return false;
    const segments = pathname.split("/").filter(Boolean);
    return segments.length === 2 && segments[0] === "blog";
  } catch {
    return false;
  }
}

/** A post long enough to be a post, so its page has the full article layout. */
const MIN_TEMPLATE_CHARS = 2_000;

/**
 * The posts to borrow the layout from, most fitting first.
 *
 * A PostHog post the corpus ranked nearest the draft's angle is the best
 * template, because it is the page this piece would sit next to. Then the
 * longest posts the corpus holds, which are the ones whose layout has every
 * part a post can have. Then the known one, for a run with no corpus. Each is
 * tried in turn, so a post that has moved costs one page load.
 */
export function templateCandidates(
  action: RecommendedAction,
  index: CorpusIndex | null,
  fallback: readonly string[] = DEFAULT_TEMPLATE_URLS,
): string[] {
  const nearest = (action.similarPages ?? []).filter(isBlogPost);

  const fromCorpus = index
    ? index
        .urls()
        .filter(isBlogPost)
        .map((url) => index.page(url))
        .filter((page) => page !== undefined && page.kind === "marketing")
        .filter((page) => page !== undefined && page.text.length >= MIN_TEMPLATE_CHARS)
        .sort((a, b) => (b?.text.length ?? 0) - (a?.text.length ?? 0) || (a?.url ?? "").localeCompare(b?.url ?? ""))
        .map((page) => page?.url ?? "")
    : [];

  return [...new Set([...nearest, ...fromCorpus, ...fallback])].slice(0, MAX_TEMPLATE_ATTEMPTS);
}

/** Everything the browser side needs to turn a post into the draft. */
export interface StageDraftInput {
  title: string;
  /** The body as HTML. Built by `renderMarkdown`, so it is our markup and nobody else's. */
  html: string;
  headings: string[];
  /** The stamp above the headline. */
  stamp: string;
  /** What the byline date becomes. */
  date: string;
}

export type StageDraftOutcome = { status: "ok" } | { status: "failed"; reason: string };

/** The attribute the staged article body carries, so the scroll step can find it. */
const BODY_MARK = "data-happenings-draft-body";

/**
 * Turn the open post into the draft. Runs **inside the browser**, so it is one
 * self-contained function with no imports, the way `stagePageEdit` is: what
 * reaches the page is this function's own source.
 *
 * Nothing here knows posthog.com's class names beyond one hint. The headline
 * is the page's `h1`; the article body is the reader view's content container
 * where the page has one, and otherwise the block under `main` holding the
 * most paragraphs that does not hold the headline; the tables of contents are
 * whichever lists on the page name the body's own headings. A redesign that
 * keeps a post a post keeps this working, and one that does not fails it
 * plainly rather than photographing a half-swapped page.
 */
function stageDraft(input: StageDraftInput): StageDraftOutcome {
  const STAMP = "data-happenings-draft-stamp";
  const BODY = "data-happenings-draft-body";
  const root = (document.querySelector("main") ??
    document.querySelector("article") ??
    document.body) as HTMLElement;

  const text = (element: Element): string => (element.textContent ?? "").replace(/\s+/g, " ").trim();

  const h1 = root.querySelector<HTMLElement>("h1");
  if (!h1) return { status: "failed", reason: "the page has no headline to replace" };

  /** The reader view's own container first, then the block with the most paragraphs. */
  function articleBody(): HTMLElement | null {
    const reader = root.querySelector<HTMLElement>(".reader-content-container");
    if (reader) {
      const only = reader.children.length === 1 ? (reader.firstElementChild as HTMLElement) : null;
      return only ?? reader;
    }
    let best: HTMLElement | null = null;
    let most = 0;
    for (const element of Array.from(root.querySelectorAll<HTMLElement>("div, section, article"))) {
      if (element.contains(h1!)) continue;
      const count = element.querySelectorAll(":scope > p").length;
      if (count > most) {
        best = element;
        most = count;
      }
    }
    return most >= 3 ? best : null;
  }

  const body = articleBody();
  if (!body) return { status: "failed", reason: "the page has no article body to put the draft in" };

  const oldHeadings = Array.from(body.querySelectorAll("h2, h3")).map(text).filter(Boolean);

  // The headline and the body: the post becomes the draft.
  h1.textContent = input.title;
  body.innerHTML = input.html;

  // The stamp, laid out the way the headline is so it sits in the same column.
  const stamp = document.createElement("div");
  stamp.className = h1.className;
  stamp.setAttribute(STAMP, "");
  const pill = document.createElement("span");
  pill.textContent = input.stamp;
  const declarations: Array<[string, string]> = [
    ["display", "inline-block"],
    ["background-color", "#f9bd2b"],
    ["color", "#151515"],
    ["font-size", "12px"],
    ["font-weight", "700"],
    ["letter-spacing", "0.04em"],
    ["text-transform", "uppercase"],
    ["line-height", "1"],
    ["padding", "6px 10px"],
    ["border-radius", "4px"],
    ["margin-bottom", "12px"],
  ];
  for (const [property, value] of declarations) pill.style.setProperty(property, value, "important");
  stamp.appendChild(pill);
  h1.before(stamp);

  // The byline sits between the headline and the body. The authors of the post
  // the layout came from did not write this, so their names go; the date
  // becomes the draft's.
  for (
    let element = h1.nextElementSibling as HTMLElement | null;
    element && element !== body && !element.contains(body);
    element = element.nextElementSibling as HTMLElement | null
  ) {
    for (const link of Array.from(element.querySelectorAll<HTMLElement>('a[href*="/community/profiles"]'))) {
      (link.closest("li") ?? link).style.setProperty("display", "none", "important");
    }
    for (const paragraph of Array.from(element.querySelectorAll<HTMLElement>("p"))) {
      if (/\b(?:19|20)\d{2}\b/.test(text(paragraph))) paragraph.textContent = input.date;
    }
  }

  // The post's own hero image, above the headline, is the one thing on the
  // page that is unmistakably somebody else's post.
  for (
    let element = h1.previousElementSibling as HTMLElement | null;
    element;
    element = element.previousElementSibling as HTMLElement | null
  ) {
    if (!element.hasAttribute(STAMP) && element.querySelector("img")) {
      element.style.setProperty("display", "none", "important");
    }
  }

  // Anything pinned to the bottom half of the window is a toast or a banner –
  // the cookie notice, most mornings – and it is in the way of every shot.
  // The header and the sidebars are pinned to the top and the sides, and stay.
  for (const node of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
    if (node.contains(body)) continue;
    if (window.getComputedStyle(node).position !== "fixed") continue;
    const own = node.getBoundingClientRect();
    if (own.height > 0 && own.top > window.innerHeight / 2) {
      node.style.setProperty("visibility", "hidden", "important");
    }
  }

  // Every table of contents on the page lists the old headings, and each is
  // rebuilt from the draft's, in the page's own list markup.
  const lists = new Set<HTMLElement>();
  for (const entry of Array.from(document.querySelectorAll<HTMLElement>("button, a"))) {
    if (body.contains(entry)) continue;
    if (!oldHeadings.includes(text(entry))) continue;
    const list = entry.closest<HTMLElement>("ul, ol");
    if (list) lists.add(list);
  }
  for (const list of lists) {
    const template = list.firstElementChild;
    if (!template) continue;
    list.replaceChildren();
    for (const heading of input.headings) {
      const item = template.cloneNode(true) as HTMLElement;
      const target = item.querySelector("button, a") ?? item;
      target.textContent = heading;
      list.appendChild(item);
    }
  }

  body.setAttribute(BODY, "");
  return { status: "ok" };
}

/**
 * One call to {@link stageDraft}, as a source string the page evaluates. The
 * same shape as `stageExpression` in `livePage.ts`, for the same reason: what
 * Playwright ships into the page is source, and `tsx` wraps nested functions
 * in a `__name` helper the page has never heard of.
 */
export function stageDraftExpression(input: StageDraftInput): string {
  return `(() => { const __name = (fn) => fn; return (${stageDraft.toString()})(${JSON.stringify(input)}); })()`;
}

/** Where the page is after one scroll step, in the coordinates of whatever scrolls. */
export interface ScrollPosition {
  scrollTop: number;
  viewportHeight: number;
  /** How far down from the top of the window fixed and sticky chrome reaches over the article. */
  covered: number;
  /** Where the staged article ends, in the same coordinates as `scrollTop`. */
  bottom: number;
}

/**
 * Scroll to `y` and say where the page ended up. Runs **inside the browser**.
 *
 * posthog.com's reader view scrolls an inner element rather than the window,
 * so the document is never taller than the window and a full-page screenshot
 * is one screen. Scrolling whatever actually scrolls and shooting the window
 * each time is what the page before/after does too, and it is the page as a
 * visitor has it on screen.
 */
function scrollDraft(input: { y: number }): ScrollPosition {
  const BODY = "data-happenings-draft-body";
  const body = document.querySelector<HTMLElement>(`[${BODY}]`);
  if (!body) return { scrollTop: 0, viewportHeight: window.innerHeight, covered: 0, bottom: 0 };

  /** The nearest ancestor that scrolls, or null for the window. */
  function scroller(): HTMLElement | null {
    for (let node = body!.parentElement; node && node !== document.body; node = node.parentElement) {
      const { overflowY } = window.getComputedStyle(node);
      if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight + 1) {
        return node;
      }
    }
    return null;
  }

  const box = scroller();
  if (box) box.scrollTop = input.y;
  else window.scrollTo(0, input.y);

  const scrollTop = box ? box.scrollTop : window.scrollY;
  const viewportHeight = box ? box.clientHeight : window.innerHeight;
  const viewportTop = box ? box.getBoundingClientRect().top : 0;
  const rect = body.getBoundingClientRect();

  // Chrome pinned over the top of the article: a sticky header, a fixed nav.
  // It is in every shot, so each step after the first starts below it. Only a
  // bar counts: a sticky sidebar or a pinned backdrop is as tall as the window
  // and covers nothing a step could avoid.
  const BAR = 0.3;
  let covered = 0;
  for (const node of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
    if (node.contains(body)) continue;
    const { position } = window.getComputedStyle(node);
    if (position !== "fixed" && position !== "sticky") continue;
    const own = node.getBoundingClientRect();
    if (own.width === 0 || own.height === 0 || own.height > viewportHeight * BAR) continue;
    if (own.left >= rect.right || own.right <= rect.left) continue;
    if (own.top <= viewportTop + 1 && own.bottom > viewportTop) {
      covered = Math.max(covered, own.bottom - viewportTop);
    }
  }

  return {
    scrollTop,
    viewportHeight,
    covered: Math.round(covered),
    bottom: Math.round(rect.bottom - viewportTop + scrollTop),
  };
}

export function scrollDraftExpression(y: number): string {
  return `(() => { const __name = (fn) => fn; return (${scrollDraft.toString()})(${JSON.stringify({ y })}); })()`;
}

/**
 * Where the next shot starts, or null when the draft has been photographed to
 * its end. Each step begins under the chrome pinned over the top of the
 * window, so no line of the draft is hidden behind a header in every shot,
 * and a page that would not scroll as far as asked is a page at its end.
 */
export function nextScroll(at: ScrollPosition, asked: number, tail = TAIL_PX): number | null {
  if (at.scrollTop + at.viewportHeight >= at.bottom + tail) return null;
  if (at.scrollTop + 2 < asked) return null;
  const step = at.viewportHeight - at.covered;
  return step > 0 ? at.scrollTop + step : null;
}

export type DraftCaptureResult =
  | { status: "captured"; shots: Buffer[]; stagedOn: string }
  | { status: "skipped"; reason: string };

export interface DraftCaptureOptions extends CaptureOptions {
  /** Posts to borrow the layout from, most fitting first. See `templateCandidates`. */
  templateUrls: string[];
}

/**
 * Stage the draft on one post and photograph it, or say why not.
 */
async function captureOnPost(
  browser: Browser,
  plan: DraftPlan,
  url: string,
  options: CaptureOptions,
): Promise<DraftCaptureResult> {
  const opened = await openLivePage(browser, url, options);
  if (opened.status === "skipped") return opened;
  const { context, page } = opened;

  try {
    const staged = await page.evaluate<StageDraftOutcome>(
      stageDraftExpression({
        title: plan.title,
        html: plan.html,
        headings: plan.headings,
        stamp: DRAFT_STAMP,
        date: `Draft, ${plan.capturedOn}`,
      }),
    );
    if (staged.status === "failed") return { status: "skipped", reason: staged.reason };

    // A taller window than the before/after uses, because these shots are read
    // top to bottom as a piece and a screen of reading is the unit. Fonts
    // again: the draft may use a face the post did not, and a shot taken while
    // it loads is a shot of the fallback.
    await page.setViewportSize({ width: VIEWPORT.width, height: SLICE_HEIGHT });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    const shots: Buffer[] = [];
    let asked = 0;
    while (shots.length < MAX_SHOTS) {
      const at = await page.evaluate<ScrollPosition>(scrollDraftExpression(asked));
      shots.push(await page.screenshot({ type: "png" }));
      const next = nextScroll(at, asked);
      if (next === null) break;
      asked = next;
    }
    return { status: "captured", shots, stagedOn: url };
  } catch (error) {
    return { status: "skipped", reason: error instanceof Error ? error.message : String(error) };
  } finally {
    await context.close().catch(() => undefined);
  }
}

/**
 * Lay the draft out on a real PostHog post and photograph it, trying each
 * candidate post in turn. Never throws for a page that will not cooperate;
 * the caller files the issue with the draft in text.
 */
export async function captureDraft(
  browser: Browser,
  plan: DraftPlan,
  options: DraftCaptureOptions,
): Promise<DraftCaptureResult> {
  const reasons: string[] = [];
  for (const url of options.templateUrls.slice(0, MAX_TEMPLATE_ATTEMPTS)) {
    const result = await captureOnPost(browser, plan, url, options);
    if (result.status === "captured") return result;
    reasons.push(`${url}: ${result.reason}`);
  }
  return {
    status: "skipped",
    reason:
      reasons.length > 0
        ? `no post would take the draft (${reasons.join("; ")})`
        : "no post to lay the draft out on",
  };
}
