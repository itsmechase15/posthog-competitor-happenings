import type { CorpusIndex } from "../posthog/retrieval.js";
import type { Analysis, NoAction, NoActionEvidence, NoActionKind } from "../types.js";
import { pageNameFromUrl, sentences, SPACED_EN_DASH, truncate } from "../util/text.js";

/**
 * Zero actions, rendered as an answer.
 *
 * The line this replaces was true and told a reader nothing: it named no
 * capability, no page, and nobody could tell it apart from a bug. So the
 * verdict has a kind, a sentence about this launch, and the pages it rests on,
 * every surface renders the same three things, and this is the only place that
 * decides what they look like.
 */

/**
 * Said when an analysis recommends nothing and offers no verdict at all. It is
 * not a failure – zero actions is a normal answer – but it is not an answer
 * either, so it says which part is missing rather than filling the space.
 */
export const UNSTATED_NO_ACTION_REASON =
  "The analysis recommended nothing and cited no PostHog page, so nothing here has been checked against what PostHog ships.";

/** What the verdict is called, by kind. The product is named where it reads better. */
export function noActionTitle(kind: NoActionKind, product = "PostHog"): string {
  switch (kind) {
    case "already_covered":
      return `None${SPACED_EN_DASH}${product} already does this`;
    case "not_a_gap":
      return `None${SPACED_EN_DASH}not a product gap`;
    case "unverified":
      return `None${SPACED_EN_DASH}the gap could not be confirmed`;
    case "dropped_on_review":
      return `None${SPACED_EN_DASH}dropped on review`;
    case "unanalyzed":
      return `None${SPACED_EN_DASH}not analyzed this run`;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/** Enough pages to show the verdict is real. Past this it is a reading list. */
export const MAX_NO_ACTION_LINKS = 3;

/** How the marketing half of a None is labelled, on every surface. */
export const MARKETING_LABEL = "Marketing";

/**
 * The clauses a "not a product gap" reason does not need.
 *
 * The shape that reads well names the piece and says it is not an
 * announcement: "This is a thought leadership article about whether to
 * install Amplitude's SDK. It's not an announcement of a new feature or
 * product." What used to follow was a flourish about PostHog – "nothing here
 * asks anything of PostHog's product", "PostHog's Experiments product has
 * nothing to answer" – which says the same thing a second time, in the voice
 * of a company rather than of a colleague. The prompt asks for the short
 * shape; this is what happens when the flourish comes back anyway.
 */
const FLOURISH =
  /\b(?:nothing|little)\s+(?:here|in\s+(?:it|this|the\s+(?:post|piece|article)))\s+asks?\s+(?:anything\s+)?of\s+posthog(?:'s)?(?:\s+product)?|\bposthog(?:'s)?(?:\s+[\w\s-]{0,40}?)?\s+(?:product\s+)?has\s+nothing\s+to\s+answer(?:\s+(?:here|to))?|\bno\s+(?:direct\s+)?impact\s+on\s+(?:current\s+)?posthog(?:'s)?(?:\s+[\w\s-]{0,30}?)?\s+products?|\basks?\s+nothing\s+of\s+(?:posthog(?:'s)?\s+)?(?:the\s+)?product/i;

/** The joins a flourish hangs off the end of a sentence with. */
const CLAUSE_JOIN = /,?\s+(?:so|and|which\s+means|meaning)\s+$/i;

/** The fewest words a sentence keeps once its flourish is cut, or it is left alone. */
const MIN_KEPT_WORDS = 6;

/**
 * Cut the PostHog flourish off a "not a product gap" reason, sentence by
 * sentence, and only where a sentence survives the cut.
 *
 * A sentence that is nothing but flourish goes; a sentence that ends in one
 * loses the clause from its join onwards; a sentence whose flourish sits in
 * the middle is left as written, because cutting the middle out of somebody's
 * sentence is rewriting it. The reason is never emptied: a reason that is all
 * flourish is kept whole rather than replaced with nothing.
 */
export function trimNotAGapReason(reason: string): string {
  const kept: string[] = [];
  for (const sentence of sentences(reason)) {
    const found = FLOURISH.exec(sentence);
    if (!found) {
      kept.push(sentence);
      continue;
    }
    const head = sentence.slice(0, found.index).replace(CLAUSE_JOIN, "").trim();
    const tail = sentence.slice(found.index + found[0].length).trim();
    const onlyPunctuationAfter = /^[.!?,;:]*$/.test(tail);
    if (!onlyPunctuationAfter || countWords(head) < MIN_KEPT_WORDS) {
      if (countWords(head) === 0 && onlyPunctuationAfter) continue;
      kept.push(sentence);
      continue;
    }
    kept.push(/[.!?]$/.test(head) ? head : `${head}.`);
  }
  const trimmed = kept.join(" ").trim();
  return trimmed.length > 0 ? trimmed : reason;
}

function countWords(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}

/**
 * The verdict as it should read, kind by kind. Only the analyst's own
 * "not a product gap" gets the flourish cut: every other reason is written by
 * code, or is a reviewer's words that a comment quotes verbatim.
 */
export function shapeNoAction(noAction: NoAction): NoAction {
  if (noAction.kind !== "not_a_gap") return noAction;
  const reason = trimNotAGapReason(noAction.reason);
  return reason === noAction.reason ? noAction : { ...noAction, reason };
}

export interface NoActionRenderOptions {
  flavor: "slack" | "markdown";
  /**
   * What the surface has to do to every string before it renders it. Slack
   * passes its mrkdwn escaper; markdown needs none.
   */
  escape?: (text: string) => string;
  /** Characters the reason is cut to. A Slack section stops rendering past 600. */
  maxChars?: number;
  product?: string;
}

/** The label on an evidence link: the page's own title, or its path. */
export function evidenceLabel(evidence: NoActionEvidence): string {
  return evidence.title?.trim() || pageNameFromUrl(evidence.url);
}

/**
 * The verdict as one block of text, in the flavor the surface speaks.
 *
 * Title, reason, then the pages, in that order, because the title is what gets
 * read on a phone and the pages are what settle an argument about it.
 */
export function renderNoAction(noAction: NoAction, options: NoActionRenderOptions): string {
  const escape = options.escape ?? ((text: string) => text);
  const title = noActionTitle(noAction.kind, options.product);
  const reason = options.maxChars ? truncate(noAction.reason, options.maxChars) : noAction.reason;

  const heading = options.flavor === "slack" ? `*${escape(title)}*` : `**${title}**`;
  const lines = [heading, escape(reason)];
  const links = renderLinks(noAction.evidence, options);
  if (links.length > 0) lines.push(`See: ${links.join(", ")}`);

  // The second answer, under the first: what this means for PostHog's own
  // content. Labelled, because a reader who has just read "not a product gap"
  // should not have to work out that the next line is about the blog.
  if (noAction.marketing) {
    const note = options.maxChars
      ? truncate(noAction.marketing.note, options.maxChars)
      : noAction.marketing.note;
    const label = options.flavor === "slack" ? `*${MARKETING_LABEL}:*` : `**${MARKETING_LABEL}:**`;
    const pages = renderLinks(noAction.marketing.pages, options);
    lines.push(`${label} ${escape(note)}${pages.length > 0 ? ` See: ${pages.join(", ")}` : ""}`);
  }
  return lines.join("\n");
}

function renderLinks(pages: NoActionEvidence[], options: NoActionRenderOptions): string[] {
  const escape = options.escape ?? ((text: string) => text);
  return pages
    .filter((entry) => /^https?:\/\//i.test(entry.url))
    .slice(0, MAX_NO_ACTION_LINKS)
    .map((entry) =>
      options.flavor === "slack"
        ? `<${entry.url}|${escape(evidenceLabel(entry))}>`
        : `[${evidenceLabel(entry)}](${entry.url})`,
    );
}

/**
 * The verdict to render for an analysis that recommends nothing.
 *
 * A row stored before the verdict had a shape carries the sentence and nothing
 * else, which is an unverified verdict with no pages under it: that is what it
 * was, so that is what it renders as.
 */
export function noActionOf(analysis: Analysis): NoAction {
  if (analysis.noAction) return analysis.noAction;
  return {
    kind: "unverified",
    reason: analysis.noActionReason?.trim() || UNSTATED_NO_ACTION_REASON,
    evidence: [],
  };
}

/**
 * Put a verdict on an analysis, both ways round. Every writer goes through
 * here, so the string and the structure can never disagree.
 */
export function withNoAction(analysis: Analysis, noAction: NoAction): Analysis {
  return { ...analysis, noAction, noActionReason: noAction.reason };
}

/** A page named by URL, with the title the corpus holds for it when it holds one. */
export function evidenceFor(index: CorpusIndex, url: string, quote?: string): NoActionEvidence {
  const page = index.page(url);
  return {
    url,
    ...(page?.title ? { title: page.title } : {}),
    ...(quote ? { quote } : {}),
  };
}
