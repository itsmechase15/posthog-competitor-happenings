import { isMarketingTarget } from "../posthog/pages.js";
import type { CorpusIndex } from "../posthog/retrieval.js";
import type { PageEditCard, PageEditPlan, PostHogRef, RecommendedAction } from "../types.js";
import { sanitizeCopy, sentences, truncate } from "../util/text.js";

/**
 * The before/after a marketer reads on an `update_pages` issue, built out of
 * the corpus copy the evidence gate already matched.
 *
 * Everything here comes off the stored page and the analyst's own rewrite.
 * Nothing is fetched, nothing is injected into the live page, and no model is
 * asked anything: a card is the two strings the gate checked, put next to each
 * other with the copy around them for bearings. That matters more than it
 * sounds. A card rendered off the live page would be a screenshot of a cookie
 * banner on a bad day and a screenshot of the wrong paragraph on a good one,
 * and neither is evidence of the edit being asked for.
 *
 * The image is the point of it – a marketer should see the change rather than
 * reconstruct it – but the image is never the only copy of it. Every card
 * renders a diff and the full replacement text as well, so an issue whose PNG
 * could not be rendered or uploaded still says exactly what to paste.
 */

/** Context on either side of the edit. Enough for bearings, short enough to read. */
const MAX_CONTEXT_CHARS = 200;

/** The affected copy on the card itself. The paste block below it is never cut. */
const MAX_LINE_CHARS = 420;

/** A page title long enough to wrap twice is a title nobody reads. */
const MAX_TITLE_CHARS = 70;

/** The words a text-fragment link scrolls to. Past this, browsers stop matching. */
const FRAGMENT_WORDS = 12;

/** The path of a posthog.com URL, which is where on the site the copy sits. */
export function pagePath(url: string): string {
  try {
    const { pathname } = new URL(url);
    return pathname.length > 1 ? pathname.replace(/\/+$/, "") : "/";
  } catch {
    return url;
  }
}

/**
 * Text as words, punctuation folded away, with a map back to where each
 * character came from.
 *
 * The same folding `quoteAppearsOn` uses, so a claim the gate matched is a
 * claim this can find. The map is the reason it is written out again here
 * rather than imported: finding the quote is not enough, the card has to show
 * the page's own characters around it, curly quotes and dashes included.
 */
function foldWithMap(text: string): { folded: string; offsets: number[] } {
  let folded = "";
  const offsets: number[] = [];
  let space = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    const lower = char
      .toLowerCase()
      .replace(/[\u2018\u2019\u201b]/g, "'")
      .replace(/[\u201c\u201d]/g, '"');

    if (/[a-z0-9]/.test(lower)) {
      folded += lower;
      offsets.push(index);
      space = false;
      continue;
    }
    if (!space && folded.length > 0) {
      folded += " ";
      offsets.push(index);
      space = true;
    }
  }

  if (space) {
    folded = folded.slice(0, -1);
    offsets.pop();
  }
  return { folded, offsets };
}

function fold(text: string): string {
  return foldWithMap(text).folded;
}

/** How far either side of a quote to look for the sentence it sits in. */
const SENTENCE_SCAN_CHARS = 240;

/**
 * Grow a span out to the sentence it sits inside.
 *
 * Folding drops the punctuation, so a quote that is a whole sentence comes
 * back one full stop short, and a quote that is half a sentence comes back
 * cut. Both read as a rendering fault on a card whose job is to be trusted,
 * and the full stop left behind lands at the top of the context line below.
 * Neither end travels more than a sentence's worth of characters, so a claim
 * that ends in a colon cannot swallow the paragraph after it.
 */
