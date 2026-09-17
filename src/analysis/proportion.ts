import type { PostHogRef } from "../types.js";
import { truncate } from "../util/text.js";

/**
 * How much copy a page edit is allowed to add, judged against the page it
 * lands on.
 *
 * The rule the rest of the bot already follows is that a page is only worth
 * editing when something on it is wrong, understated, or contradicted. This is
 * the second half of the same judgement: a page that is worth a sentence is
 * not worth a page. What an edit adds has to be proportional to what is
 * already there, so a page of two or three short paragraphs takes one or two
 * sentences, and a long competitive write-up on a page that short buries the
 * page under the news.
 *
 * The case this came from is a flat-rate CDN launch turned into four
 * paragraphs of the competitor's pricing model, filed against a page that ran
 * three short ones. Nothing in it was untrue and every existing check passed:
 * the page was real, the quoted line was on it, the copy was copy rather than
 * a note about the edit. It was simply too much, and "too much" is the part no
 * other check was looking at.
 *
 * So it is measured rather than argued about. The prompts ask for a
 * proportional edit and say what the numbers are, and this is what happens
 * when one comes back anyway: the action is dropped, and what it wanted
 * becomes an open question saying a shorter edit might be the right one. There
 * is no automatic shortening, for the same reason nothing else here rewrites a
 * claim it could not confirm – picking which two sentences of somebody's four
 * survive is writing the recommendation, not checking it. A reviewer can ask
 * for the short version, and that path is the review pass.
 */

/**
 * The share of a page's own length an edit may add to it.
 *
 * A fifth is the point where a reader stops seeing the page and starts seeing
 * the edit. It is deliberately generous on a long page, because a long page
 * has room for a paragraph and the schema caps replacement copy at 1,200
 * characters anyway: what this bites on is the short page, which is where the
 * mistake happens.
 */
export const MAX_GROWTH_SHARE = 0.2;

/**
 * The smallest edit that is never called disproportionate, whatever the page.
 *
 * A fifth of a hundred-word page is twenty words, which would refuse the one
 * honest sentence a short page sometimes does need. Sixty words is two or
 * three sentences: enough to say what the competitor shipped and what this
 * product does instead, and not enough to be a write-up.
 */
export const MIN_GROWTH_WORDS = 60;

/** Words, counted the way a reader would: runs of non-space. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

/** One edit, in words: what the page holds, and how much longer the edit makes it. */
export interface EditSize {
  /** The page as the corpus stores it. */
  pageWords: number;
  /** The quoted line the edit replaces, which the page gives back. */
  replacedWords: number;
  proposedWords: number;
  /** How much longer the page gets. Zero when the edit is a trim. */
  addedWords: number;
  /** What this page can carry: a fifth of it, or {@link MIN_GROWTH_WORDS}, whichever is larger. */
  budgetWords: number;
}

/**
 * Measure one edit against one page.
 *
 * Growth rather than novelty: the question is how much longer the page gets,
 * so replacement copy is credited with the line it replaces. An edit that
 * quotes the current sentence back and adds one of its own has added one
 * sentence, which is what a reader of the page would say too.
 */
export function measureEdit(pageText: string, claim: string, proposedText: string): EditSize {
  const pageWords = countWords(pageText);
  const replacedWords = countWords(claim);
  const proposedWords = countWords(proposedText);
  return {
    pageWords,
    replacedWords,
    proposedWords,
    addedWords: Math.max(0, proposedWords - replacedWords),
    budgetWords: budgetFor(pageWords),
  };
}

/** What a page of this length can carry. */
export function budgetFor(pageWords: number): number {
  return Math.max(MIN_GROWTH_WORDS, Math.round(pageWords * MAX_GROWTH_SHARE));
}

export function isOutsized(size: EditSize): boolean {
  return size.addedWords > size.budgetWords;
}

/** The page an edit is measured against, as little of it as this needs. */
export interface MeasuredPage {
  text: string;
}

/**
 * Whether the copy proposed for a page is out of proportion to it, in the
 * words the open question uses.
 *
 * Null when it is in proportion, and null when there is no stored page to
 * measure against: a page the corpus does not hold has already failed an
 * earlier check, and guessing at its length here would block an edit on a
 * number nobody has.
 */
export function proportionProblem(ref: PostHogRef, page: MeasuredPage | undefined): string | null {
  const proposed = ref.proposedText?.trim();
  if (!proposed || !page) return null;

  const size = measureEdit(page.text, ref.claim, proposed);
  if (size.pageWords === 0 || !isOutsized(size)) return null;

  return `its replacement copy adds ${size.addedWords} words to a page of ${size.pageWords}, and a page that length carries about ${size.budgetWords}: the edit has to be proportional to the page, so cut it to the sentence or two that makes the point about what shipped, or leave the page alone ("${truncate(proposed, 160)}")`;
}

/**
 * The same measurement as a line for a reviewer, which is the other place this
 * judgement is made. A model asked to say whether an edit is proportional
 * without being told how long the page is guesses at the page.
 */
export function describeProportion(page: MeasuredPage | undefined, ref: PostHogRef): string | null {
  const proposed = ref.proposedText?.trim();
  if (!proposed || !page) return null;

  const size = measureEdit(page.text, ref.claim, proposed);
  if (size.pageWords === 0) return null;

  const verdict = isOutsized(size)
    ? `over the ${size.budgetWords} a page that length carries`
    : `within the ${size.budgetWords} a page that length carries`;
  return `the page runs about ${size.pageWords} words, and this copy adds about ${size.addedWords} to it, ${verdict}`;
}
