import { isMarketingTarget } from "../posthog/pages.js";
import type { CorpusIndex } from "../posthog/retrieval.js";
import type { PageEditPlan, PostHogRef, RecommendedAction } from "../types.js";
import { sanitizeCopy, sha1, truncate } from "../util/text.js";

/**
 * What there is to photograph about one page edit: which page, which line on
 * it, the copy that replaces the line, and where the two PNGs go.
 *
 * The picture itself is two screenshots of the live page, taken by
 * [`livePage.ts`](./livePage.ts) – the page as it reads today, and the same
 * page with the proposed copy staged in a headless browser and published
 * nowhere. This file is the part that needs no browser: finding the line,
 * saying in words what the edit does, and naming the files.
 *
 * The stored corpus is still what the claim is checked against – the evidence
 * gate has already done that, on the text the analyst read. It is only not
 * what the picture is *of* any more. Somebody reading an issue about a
 * posthog.com page should be looking at that posthog.com page.
 */

/** The affected copy on the page, as the text layers of an issue quote it. */
const MAX_LINE_CHARS = 420;

/** A page title long enough to wrap twice is a title nobody reads. */
const MAX_TITLE_CHARS = 70;

/** The words a text-fragment link scrolls to. Past this, browsers stop matching. */
const FRAGMENT_WORDS = 12;

/** Where every pair lands in the repo, so they are one folder to prune. */
export const VISUAL_DIR = "artifacts/update-pages";

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
 * claim this can find, and the same folding the browser side uses, so a line
 * found in the corpus is looked for on the page the same way. The map is the
 * reason it is written out again here rather than imported: finding the quote
 * is not enough, the plan has to carry the page's own characters, curly quotes
 * and dashes included.
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
 * cut. Both read as a rendering fault on a diff whose job is to be trusted,
 * and a half sentence swapped into the live page for the after shot leaves the
 * other half dangling. Neither end travels more than a sentence's worth of
 * characters, so a claim that ends in a colon cannot swallow the paragraph
 * after it.
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
  // the edit; the quote itself is still shown whole.
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
 * wrong" and "this section is short of a sentence", and it decides both what
 * the diff prints and what the browser does to the page.
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

/** The page's own path as a file name fragment: "compare-mixpanel". */
function pathSlug(url: string): string {
  return (
    pagePath(url)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "page"
  );
}

/** Today, as the date a capture is stamped and filed under. */
export function captureDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The two files one edit's pair goes in. The hash covers the page, both sides
 * of the edit **and the day**, so the same recommendation drawn twice in one
 * morning reuses the files, and a re-run next week photographs the page as it
 * is next week rather than reusing a before shot that has gone stale.
 */
export function visualPaths(
  url: string,
  oldLine: string,
  proposedText: string,
  capturedOn: string,
): { before: string; after: string } {
  const digest = sha1(`${url}\n${oldLine}\n${proposedText}\n${capturedOn}`).slice(0, 10);
  const stem = `${VISUAL_DIR}/${capturedOn}/${pathSlug(url)}-${digest}`;
  return { before: `${stem}-before.png`, after: `${stem}-after.png` };
}

/** The stored page an edit is planned against: its title, and the copy on it. */
export interface StoredPage {
  title: string;
  text: string;
}

/**
 * Plan one page edit, or nothing when there is nothing honest to show: no
 * proposed copy means no after shot, and no quoted line means nothing to look
 * for on the page.
 *
 * `page` is the corpus's copy of it. Without one the ref's own claim is the
 * line to look for, which is what a caller with no corpus is left with.
 */
export function planPageEdit(
  ref: PostHogRef,
  page: StoredPage | undefined,
  capturedOn = captureDate(),
): PageEditPlan | null {
  const proposedText = ref.proposedText?.trim();
  const claim = ref.claim.trim();
  if (!proposedText || !claim) return null;

  const span = page ? locate(page.text, claim) : null;
  const oldLine = truncate(
    (span && page ? page.text.slice(span.start, span.end) : claim).trim(),
    MAX_LINE_CHARS,
  );
  const mode = editMode(oldLine, proposedText);
  const summary = summaryFor(ref, mode);
  const path = pagePath(ref.url);
  const paths = visualPaths(ref.url, oldLine, proposedText, capturedOn);
  const pageTitle = truncate(page?.title || path, MAX_TITLE_CHARS);

  const plan: Omit<PageEditPlan, "diff"> = {
    url: ref.url,
    pageTitle,
    path,
    summary,
    mode,
    oldLine,
    newLines: mode === "insert" ? addedParagraphs(oldLine, proposedText) : paragraphs(proposedText),
    proposedText,
    highlightUrl: highlightUrl(ref.url, oldLine),
    beforeAlt: truncate(`${pageTitle} as it reads today, with the quoted line in place`, 140),
    afterAlt: truncate(`${pageTitle} with the proposed copy highlighted in it: ${summary}`, 140),
    beforePath: paths.before,
    afterPath: paths.after,
    capturedOn,
    // A line the stored page has and the live page does not is a page that has
    // moved on since the corpus read it, which is worth a line in the issue. A
    // line neither has is a claim nothing can show.
    quotedOnStoredPage: span !== null,
  };
  return { ...plan, diff: diffFor(plan) };
}

/**
 * The plans for one action, or none.
 *
 * `update_pages` only. The other three actions are not page edits: a
 * `new_compare_page` has no current copy to sit above an after shot, and the
 * two product actions ask for the product to change rather than a page, so a
 * before and after of a docs paragraph would illustrate the evidence as if it
 * were the ask.
 *
 * A ref the corpus does not hold gets no plan either. The line to look for on
 * the live page is the sentence the evidence gate matched on the stored page,
 * and there is no such sentence for a page we have never read.
 */
export function buildPageEditPlans(
  action: RecommendedAction,
  refs: PostHogRef[],
  index: CorpusIndex,
  capturedOn = captureDate(),
): PageEditPlan[] {
  if (action.type !== "update_pages") return [];

  const plans: PageEditPlan[] = [];
  for (const ref of refs) {
    if (!isMarketingTarget(ref.url)) continue;
    const page = index.page(ref.url);
    if (!page) continue;
    const plan = planPageEdit(ref, page, capturedOn);
    if (plan) plans.push(plan);
  }

  return plans;
}
