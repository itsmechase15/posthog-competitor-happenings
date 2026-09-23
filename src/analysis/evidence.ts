import { isMarketingTarget } from "../posthog/pages.js";
import { matchProducts } from "../posthog/products.js";
import { terms, type CorpusIndex, type RetrievalHit } from "../posthog/retrieval.js";
import {
  isContentAction,
  productActions,
  type Analysis,
  type MarketingNote,
  type NoAction,
  type NoActionEvidence,
  type NoActionKind,
  type PostHogRef,
  type RecommendedAction,
} from "../types.js";
import { firstSentence, truncate } from "../util/text.js";
import { articleProblem, similarPieces } from "./article.js";
import { evidenceFor, noActionOf, withNoAction } from "./noAction.js";
import { proportionProblem } from "./proportion.js";
import { isExactRewrite, repeatsCurrentCopy, rewriteProblem } from "./rewrite.js";

/**
 * The checks an action has to survive before anyone is asked to do it.
 *
 * All of them exist to stop one mistake: a GitHub issue telling PostHog to
 * build or improve something PostHog already ships. That issue is worse than
 * no alert. It costs a reader's trust in every alert after it, and it is the
 * easy mistake to make, because a launch is written to sound like a gap and
 * the docs page that answers it is one of several thousand.
 *
 * So a product action carries its evidence: the gap in one line, the corpus
 * page it was read off, and words quoted from that page. Each of those is
 * checked against the stored corpus rather than trusted, and the corpus is
 * then searched again with the gap's own words – because the claim that gets
 * through every other check is the one whose evidence is real and whose
 * counter-evidence sat on a page nobody opened.
 *
 * A failed check is never a correction. There is no way to rewrite a claim
 * whose basis we cannot find without inventing one, so the action is dropped
 * and what it said becomes an open question for a person to settle.
 */

/** Hits examined per gap. Past this, a page is not what the corpus is about. */
const COVERAGE_HITS = 8;
/** Hits allowed per docs section, so one area cannot fill the coverage check. */
const COVERAGE_PER_SECTION = 3;
/** How close to the top hit a page has to score to count as a strong match. */
const STRONG_SCORE_RATIO = 0.55;
/** Query stems a page has to contain to be a strong match, when the query has that many. */
const MIN_MATCHED_TERMS = 2;

/** Phrases that make a gap about what something costs rather than what it does. */
const PACKAGING_PHRASES = [
  "cheaper",
  "more expensive",
  "costs less",
  "costs more",
  "lower price",
  "higher price",
  "price point",
  "plan price",
  "pricing is",
  "free tier",
  "free plan",
  "per-seat",
  "per seat",
  "discount",
  "packaging",
  "included in the plan",
];

/** An action that asks for words about the product rather than a change to it. */
const DOCUMENTATION_LEAD =
  /^(document|documenting|write (up )?(the )?docs|add (a |the )?(docs?|documentation|doc page)|publish (a |the )?docs?|update the docs|create (a |the )?docs?)\b/i;

function isProductAction(action: RecommendedAction): boolean {
  return action.type === "consider_enhancing" || action.type === "consider_building";
}

