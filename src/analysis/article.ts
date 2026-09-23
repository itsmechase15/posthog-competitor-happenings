import { terms, type CorpusIndex, type RetrievalHit } from "../posthog/retrieval.js";
import type { RecommendedAction } from "../types.js";
import { collapseWhitespace, firstSentence, stems, truncate } from "../util/text.js";

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

/** Pages the body search puts forward for the title check. Past this, a page is not what the corpus is about. */
const SIMILAR_HITS = 12;

/**
 * The share of the draft's thesis a page's own title has to carry to be the
 * same piece, and the fewest words that share can be made of.
 *
 * Half, because a title that carries half of another title's distinctive words
 * is asking the same question of the reader, and anything less is a post in
 * the same area. Two, because one shared word is a coincidence: "sdk" turns up
 * in the title of every install tutorial, and none of them is a piece on
 * whether to install one.
 */
export const THESIS_SHARE = 0.5;
export const MIN_THESIS_WORDS = 2;

/**
 * Words a headline is made of that say nothing about its subject. The
 * retrieval stop list covers the grammar; this covers the shape of a blog
 * title, which is where "should", "guide", and "vs" live. Stemmed at load,
 * because the titles they are compared against are.
 */
const TITLE_NOISE = new Set(
  [
    "should", "could", "would", "need", "needs", "really", "actually", "still", "ever",
    "vs", "versus", "against", "or",
    "guide", "guides", "tutorial", "tutorials", "tip", "tips", "explained", "explainer",
    "introduction", "intro", "complete", "ultimate", "definitive", "beginner", "beginners",
    "best", "right", "wrong", "better", "good", "great", "way", "ways", "thing", "things",
    "everything", "anything", "know", "knows", "learn", "learned", "lesson", "lessons",
    "posthog", "part", "edition", "week", "month", "year", "update", "updates", "changelog",
  ].map((word) => stems(word)[0] ?? word),
);

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

/**
 * What a piece is about, as the distinctive stems of its headline.
 *
 * A headline is the reader's question or the writer's thesis in a line, which
 * is the one thing two posts on the same angle share and two posts in the
 * same area do not. "Should you install the SDK, or send events from your
 * warehouse?" leaves install, sdk, send, event, warehouse; the grammar and the
 * shape of a title ("should", "or") go, and so does the site's own name.
 */
export function thesisTerms(title: string): string[] {
  return [
    ...new Set(
      terms(title).filter((token) => !TITLE_NOISE.has(token) && !/^\d+$/.test(token)),
    ),
  ];
}

/** How many of a thesis's words a title has to carry to be the same thesis. */
export function thesisWordsNeeded(thesis: string[]): number {
  return Math.max(MIN_THESIS_WORDS, Math.ceil(thesis.length * THESIS_SHARE));
}

/** The thesis words a page's title carries, in the order the thesis has them. */
export function sharedThesis(thesis: string[], pageTitle: string): string[] {
  const inTitle = new Set(thesisTerms(pageTitle));
  return thesis.filter((token) => inTitle.has(token));
}

/**
 * A headline that puts a question to the reader, which is what a thought
 * leadership piece does: "Should you install the SDK?", "Why we don't use
 * cookies", "Is your funnel lying to you?". The shape, not the words.
 */
export function asksAQuestion(title: string): boolean {
  const trimmed = title.trim();
  return (
    trimmed.endsWith("?") ||
    /^(?:should|why|is|are|do|does|can|could|when|what|which|who|will|would|how (?:much|many|often|long|far|well|good|bad))\b/i.test(
      trimmed,
    )
  );
}

/**
 * A how-to: a page under `/tutorials/`, or a headline that opens "How to".
 * Structure rather than vocabulary, on purpose: PostHog's tutorials section
 * holds how-tos by definition, and a title that opens "How to" is one
 * wherever it sits. A how-to walks a reader through doing a thing, and it
 * never answers whether to do it, so it is not the piece a question asks for
 * however many of the question's words it uses.
 */
export function isHowTo(url: string, title: string): boolean {
  try {
    if (new URL(url).pathname.startsWith("/tutorials/")) return true;
  } catch {
    // Not a URL, so only the title can say.
  }
  return /^how\s+to\b/i.test(title.trim());
}

export interface SimilarPieces {
  /** Editorial pages whose own headline asks the same question the draft's does. */
  strong: RetrievalHit[];
  /** The ones the analysis never opened, which are the ones that block. */
  unread: RetrievalHit[];
}

/**
 * Search PostHog's own writing for the piece a draft asks for.
 *
 * Two steps, and the second is the judgement. The body search puts forward
 * the editorial pages that share the draft's vocabulary – marketing pages
 * only, and only the blog, tutorials, and newsletter, because a product page
 * that uses the same words is not a post on the subject. Then each candidate
 * is held to the draft's thesis by its own headline: it is the same piece
 * when its title carries at least half of the draft title's distinctive words,
 * and at least two of them. A tutorial on setting up Django analytics uses
 * "install", "SDK", and "events" all the way down and shares nothing of
 * "should you install the SDK or send events from your warehouse" in its
 * title, and that is the difference between the same area and the same
 * angle. Scoring against the top body hit, which is what this replaced,
 * cannot tell them apart: when every hit is a tutorial in the area, the top
 * one is too.
 *
 * One more thing the title decides. A draft that asks the reader a question
 * is a piece about whether; a how-to is a piece about how, and a how-to on
 * one side of the question – "How to send warehouse events to PostHog" –
 * shares most of the question's words and answers none of it. So a how-to
 * never covers a question piece. See {@link isHowTo} for what counts as one.
 *
 * A match the analysis read and still recommended past is left to a person,
 * because reading it and deciding the angle differs is a judgement the index
 * cannot make; a match nobody opened is the block. Precision over recall,
 * both ways: a piece this misses reaches a marketer with the nearby posts
 * named, and a piece this wrongly blocks reaches nobody.
 */
export function similarPieces(
  action: RecommendedAction,
  index: CorpusIndex,
  seenUrls: Set<string>,
): SimilarPieces {
  const headline = action.articleTitle ?? firstSentence(action.detail, 200);
  const thesis = thesisTerms(headline);
  const query = articleQuery(action);
  if (thesis.length < MIN_THESIS_WORDS || terms(query).length === 0) {
    return { strong: [], unread: [] };
  }

  const candidates = index
    .search(query, { limit: SIMILAR_HITS * 3, kinds: ["marketing"] })
    .filter((hit) => isEditorialUrl(hit.url))
    .slice(0, SIMILAR_HITS);

  const needed = thesisWordsNeeded(thesis);
  const question = asksAQuestion(headline);
  const strong = candidates
    .filter((hit) => sharedThesis(thesis, hit.title).length >= needed)
    .filter((hit) => !(question && isHowTo(hit.url, hit.title)))
    .slice(0, MAX_SIMILAR_PIECES);

  return { strong, unread: strong.filter((hit) => !seenUrls.has(hit.url)) };
}
