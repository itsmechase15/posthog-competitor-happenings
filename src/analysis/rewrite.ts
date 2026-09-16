import { isMarketingTarget } from "../posthog/pages.js";
import type { Analysis, PostHogRef, RecommendedAction } from "../types.js";
import { collapseWhitespace } from "../util/text.js";

/**
 * What makes an `update_pages` recommendation something a person can act on.
 *
 * "Update the pricing section to mention scheduled stops" is not a page edit.
 * It is a request for one, handed to whoever opens the issue along with the
 * writing, the reading of the page, and the guess at what voice it is in. The
 * analyst is the one who had the page open, so the analyst writes the words:
 * the copy that goes on the page, in the page's own voice, ready to paste.
 *
 * This module is the code half of that rule. The prompt asks for the rewrite,
 * and everything here asks whether what came back is one. None of it judges
 * whether the rewrite is *good* – that is a person's job, and the issue shows
 * the current copy next to it so they can make it. What it judges is whether
 * there is anything on the page to compare: prose, not an instruction.
 */

/** Below this, there is no paragraph there, only a note to self. */
const MIN_REWRITE_CHARS = 40;
/** A rewrite is copy, so it has to be more than a phrase. */
const MIN_REWRITE_WORDS = 7;

/**
 * Verbs a sentence opens with when it is addressed to an editor rather than to
 * a reader of posthog.com. A marketing, product, or compare page does not open
 * a paragraph by telling you to mention something: it says the thing.
 */
const EDITOR_LEAD =
  /^(please\s+)?(mention|note|say|state|clarify|reflect|highlight|call out|reword|rewrite|revise|amend|correct|tweak|adjust|update|change|edit|fix|add|include|remove|drop|replace|swap|ensure|make sure|consider|explain|point out|flag|cover|address|answer)\b/i;

/**
 * A page talking about itself. Copy on posthog.com says what PostHog does; it
 * never says what "this page" or "the comparison table" should say, so any of
 * this is a sign the model wrote about the edit instead of writing the edit.
 */
const META_REFERENCE =
  /\b(?:this|the|that)\s+(?:compare\s+|comparison\s+|pricing\s+|product\s+|landing\s+)?(?:page|section|paragraph|sentence|line|copy|wording|blurb|bullet|heading|subhead|table|matrix|row|column)\b/i;

/** The same thing said as a verdict on the copy: "should say", "currently claims". */
const META_VERDICT =
  /\b(?:should|needs? to|ought to|must)\s+(?:now\s+)?(?:say|read|mention|note|state|cover|reflect|be updated|be changed|be rewritten)\b|\bcurrently\s+(?:says|reads|claims|states|implies|suggests)\b|\bas it stands\b|\bout of date\b/i;

/**
 * Marketing filler PostHog's style guide rules out, which is also the tell
 * that copy was written for a page nobody read. Only the words with no honest
 * use are here: "just" and "clearly" are banned in the handbook and do have
 * one, so they are left to the prompt rather than blocking work.
 * https://posthog.com/handbook/wizard-and-docs/docs-style-guide
 */
const FILLER_WORDS = [
  "seamless",
  "seamlessly",
  "robust",
  "best-in-class",
  "cutting-edge",
  "game-changing",
  "leverage",
  "leverages",
  "leveraging",
  "empowers",
  "synergy",
  "holistic",
  "streamline",
  "streamlines",
  "effortless",
  "effortlessly",
  "unlock",
  "unlocks",
  "utilize",
  "utilizes",
];

const FILLER_PATTERN = new RegExp(`\\b(${FILLER_WORDS.join("|")})\\b`, "i");

/** Text as bare words, so a rewrite can be compared with the copy it replaces. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Why this is not copy a person could paste onto the page, or null when it is.
 *
 * The reason is written to be read in a blocked-action open question, so it
 * says what is wrong with the text rather than which check it failed.
 */
export function rewriteProblem(text: string | undefined): string | null {
  const copy = collapseWhitespace(text ?? "");
  if (!copy) return "it proposes no replacement copy at all";
  if (copy.length < MIN_REWRITE_CHARS || copy.split(" ").length < MIN_REWRITE_WORDS) {
    return `its replacement copy is too short to be the words that go on the page: "${copy}"`;
  }
  if (EDITOR_LEAD.test(copy)) {
    return `its replacement copy is an instruction rather than the words to put on the page: "${copy}"`;
  }
  if (META_REFERENCE.test(copy) || META_VERDICT.test(copy)) {
    return `its replacement copy describes the edit rather than being it: "${copy}"`;
  }
  if (FILLER_PATTERN.test(copy)) {
    return `its replacement copy uses marketing filler PostHog's style guide rules out: "${copy}"`;
  }
  return null;
}

export function isExactRewrite(text: string | undefined): boolean {
  return rewriteProblem(text) === null;
}

/** A rewrite that restates the copy it replaces changes nothing on the page. */
export function repeatsCurrentCopy(ref: PostHogRef): boolean {
  const proposed = fold(ref.proposedText ?? "");
  const current = fold(ref.claim);
  return proposed.length > 0 && (proposed === current || current.includes(proposed));
}

/**
 * The page an `update_pages` action fixes, with the rewrite for it.
 *
 * Suggested edits hang off `posthog_refs` rather than off the action, so with
 * two page actions in one analysis there is no telling which rewrite belongs
 * to which. Callers that render one action pass `pageActions` so this can hold
 * back rather than attach the wrong page's copy to it.
 */
export function rewriteForAction(
  analysis: Analysis,
  action: RecommendedAction,
  pageActions = countUpdatePages(analysis),
): PostHogRef | null {
  if (action.type !== "update_pages" || pageActions > 1) return null;
  return (
    analysis.posthogRefs.find(
      (ref) => isMarketingTarget(ref.url) && isExactRewrite(ref.proposedText),
    ) ?? null
  );
}

export function countUpdatePages(analysis: Analysis): number {
  return analysis.actions.filter((action) => action.type === "update_pages").length;
}