function toSentenceBounds(text: string, start: number, end: number): { start: number; end: number } {
  let from = start;
  const floor = Math.max(0, start - SENTENCE_SCAN_CHARS);
  while (from > floor && !/[.!?]\s/.test(text.slice(from - 2, from))) from -= 1;
  if (from > floor) {
    while (from < start && /\s/.test(text[from] as string)) from += 1;
  } else {
    from = start;
  }

  let to = end;
  const ceiling = Math.min(text.length, end + SENTENCE_SCAN_CHARS);
  while (to < ceiling && !/[.!?]/.test(text[to - 1] as string)) to += 1;
  if (to >= ceiling) to = end;
  // Punctuation that closes the sentence after its full stop.
  while (to < text.length && /["')\]]/.test(text[to] as string)) to += 1;

  return { start: from, end: to };
}

/** Where a quote sits in a page, as character offsets into the stored text. */
function locate(pageText: string, quote: string): { start: number; end: number } | null {
  const { folded, offsets } = foldWithMap(pageText);
  // An "A … B" citation is matched on its first part, which is what anchors
  // the card; the quote itself is still shown whole.
  const [first] = quote.split(/\s*(?:\u2026|\.\.\.)\s*/);
  const needle = fold(first ?? quote);
  if (needle.length === 0) return null;

  const at = folded.indexOf(needle);
  if (at < 0) return null;

  const start = offsets[at];
  const last = offsets[at + needle.length - 1];
  if (start === undefined || last === undefined) return null;
  return toSentenceBounds(pageText, start, last + 1);
}

/**
 * The copy either side of the edit, as the page reads it.
 *
 * Whole sentences on both sides, because a fragment of a sentence above the
 * highlighted line reads as a rendering bug rather than as context.
 */
function contextAround(pageText: string, span: { start: number; end: number }): {
  above: string;
  below: string;
} {
  const above = sentences(pageText.slice(0, span.start)).at(-1) ?? "";
  const below = sentences(pageText.slice(span.end)).at(0) ?? "";
  return {
    above: truncate(above, MAX_CONTEXT_CHARS),
    below: truncate(below, MAX_CONTEXT_CHARS),
  };
}

/**
 * A link that opens the live page scrolled to the line as it reads today.
 *
 * Chrome, Edge and Safari honour a text fragment; Firefox ignores it and opens
 * the page, which is the same thing minus the scroll. The hyphen and the comma
 * are the fragment syntax's own, so both are escaped rather than sent.
 */
export function highlightUrl(url: string, quote: string): string | null {
  const words = quote.trim().split(/\s+/).slice(0, FRAGMENT_WORDS).join(" ");
  if (words.length < 12) return null;
  const encoded = encodeURIComponent(words).replace(/-/g, "%2D").replace(/,/g, "%2C");
  return `${url.split("#")[0] as string}#:~:text=${encoded}`;
}

/** Lines of a rewrite, blank ones dropped, so a diff has one line per paragraph. */
function paragraphs(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Whether the rewrite keeps the quoted copy or replaces it.
 *
 * An analyst that hands back the page's current line plus a new one is asking
 * for an insert: the old copy is still true, and the launch adds something it
 * does not mention. Anything else replaces the line it quoted. The difference
 * is worth drawing because it is the difference between "this sentence is
 * wrong" and "this section is short of a sentence", and a marketer reading a
 * diff of the first when it is really the second will delete copy that was
 * fine.
 */
function editMode(claim: string, proposedText: string): "replace" | "insert" {
  const proposed = fold(proposedText);
  const current = fold(claim);
  if (current.length === 0 || proposed.length === 0) return "replace";
  return proposed.includes(current) && proposed.length > current.length ? "insert" : "replace";
}

/** The copy an insert adds: the rewrite's paragraphs that are not already there. */
function addedParagraphs(claim: string, proposedText: string): string[] {
  const current = fold(claim);
  const added = paragraphs(proposedText).filter((line) => {
    const folded = fold(line);
    return folded.length > 0 && !current.includes(folded);
  });
  return added.length > 0 ? added : paragraphs(proposedText);
}

/**
 * A diff of the edit, in the syntax GitHub colours.
 *
 * A replace is the old line out and the new copy in. An insert keeps the old
 * line as context and only adds, which is why the mode is worked out at all:
 * a `-` on a line nobody asked to delete is a wrong instruction rendered in
 * red.
 */
export function diffFor(plan: Pick<PageEditPlan, "mode" | "oldLine" | "newLines">): string {
  if (plan.mode === "insert") {
    return [`  ${plan.oldLine}`, ...plan.newLines.map((line) => `+ ${line}`)].join("\n");
  }
  return [`- ${plan.oldLine}`, ...plan.newLines.map((line) => `+ ${line}`)].join("\n");
}

/**
 * One line saying what the edit does, in the words of whoever asked for it.
 *
 * The analyst's own `suggestedEdit` when there is one, because it was written
 * about this page. Otherwise the mode says it plainly: nothing here guesses at
 * an intent the analysis never stated.
 */
function summaryFor(ref: PostHogRef, mode: "replace" | "insert"): string {
  if (ref.suggestedEdit) return sanitizeCopy(ref.suggestedEdit);
  return mode === "insert"
    ? "Adds a line to this section. The copy already there stays as it is."
    : "Replaces the line below with copy that covers what the competitor shipped.";
}

/**
 * The cards for one action, or none.
 *
 * `update_pages` only. The other three actions are not page edits: a
 * `new_compare_page` has no current copy to sit above an after, and the two
 * product actions ask for the product to change rather than a page, so a
 * before/after of a docs paragraph would illustrate the evidence as if it were
 * the ask.
 *
 * A ref the corpus does not hold gets no card either. Rendering one would mean
 * picking the surrounding copy off a page we cannot read, and the issue keeps
 * its quoted-copy layers regardless.
 */
export function buildPageEditPlans(
  action: RecommendedAction,
  refs: PostHogRef[],
  index: CorpusIndex,
): PageEditPlan[] {
  if (action.type !== "update_pages") return [];

  const plans: PageEditPlan[] = [];
  for (const ref of refs) {
    if (!isMarketingTarget(ref.url) || !ref.proposedText) continue;
    const page = index.page(ref.url);
    if (!page) continue;

    const span = locate(page.text, ref.claim);
    const oldLine = span ? page.text.slice(span.start, span.end).trim() : ref.claim.trim();
    const context = span ? contextAround(page.text, span) : { above: "", below: "" };
    const mode = editMode(oldLine, ref.proposedText);

    const plan: Omit<PageEditPlan, "diff"> = {
      url: ref.url,
      pageTitle: truncate(page.title || pagePath(ref.url), MAX_TITLE_CHARS),
      path: pagePath(ref.url),
      summary: summaryFor(ref, mode),
      mode,
      contextAbove: context.above,
      contextBelow: context.below,
      oldLine,
      newLines:
        mode === "insert"
          ? addedParagraphs(oldLine, ref.proposedText)
          : paragraphs(ref.proposedText),
      proposedText: ref.proposedText,
      highlightUrl: highlightUrl(ref.url, oldLine),
    };
    plans.push({ ...plan, diff: diffFor(plan) });
  }

  return plans;
}

/** A plan with wherever its picture ended up, which is what the issue renders. */
export function toCard(plan: PageEditPlan, imageUrl: string | null): PageEditCard {
  return {
    ...plan,
    imageUrl,
    altText: truncate(
      `Before and after for ${plan.path}: ${plan.summary}`.replace(/[[\]]/g, ""),
      140,
    ),
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function line(className: string, text: string): string {
  if (!text) return "";
  return `<p class="${className}">${escapeHtml(truncate(text, MAX_LINE_CHARS))}</p>`;
}

export interface CardHtmlOptions {
  /** `@font-face` rules with the font inlined. Empty falls back to the system stack. */
  fontCss?: string;
  /** The day the card was rendered, as it is printed on the card. */
  renderedOn?: string;
}

/**
 * The card as a static HTML document, 720px wide, ready for one screenshot.
 *
 * Static on purpose: no network, no scripts, no webfont request, no live page.
 * Given the same plan it renders the same bytes, which is what lets the file
 * name be a hash of this document and an unchanged edit re-use the PNG it
 * already has.
 */
export function renderCardHtml(plan: PageEditPlan, options: CardHtmlOptions = {}): string {
  const fontStack = options.fontCss
    ? "Inter, -apple-system, 'Helvetica Neue', Arial, sans-serif"
    : "-apple-system, 'Helvetica Neue', Arial, sans-serif";

  const caret = `<p class="caret">${escapeHtml("\u25b2")} new copy goes here</p>`;

  const before = [
    line("context", plan.contextAbove),
    line("old", plan.oldLine),
    plan.mode === "insert" ? caret : "",
    line("context", plan.contextBelow),
  ].join("");

  const after = [
    line("context", plan.contextAbove),
    plan.mode === "insert" ? line("kept", plan.oldLine) : "",
    plan.newLines.map((text) => line("new", text)).join(""),
    line("context", plan.contextBelow),
  ].join("");

  const footer = [
    `posthog.com${plan.path}`,
    plan.mode === "insert" ? "one line added" : "one line replaced",
    options.renderedOn ? `rendered ${options.renderedOn}` : "",
  ]
    .filter(Boolean)
    .join(" \u00b7 ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
${options.fontCss ?? ""}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { width: 720px; background: #ffffff; font-family: ${fontStack}; }
.card { width: 720px; padding: 20px; background: #ffffff; }
.head { font-size: 13px; font-weight: 600; color: #151515; }
.head span { font-weight: 400; color: #6b6b6b; }
.panel { margin-top: 12px; padding: 14px 16px; border: 1px solid #e5e5e2; border-radius: 8px; background: #fafaf9; }
.tag { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #6b6b6b; margin-bottom: 8px; }
.panel p { font-size: 14px; line-height: 1.55; margin-bottom: 6px; }
.panel p:last-child { margin-bottom: 0; }
.context { color: #8f8f8c; }
.kept { color: #2f2f2f; }
.old { color: #151515; background: #fff2cc; border-left: 3px solid #f9bd2b; padding: 6px 10px; border-radius: 3px; }
.new { color: #151515; background: #e3f5e8; border-left: 3px solid #2f9e44; padding: 6px 10px; border-radius: 3px; }
.caret { color: #b5891f; font-size: 12px; font-weight: 600; }
.foot { margin-top: 12px; font-size: 11px; color: #8f8f8c; }
</style>
</head>
<body>
<div class="card">
  <div class="head">${escapeHtml(plan.pageTitle)} <span>${escapeHtml(plan.path)}</span></div>
  <div class="panel"><div class="tag">Before</div>${before}</div>
  <div class="panel"><div class="tag">After</div>${after}</div>
  <div class="foot">${escapeHtml(footer)}</div>
</div>
</body>
</html>`;
}
