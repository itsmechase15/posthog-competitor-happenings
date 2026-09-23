import { terms, type CorpusIndex, type RetrievalHit } from "../posthog/retrieval.js";
import type { RecommendedAction } from "../types.js";
import { collapseWhitespace, firstSentence, truncate } from "../util/text.js";

/**
 * What makes a `consider_publishing` recommendation a draft somebody can edit
 * rather than a request for one, and whether PostHog already published it.
 *
 * The action exists for the piece that ships nothing – thought leadership, an
 * explainer, an event write-up – where the product answer is None and the
 * question left is whether PostHog's own blog should say something on the same
 * angle. "Consider publishing something about X" hands a marketer the reading,
 * the research, and the writing; the analyst had PostHog's posts and docs open,
 * so the analyst writes the draft, and this file is the code half of that rule:
 * is there a draft, is it long enough to be one, and does the corpus already
 * hold the piece it asks for.
 *
 * None of it judges whether the draft is good. The issue renders it as a page
 * and carries it as copy so a person can, and the review pass is where a
 * second model reads it.
 */

/**
 * The fewest words that are a draft rather than a brief. Three hundred is a
 * short post: enough to make one point and say what to do about it, and past
 * anything an outline or a list of talking points runs to.
 */
export const MIN_ARTICLE_WORDS = 300;

/**
 * Where a draft stops being a post. PostHog's posts mostly run shorter, and
 * the schema caps the string at about this many words anyway; it is stated so
 * the prompt and the cap agree.
 */
export const MAX_ARTICLE_WORDS = 1_800;

/**
 * Where PostHog's own writing lives on posthog.com: the sections a
 * `consider_publishing` action asks for a new page in, and so the only ones
 * that count as "PostHog already covers this".
 */
export const EDITORIAL_PREFIXES = [
  "/blog",
  "/tutorials",
  "/newsletter",
  "/founders",
  "/product-engineers",
] as const;

/** The same sections as the analyst finds them in the docs workspace. */
export const EDITORIAL_DIRS = EDITORIAL_PREFIXES.map((prefix) => `pages${prefix}/`);

/** How many existing pieces a check names. Past this it is a reading list. */
export const MAX_SIMILAR_PIECES = 3;

/** Hits examined per draft. Past this, a page is not what the corpus is about. */
const SIMILAR_HITS = 8;
/** How close to the top hit a page has to score to count as the same angle. */
const STRONG_SCORE_RATIO = 0.6;
/** Query stems a page has to share to be about the same thing, when the query has that many. */
const MIN_MATCHED_TERMS = 3;

/**
 * A draft that opens by describing itself is a brief with a heading on it.
 * The check is on the first sentence only, because a post that later says
 * "this post covers" is making a promise to its reader, not to its editor.
 */
const BRIEF_LEAD =
  /^(?:#+\s*)?(?:this\s+(?:post|article|piece|draft)\s+(?:should|would|will|could)\s+|the\s+(?:post|article|piece)\s+(?:should|would|will|could)\s+|outline\b|talking\s+points\b|key\s+points\b|suggested\s+structure\b|draft\s+outline\b)/i;

export function isEditorialUrl(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    if (hostname !== "posthog.com" && hostname !== "www.posthog.com") return false;
    return EDITORIAL_PREFIXES.some((prefix) => pathname.startsWith(`${prefix}/`));
  } catch {
    return false;
  }
}

/** Words, counted the way a reader would: runs of non-space, markdown marks included. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

/**
 * Why this is not a draft a marketer could edit into a post, or null when it
 * is. Written to be read in a blocked-action open question, so it says what is
 * wrong with the piece rather than which check it failed.
 */
export function articleProblem(action: RecommendedAction): string | null {
  const title = collapseWhitespace(action.articleTitle ?? "");
  const draft = (action.articleDraft ?? "").trim();
  if (!draft) return "it recommends publishing a piece and carries no draft of it";
  if (!title) return "its draft has no working title, and a piece with no headline is not one a marketer can decide on";

  const words = countWords(draft);
  if (words < MIN_ARTICLE_WORDS) {
    return `its draft runs ${words} words, and a piece under ${MIN_ARTICLE_WORDS} is a brief rather than a draft somebody can edit ("${truncate(collapseWhitespace(draft), 120)}")`;
  }
  const lead = firstSentence(draft.replace(/^#+\s*.*\n+/, ""), 200);
  if (BRIEF_LEAD.test(lead)) {
    return `its draft opens by describing the post rather than being it: "${truncate(lead, 120)}"`;
  }
  return null;
}

/** The words an existing piece is searched for on: the headline and the ask. */
export function articleQuery(action: RecommendedAction): string {
  return [action.articleTitle ?? "", firstSentence(action.detail, 240)].join(" ").trim();
}

export interface SimilarPieces {
  /** Editorial pages the corpus ranks as being about the same angle. */
  strong: RetrievalHit[];
  /** The ones the analysis never opened, which are the ones that block. */
  unread: RetrievalHit[];
}

/**
 * Search PostHog's own writing for the piece a draft asks for.
 *
 * Marketing pages only, and only the editorial sections: a product page that
 * shares the draft's vocabulary is not a post on the subject, and neither is
 * a compare page. A strong hit shares most of the query's own stems and scores
 * close to the top one, which is what "the same angle" looks like to a lexical
 * index. A strong hit the analysis read and still recommended past is left to
 * a person, because reading it and deciding the angle differs is a judgement
 * the index cannot make; a strong hit nobody opened is the block.
 */
export function similarPieces(
  action: RecommendedAction,
  index: CorpusIndex,
  seenUrls: Set<string>,
): SimilarPieces {
  const query = articleQuery(action);
  const queryTerms = [...new Set(terms(query))];
  if (queryTerms.length === 0) return { strong: [], unread: [] };

  const hits = index
    .search(query, { limit: SIMILAR_HITS * 3, kinds: ["marketing"] })
    .filter((hit) => isEditorialUrl(hit.url))
    .slice(0, SIMILAR_HITS);
  const top = hits[0]?.score ?? 0;
  if (top <= 0) return { strong: [], unread: [] };

  const needed = Math.min(MIN_MATCHED_TERMS, queryTerms.length);
  const strong = hits
    .filter((hit) => hit.matched.length >= needed && hit.score >= STRONG_SCORE_RATIO * top)
    .slice(0, MAX_SIMILAR_PIECES);

  return { strong, unread: strong.filter((hit) => !seenUrls.has(hit.url)) };
}