/** Text as words, punctuation folded away, so a quote survives a dash or a comma. */
function normalizeQuote(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A quoted fragment short enough to appear anywhere proves nothing. */
const MIN_QUOTE_CHARS = 16;

/**
 * Whether a quote really is on the page.
 *
 * Exact, once punctuation is folded away, because the analyst read the same
 * stored text this checks against – the workspace file is the corpus row. An
 * ellipsis splits the quote into parts and every part has to appear, which is
 * how a legitimate "A ... B" citation passes and a paraphrase does not.
 */
export function quoteAppearsOn(quote: string, pageText: string): boolean {
  const haystack = normalizeQuote(pageText);
  if (!haystack) return false;

  const parts = quote
    .split(/\s*(?:\u2026|\.\.\.)\s*/)
    .map(normalizeQuote)
    .filter((part) => part.length >= MIN_QUOTE_CHARS);

  if (parts.length === 0) return false;
  return parts.every((part) => haystack.includes(part));
}

/** The words a gap is searched on: the gap itself, and the product it names. */
export function gapQuery(action: RecommendedAction): string {
  return [action.gap ?? "", action.feature ?? ""].join(" ").trim();
}

export function isPackagingGap(action: RecommendedAction): boolean {
  const gap = (action.gap ?? "").toLowerCase();
  if (!PACKAGING_PHRASES.some((phrase) => gap.includes(phrase))) return false;
  // A gap that names a product surface is about that surface, whatever it says
  // about the money: "caps session recordings on the free tier" is a Session
  // replay gap, not a pricing complaint.
  const surfaces = matchProducts(action.gap ?? "", 3).map((product) => product.label);
  return surfaces.length === 0;
}

export function isDocumentationOnlyAction(action: RecommendedAction): boolean {
  return DOCUMENTATION_LEAD.test(firstSentence(action.detail, 200).trim());
}

export interface CoverageContext {
  index: CorpusIndex;
  /**
   * Corpus URLs this analysis actually had in front of it: the pages the
   * analyst opened, plus the excerpts pre-loaded into its prompt.
   */
  seenUrls: Set<string>;
}

/** A page the corpus ranks highly for a gap that the analysis never read. */
export interface CoverageMiss {
  url: string;
  title: string;
  score: number;
}

/**
 * Search the corpus with the gap's own words and report the pages that outrank
 * everything the analysis read.
 *
 * This is the check that catches the failure the others cannot. Every other
 * check asks whether the evidence offered is real; this one asks whether it
 * was the relevant evidence. A gap claim whose words lead straight to a page
 * nobody opened is a gap claim about a page nobody opened.
 */
export function coverageMisses(
  action: RecommendedAction,
  context: CoverageContext,
  citedUrls: Set<string>,
): { misses: CoverageMiss[]; strong: RetrievalHit[] } {
  const query = gapQuery(action);
  const queryTerms = terms(query);
  if (queryTerms.length === 0) return { misses: [], strong: [] };

  const hits = context.index.search(query, {
    limit: COVERAGE_HITS,
    perSection: COVERAGE_PER_SECTION,
    kinds: ["docs"],
  });
  const top = hits[0]?.score ?? 0;
  if (top <= 0) return { misses: [], strong: [] };

  const needed = Math.min(MIN_MATCHED_TERMS, queryTerms.length);
  const strong = hits.filter(
    (hit) => hit.matched.length >= needed && hit.score >= STRONG_SCORE_RATIO * top,
  );

  const wasRead = (url: string): boolean => context.seenUrls.has(url) || citedUrls.has(url);
  const bestRead = Math.max(0, ...strong.filter((hit) => wasRead(hit.url)).map((hit) => hit.score));

  // A page the analysis read outranking everything it did not is the answer we
  // want: the reasoning started from the page the corpus thinks is about this.
  const misses = strong
    .filter((hit) => !wasRead(hit.url) && hit.score >= Math.max(bestRead, STRONG_SCORE_RATIO * top))
    .map((hit) => ({ url: hit.url, title: hit.title, score: hit.score }));

  return { misses, strong };
}

/**
 * What stopped an action, as a token rather than as a sentence.
 *
 * The sentence says it best to a person and says nothing to code, and the
 * difference between "PostHog already ships this" and "we could not check
 * whether PostHog ships this" is the whole difference between the two answers
 * an empty alert can give. So every block carries which one it was.
 */
export const BLOCK_CAUSES = [
  /** The corpus holds pages about the gap that the analysis never opened. */
  "covered_elsewhere",
  /** The gap's own words rank other pages above the one it cites. */
  "wrong_page_ranked",
  /** PostHog already publishes the compare page being asked for. */
  "page_exists",
  "packaging",
  "docs_only",
  "no_gap",
  "no_evidence",
  "not_in_corpus",
  "not_docs",
  "no_quote",
  "quote_missing",
  "page_edit_no_page",
  "page_edit_no_edit",
  "page_edit_stale_claim",
  "page_edit_no_copy",
  "page_edit_no_change",
  /** The copy is fine and there is far too much of it for the page it lands on. */
  "page_edit_disproportionate",
  "page_edit_unusable",
  /** A piece was recommended and no draft of it came back, or not enough of one. */
  "article_no_draft",
  /** PostHog's blog, tutorials, or newsletter already carry the piece, on pages nobody opened. */
  "article_exists",
] as const;
export type BlockCause = (typeof BLOCK_CAUSES)[number];

/** One action that will not be filed, and what a reader should be told instead. */
export interface BlockedAction {
  action: RecommendedAction;
  cause: BlockCause;
  /** Why, in the words the open question uses. */
  reason: string;
  /** The pages the cause is about, when it is about pages. */
  urls: string[];
  /** The same, shorter, for the run log. */
  note: string;
}

export interface GateResult {
  analysis: Analysis;
  blocked: BlockedAction[];
  /** For the run log. */
  notes: string[];
}

function block(
  action: RecommendedAction,
  cause: BlockCause,
  reason: string,
  urls: string[] = [],
): BlockedAction {
  return {
    action,
    cause,
    reason,
    urls,
    note: `blocked a ${action.type} action: ${reason} ("${firstSentence(action.detail, 100)}")`,
  };
}

/**
 * The page a product action rests on, checked rather than believed: it has to
 * be a page the corpus holds, it has to be product documentation rather than
 * copy or a changelog entry, and the quote has to be on it.
 */
function checkEvidence(action: RecommendedAction, context: CoverageContext): BlockedAction | null {
  if (!action.gap) {
    return block(
      action,
      "no_gap",
      "it does not say what PostHog cannot do today, so there is nothing to check",
    );
  }
  if (!action.evidenceUrl) {
    return block(
      action,
      "no_evidence",
      `it cites no PostHog docs page for the gap "${truncate(action.gap, 120)}"`,
    );
  }

  const page = context.index.page(action.evidenceUrl);
  if (!page) {
    return block(
      action,
      "not_in_corpus",
      `it cites ${action.evidenceUrl}, which is not a page in PostHog's docs corpus`,
      [action.evidenceUrl],
    );
  }
  if (page.kind !== "docs") {
    const why =
      page.kind === "changelog"
        ? "a changelog entry says something shipped, which is the opposite of evidence for a gap"
        : "marketing copy is written on some past date and is never evidence about the product";
    return block(action, "not_docs", `its evidence is ${action.evidenceUrl}, and ${why}`, [
      action.evidenceUrl,
    ]);
  }
  if (!action.evidenceQuote) {
    return block(
      action,
      "no_quote",
      `it cites ${action.evidenceUrl} without quoting what the page says`,
      [action.evidenceUrl],
    );
  }
  if (!quoteAppearsOn(action.evidenceQuote, page.text)) {
    return block(
      action,
      "quote_missing",
      `its quote is not on ${action.evidenceUrl}: the stored copy of that page does not contain "${truncate(action.evidenceQuote, 120)}"`,
      [action.evidenceUrl],
    );
  }
  return null;
}

/**
 * A page edit has to name a page somebody owns and say what it should say. The
 * copy it quotes has to be on that page, too: a compare page that no longer
 * says the thing being corrected has already been fixed.
 *
 * And it has to carry the rewrite. An `update_pages` issue that says "update
 * the pricing section to mention scheduled stops" hands the reader the page,
 * the reading of it, and the writing, which is the whole job minus the noticing
 * – so the words that go on the page are part of the recommendation, checked
 * here the same way everything else is. `src/analysis/rewrite.ts` says what
 * counts as the words rather than a note about them.
 */
function checkPageEdit(
  action: RecommendedAction,
  analysis: Analysis,
  context: CoverageContext,
): BlockedAction | null {
  const editable = analysis.posthogRefs.filter((ref) => isMarketingTarget(ref.url));
  if (editable.length === 0) {
    return block(
      action,
      "page_edit_no_page",
      "it names no PostHog marketing, product, or compare page to edit",
    );
  }

  const withEdit = editable.find((ref) => ref.suggestedEdit ?? ref.proposedText);
  if (!withEdit) {
    return block(
      action,
      "page_edit_no_edit",
      "it names a page but not what the page should say instead",
      editable.map((ref) => ref.url),
    );
  }

  const grounded = editable.filter((ref) => refClaimHolds(ref, context));
  if (grounded.length === 0) {
    return block(
      action,
      "page_edit_stale_claim",
      `the copy it quotes is not on ${editable.map((ref) => ref.url).join(" or ")} as stored, so the page may already say something else`,
      editable.map((ref) => ref.url),
    );
  }

  return checkRewrite(action, grounded, context);
}

/**
 * The rewrite itself, on one of the pages whose current copy we just verified.
 *
 * Only those pages are candidates. A rewrite attached to copy that is no longer
 * on the page replaces nothing, and the reader has no way to tell which of the
 * two is stale.
 *
 * Three questions about it, in the order a person would ask them. Is it copy
 * rather than a note about the edit? Does it change anything? And is there an
 * amount of it a page this size can carry? The last one is `proportion.ts`,
 * and it is the only check here that can fail copy nothing is wrong with:
 * a competitive write-up filed against a page of three short paragraphs is
 * true, well written, and still the wrong edit.
 */
function checkRewrite(
  action: RecommendedAction,
  grounded: PostHogRef[],
  context: CoverageContext,
): BlockedAction | null {
  const usable = grounded.find(
    (ref) =>
      isExactRewrite(ref.proposedText) &&
      !repeatsCurrentCopy(ref) &&
      !alreadyOnPage(ref, context) &&
      proportionProblem(ref, context.index.page(ref.url)) === null,
  );
  if (usable) return null;

  const offered = grounded.filter((ref) => ref.proposedText);
  if (offered.length === 0) {
    return block(
      action,
      "page_edit_no_copy",
      `it says what to change on ${grounded.map((ref) => ref.url).join(" or ")} but not the words to put there, and an edit nobody can paste is a job, not a recommendation`,
      grounded.map((ref) => ref.url),
    );
  }

  const first = offered[0] as PostHogRef;
  if (repeatsCurrentCopy(first) || alreadyOnPage(first, context)) {
    return block(
      action,
      "page_edit_no_change",
      `the copy it proposes for ${first.url} is what the page already says, so there is nothing to change`,
      [first.url],
    );
  }

  const unusable = rewriteProblem(first.proposedText);
  if (unusable) return block(action, "page_edit_unusable", unusable, [first.url]);

  const outsized = proportionProblem(first, context.index.page(first.url));
  if (outsized) return block(action, "page_edit_disproportionate", outsized, [first.url]);

  return block(action, "page_edit_unusable", "its replacement copy is unusable", [first.url]);
}

/** A rewrite already sitting on the stored page is a page that has been fixed. */
function alreadyOnPage(ref: PostHogRef, context: CoverageContext): boolean {
  const proposed = ref.proposedText;
  if (!proposed) return false;
  const page = context.index.page(ref.url);
  return page ? quoteAppearsOn(proposed, page.text) : false;
}

/**
 * A page that does not exist yet cannot be quoted, so `new_compare_page` is
 * checked the only way it can be: the page it asks for has to be one PostHog
 * does not already have.
 *
 * The corpus holds every compare page posthog.com publishes, which makes this
 * a question with an answer rather than a judgement call – and "write the page
 * you already wrote" is the same class of mistake as "build the thing you
 * already ship".
 */
function checkNewComparePage(
  action: RecommendedAction,
  analysis: Analysis,
  context: CoverageContext,
): BlockedAction | null {
  const existing = analysis.posthogRefs
    .map((ref) => context.index.page(ref.url))
    .filter((page) => page !== undefined && isComparePage(page.url));

  if (existing.length > 0) {
    const urls = existing.map((page) => page?.url).filter((url): url is string => Boolean(url));
    return block(
      action,
      "page_exists",
      `PostHog already publishes ${urls.join(" and ")}, so there is no page to create`,
      urls,
    );
  }
  return null;
}

function isComparePage(url: string): boolean {
  try {
    return new URL(url).pathname.startsWith("/compare");
  } catch {
    return false;
  }
}

/**
 * A piece to publish, checked the two ways it can be: is there a draft, and
 * has PostHog already written it.
 *
 * The first is `articleProblem`, and it is mechanical: a title, a draft, and
 * enough words for the draft to be one. The second searches PostHog's own
 * writing with the headline and the ask, and blocks when a piece on the same
 * angle sits on a page the analysis never opened – the same shape as the
 * coverage check on a gap, for the same reason. "Publish the post you already
 * published" is the marketing version of "build the thing you already ship".
 * A similar piece the analyst did open and recommended past is left standing
 * and named in the issue, because deciding the angle differs is a judgement,
 * and the reviewer gets the same pages.
 */
function checkArticle(action: RecommendedAction, context: CoverageContext): BlockedAction | null {
  const problem = articleProblem(action);
  if (problem) return block(action, "article_no_draft", problem);

  const { unread } = similarPieces(action, context.index, context.seenUrls);
  if (unread.length > 0) {
    const urls = unread.map((hit) => hit.url);
    return block(
      action,
      "article_exists",
      `PostHog already publishes on this angle, on pages the analysis never opened: ${urls.join(", ")}`,
      urls,
    );
  }
  return null;
}

function withSimilarPages(action: RecommendedAction, context: CoverageContext): RecommendedAction {
  const { strong } = similarPieces(action, context.index, context.seenUrls);
  if (strong.length === 0) return action;
  return { ...action, similarPages: strong.map((hit) => hit.url) };
}

/**
 * Whether a cited page really says what the ref claims. A page the corpus does
 * not hold cannot be checked, and an unverifiable page edit is one someone
 * would go and make on trust.
 */
function refClaimHolds(ref: PostHogRef, context: CoverageContext): boolean {
  const page = context.index.page(ref.url);
  if (!page) return false;
  return quoteAppearsOn(ref.claim, page.text);
}

/**
 * Run every action past every check, and turn what fails into open questions.
 *
 * Order matters only in what a reader is told first: the cheapest, most
 * specific complaint wins, because "it quotes a page that does not say that"
 * is more use to a person than "the corpus knows more about this than the
 * analysis read".
 */
export function gateActions(analysis: Analysis, context: CoverageContext): GateResult {
  const blocked: BlockedAction[] = [];
  const notes: string[] = [];
  const citedUrls = new Set(analysis.posthogRefs.map((ref) => ref.url));

  const kept = analysis.actions
    .filter((action) => {
      const failure = firstFailure(action);
      if (!failure) return true;
      blocked.push(failure);
      notes.push(failure.note);
      return false;
    })
    // A piece that passed carries the PostHog pieces the search found nearest
    // it, which the analysis read and recommended past: the issue names them
    // so a marketer compares before writing.
    .map((action) => (isContentAction(action) ? withSimilarPages(action, context) : action));

  // The product side and the content side are judged apart. What blocked a
  // product action decides the product verdict; what blocked a piece to
  // publish is a line about the blog under it, never a claim about the product.
  const productKept = productActions(kept);
  const productBlocked = blocked.filter((entry) => !isContentAction(entry.action));
  const contentBlocked = blocked.filter((entry) => isContentAction(entry.action));

  if (blocked.length === 0 && productKept.length > 0) return { analysis, blocked, notes };

  // What blocked the last product action is the answer to "so why is this
  // empty?", and saying it as the verdict and again as an open question reads
  // as two findings rather than one. A blocked piece with a product action
  // still standing has no verdict to sit under, so it is a question instead.
  const openQuestions = [...analysis.openQuestions];
  if (productKept.length > 0) {
    for (const entry of [...productBlocked, ...contentBlocked]) {
      if (openQuestions.length >= 4) break;
      openQuestions.push(blockedQuestion(entry));
    }
    return { analysis: { ...analysis, actions: kept, openQuestions }, blocked, notes };
  }

  const gated: Analysis = { ...analysis, actions: kept, openQuestions };
  let verdict: NoAction;
  if (productBlocked.length > 0) {
    verdict = noActionFrom(productBlocked, context.index);
    // The analyst's own line about the blog survives a product verdict the
    // gate rewrote: the gate judged the product side, and the note is not
    // about the product.
    const marketing = analysis.noAction?.marketing;
    if (marketing) verdict = { ...verdict, marketing };
  } else {
    // The analyst's own verdict is a claim about what PostHog ships, so it is
    // checked here too rather than published on trust.
    const checked = checkNoActionEvidence(gated, context.index);
    notes.push(...checked.notes);
    verdict = noActionOf(checked.analysis);
  }
  if (contentBlocked.length > 0) {
    verdict = { ...verdict, marketing: marketingFrom(contentBlocked, context.index) };
  }

  return { analysis: withNoAction(gated, verdict), blocked, notes };

  function firstFailure(action: RecommendedAction): BlockedAction | null {
    if (isDocumentationOnlyAction(action)) {
      return block(
        action,
        "docs_only",
        "it asks for the docs to be written rather than for anything to change, which is not one of this bot's actions",
      );
    }

    // Whether a page edit is about the launch is settled before this, by the
    // topic guard in `relevance.ts`, which has the signal's own words to judge
    // against. What is left here is whether the page and the copy are real.
    if (action.type === "update_pages") return checkPageEdit(action, analysis, context);
    if (action.type === "new_compare_page") {
      return checkNewComparePage(action, analysis, context);
    }
    if (isContentAction(action)) return checkArticle(action, context);
    if (!isProductAction(action)) return null;

    if (isPackagingGap(action)) {
      return block(
        action,
        "packaging",
        `its gap is about what a competitor charges rather than what PostHog can do: "${truncate(action.gap ?? "", 120)}"`,
      );
    }

    const evidence = checkEvidence(action, context);
    if (evidence) return evidence;

    const { misses, strong } = coverageMisses(action, context, citedUrls);
    const cited = action.evidenceUrl ?? "";
    if (strong.length > 0 && !strong.some((hit) => hit.url === cited)) {
      const ranked = strong.slice(0, 2).map((hit) => hit.url);
      return block(
        action,
        "wrong_page_ranked",
        `the gap it names does not lead to the page it cites: searching the docs for "${truncate(action.gap ?? "", 80)}" ranks ${ranked.join(" and ")} above ${cited}`,
        ranked,
      );
    }
    if (misses.length > 0) {
      const unread = misses.slice(0, 3).map((miss) => miss.url);
      return block(
        action,
        "covered_elsewhere",
        `the docs cover this in pages the analysis never opened: ${unread.join(", ")}. Read those before treating "${truncate(action.gap ?? "", 80)}" as a gap`,
        unread,
      );
    }

    return null;
  }
}

/**
 * What a blocked action leaves for a person to answer.
 *
 * `reason` says what failed, in the words the verdict uses, and it is a
 * statement about the action rather than a question about PostHog. An open
 * question has to ask something, so the cause picks the question and the
 * reason follows it as the context behind it.
 */
export function blockedQuestion(entry: BlockedAction): string {
  const reason = entry.reason.trim().replace(/[.]+$/, "");
  return `${questionForCause(entry.cause)} The recommendation was dropped because ${reason}.`;
}

function questionForCause(cause: BlockCause): string {
  switch (cause) {
    case "covered_elsewhere":
      return "Does PostHog already cover this?";
    case "wrong_page_ranked":
      return "Which PostHog docs page actually answers this gap?";
    case "page_exists":
      return "Does the comparison page PostHog already publishes say enough about this?";
    case "packaging":
      return "Is there a capability gap here, underneath what the competitor charges?";
    case "docs_only":
      return "Is there anything to change in the product here, rather than in the docs?";
    case "no_gap":
      return "What does PostHog not do here today?";
    case "no_evidence":
    case "not_in_corpus":
    case "not_docs":
      return "Which PostHog docs page shows this gap?";
    case "no_quote":
    case "quote_missing":
      return "What does that docs page say about this today?";
    case "page_edit_no_page":
      return "Which PostHog page should change?";
    case "page_edit_no_edit":
    case "page_edit_no_copy":
    case "page_edit_unusable":
      return "What exact copy should go on that page?";
    case "page_edit_stale_claim":
      return "Has that page already been fixed?";
    case "page_edit_no_change":
      return "Is anything on that page left to change?";
    case "page_edit_disproportionate":
      return "What is the shortest edit that page needs?";
    case "article_no_draft":
      return "What would a PostHog piece on this say?";
    case "article_exists":
      return "Does the piece PostHog already publishes cover this angle?";
    default: {
      const exhaustive: never = cause;
      return exhaustive;
    }
  }
}

/** The kind of verdict one blocked action argues for. */
function kindForCause(cause: BlockCause): NoActionKind {
  switch (cause) {
    case "covered_elsewhere":
    case "wrong_page_ranked":
    case "page_exists":
      return "already_covered";
    case "packaging":
    case "docs_only":
    // Nothing about the product is missing and nothing on the page is unsayable:
    // the edit asked for is the wrong size for the page, which is a judgement
    // about the page rather than a claim nobody could check.
    case "page_edit_disproportionate":
    // A blocked piece never reaches the product verdict – `gateActions` keeps
    // the content blocks apart – so these only have to be named here.
    case "article_no_draft":
    case "article_exists":
      return "not_a_gap";
    case "no_gap":
    case "no_evidence":
    case "not_in_corpus":
    case "not_docs":
    case "no_quote":
    case "quote_missing":
    case "page_edit_no_page":
    case "page_edit_no_edit":
    case "page_edit_stale_claim":
    case "page_edit_no_copy":
    case "page_edit_no_change":
    case "page_edit_unusable":
      return "unverified";
    default: {
      const exhaustive: never = cause;
      return exhaustive;
    }
  }
}

/** What "PostHog already does this" rests on, in the words of the check that said so. */
function coveredReason(entry: BlockedAction, evidence: NoActionEvidence[]): string {
  const pages = evidence.map((page) => page.title ?? page.url).join(" and ");
  const gap = truncate(entry.action.gap ?? "", 120);

  switch (entry.cause) {
    case "page_exists":
      return "PostHog already publishes the comparison page this asks for, so there is nothing to write.";
    case "wrong_page_ranked":
      return `PostHog documents this already: searching the docs for "${gap}" ranks ${pages} above the page the analysis read it off.`;
    default:
      return `PostHog documents this already: the docs cover "${gap}" on ${pages}, which the analysis never opened.`;
  }
}

function notAGapReason(blocked: BlockedAction[]): string {
  const packaging = blocked.find((entry) => entry.cause === "packaging");
  if (packaging) {
    return `The only thing recommended was about what a competitor charges rather than what PostHog can do ("${truncate(packaging.action.gap ?? "", 120)}"), and pricing is not a capability PostHog is missing.`;
  }
  const outsized = blocked.find((entry) => entry.cause === "page_edit_disproportionate");
  if (outsized) {
    return `The only thing recommended was a page edit far longer than the page it lands on: ${outsized.reason}. A shorter edit may still be worth making, so this is a page nobody has written two sentences for yet rather than a page that is wrong.`;
  }
  return "The only thing recommended was writing docs about something PostHog already ships, which is a docs job rather than a product gap.";
}

/**
 * The verdict, read off what the gate blocked.
 *
 * Coverage wins over everything else, because "PostHog already does this" is
 * the answer a reader is looking for and the one the whole bot exists to get
 * right. A run of pricing complaints is not a gap at all. Anything else is a
 * gap somebody claimed and nobody could confirm, which is its own answer and
 * says which check it failed.
 */
export function noActionFrom(blocked: BlockedAction[], index: CorpusIndex): NoAction {
  const covered = blocked.filter((entry) => kindForCause(entry.cause) === "already_covered");
  const evidence = [...new Set(covered.flatMap((entry) => entry.urls))].map((url) =>
    evidenceFor(index, url),
  );

  const first = covered[0];
  if (first && evidence.length > 0) {
    return { kind: "already_covered", reason: coveredReason(first, evidence), evidence };
  }

  if (blocked.every((entry) => kindForCause(entry.cause) === "not_a_gap")) {
    return { kind: "not_a_gap", reason: notAGapReason(blocked), evidence: [] };
  }

  const failed = blocked[0] as BlockedAction;
  const gap = failed.action.gap;
  return {
    kind: "unverified",
    reason: gap
      ? `The analysis claimed "${truncate(gap, 120)}" as a gap, but ${failed.reason}, so nothing here is confirmed.`
      : `The work recommended here did not hold up: ${failed.reason}.`,
    evidence: failed.urls.filter((url) => index.page(url)).map((url) => evidenceFor(index, url)),
  };
}

/**
 * The line about PostHog's own content, read off what the gate blocked.
 *
 * A piece PostHog already publishes is the answer marketing wants, so it wins
 * and names the pages. A piece with no draft behind it is said plainly: the
 * analyst thought there was something to write and wrote nothing, which is
 * worth a line and not worth an issue.
 */
export function marketingFrom(blocked: BlockedAction[], index: CorpusIndex): MarketingNote {
  const exists = blocked.find((entry) => entry.cause === "article_exists");
  if (exists) {
    const pages = [...new Set(exists.urls)].map((url) => evidenceFor(index, url));
    const named = pages.map((page) => page.title ?? page.url).join(" and ");
    return {
      note: `PostHog already covers this angle in ${named}, so there is nothing new to publish.`,
      pages,
    };
  }

  const first = blocked[0] as BlockedAction;
  const piece = first.action.articleTitle ?? firstSentence(first.action.detail, 120);
  return {
    note: `A PostHog piece was suggested ("${truncate(piece, 100)}") and not filed, because ${first.reason.replace(/[.]+$/, "")}.`,
    pages: [],
  };
}

/**
 * Check an `already_covered` verdict the way a gap claim is checked.
 *
 * "PostHog already does this" is a claim about what PostHog ships, so it earns
 * nothing for being the comfortable answer: the page has to be in the corpus,
 * it has to be documentation, and the quote has to be on it. Evidence that
 * fails is dropped, and a verdict left with none is downgraded to unverified
 * naming the page that could not be confirmed, because there is no honest way
 * to keep the claim once its basis is gone.
 */
export function checkNoActionEvidence(
  analysis: Analysis,
  index: CorpusIndex,
): { analysis: Analysis; notes: string[] } {
  const stated = noActionOf(analysis);
  const notes: string[] = [];
  const verdict = checkMarketingPages(stated, index, notes);
  if (verdict.kind !== "already_covered") {
    return { analysis: withNoAction(analysis, verdict), notes };
  }

  const kept: NoActionEvidence[] = [];

  for (const entry of verdict.evidence) {
    const page = index.page(entry.url);
    if (!page) {
      notes.push(`dropped ${entry.url} from the no-action verdict: it is not a page in the corpus`);
      continue;
    }
    if (page.kind !== "docs") {
      notes.push(
        `dropped ${entry.url} from the no-action verdict: it is ${page.kind} rather than product documentation`,
      );
      continue;
    }
    if (entry.quote && !quoteAppearsOn(entry.quote, page.text)) {
      notes.push(
        `dropped ${entry.url} from the no-action verdict: the quote it gives is not on the stored page`,
      );
      continue;
    }
    kept.push({ ...entry, title: entry.title ?? page.title });
  }

  if (kept.length > 0) {
    return { analysis: withNoAction(analysis, { ...verdict, evidence: kept }), notes };
  }

  const failed = verdict.evidence[0]?.url;
  return {
    analysis: withNoAction(analysis, {
      kind: "unverified",
      reason: failed
        ? `The analysis says PostHog already covers this and reads it off ${failed}, which could not be confirmed against the stored corpus, so what PostHog ships here is unchecked.`
        : "The analysis says PostHog already covers this and names no page it read that on, so what PostHog ships here is unchecked.",
      evidence: [],
      ...(verdict.marketing ? { marketing: verdict.marketing } : {}),
    }),
    notes,
  };
}

/**
 * The pages a marketing note points at, checked for being pages at all.
 *
 * "PostHog already covers this in X" is a claim about posthog.com, so X has to
 * be a page the corpus holds. That is the whole check: an editorial page is
 * marketing copy by nature, so there is no kind to insist on and no quote to
 * match. A page that is not there is dropped and the note keeps its words,
 * with the titles the corpus holds filled in for the ones that are.
 */
function checkMarketingPages(verdict: NoAction, index: CorpusIndex, notes: string[]): NoAction {
  if (!verdict.marketing) return verdict;
  const pages: NoActionEvidence[] = [];
  for (const entry of verdict.marketing.pages) {
    const page = index.page(entry.url);
    if (!page) {
      notes.push(`dropped ${entry.url} from the marketing note: it is not a page in the corpus`);
      continue;
    }
    pages.push({ ...entry, title: entry.title ?? page.title });
  }
  return { ...verdict, marketing: { ...verdict.marketing, pages } };
}
