import { productForDocUrl, productsForAction } from "../posthog/products.js";
import {
  isContentAction,
  type Analysis,
  type PostHogDoc,
  type PostHogRef,
  type RecommendedAction,
} from "../types.js";
import { firstSentence, SPACED_EN_DASH, truncate } from "../util/text.js";

/**
 * A model asserting that PostHog lacks something. Worth catching because it is
 * the one claim in an alert that a reader acts on without checking, and the one
 * a compare-page snippet cannot support.
 */
const GAP_CLAIM =
  /\bposthog\b[^.?!]{0,140}?\b(has no|have no|has nothing|have nothing|does not|doesn't|do not|don't|cannot|can't|lacks|lack|no support for|no way to|is missing|are missing)\b/i;

/** The same claim written the other way round: "there is no PostHog equivalent". */
const NO_EQUIVALENT = /\bno\b[^.?!]{0,40}\b(posthog\s+)?(equivalent|counterpart|parity)\b/i;

export function claimsGap(detail: string): boolean {
  return GAP_CLAIM.test(detail) || NO_EQUIVALENT.test(detail);
}

export interface DocsVerification {
  analysis: Analysis;
  /** What was corrected, for the run log. Empty when the model got it right. */
  notes: string[];
}

/**
 * Reconcile a model's actions with the docs it was shown.
 *
 * The prompt asks for this and a good model does it, but "PostHog can't do X"
 * is the claim that costs the most when it is wrong, so it is also checked
 * here. Two things are enforced:
 *
 * 1. consider_building means PostHog has nothing in the area. A docs page in
 *    context for that product contradicts it outright, so the action becomes
 *    consider_enhancing against that product and says what already exists.
 * 2. A gap claim has to be checkable. It gets the docs page it should have
 *    cited, or, when no docs page covers it, an open question saying the gap
 *    was never verified.
 *
 * Nothing the model wrote is deleted. A correction is added to the end of the
 * detail, so the reader sees both the claim and the page that qualifies it.
 */
export function verifyAgainstDocs(analysis: Analysis, docs: PostHogDoc[]): DocsVerification {
  const notes: string[] = [];
  const refs: PostHogRef[] = [...analysis.posthogRefs];
  const openQuestions = [...analysis.openQuestions];
  const citedUrls = new Set(refs.map((ref) => ref.url));

  const actions = analysis.actions.map((action): RecommendedAction => {
    // A piece to publish makes no claim about what PostHog ships: its detail
    // saying PostHog's blog has nothing on the subject is about the blog, and
    // reading it as a gap claim would cite a docs page for a post.
    if (isContentAction(action)) return action;

    const relevant = relevantDocs(action, docs);
    const primary = relevant[0];

    if (action.type === "consider_building" && primary) {
      const feature = productForDocUrl(primary.url)?.label ?? action.feature;
      notes.push(
        `retyped consider_building to consider_enhancing${feature ? ` ${feature}` : ""}: ${primary.url} covers this area`,
      );
      cite(primary);
      return {
        ...action,
        type: "consider_enhancing",
        ...(feature ? { feature } : {}),
        detail: append(
          action.detail,
          `PostHog already ships ${feature ?? "something"} here${SPACED_EN_DASH}see ${primary.url}${SPACED_EN_DASH}so this is a gap to close in an existing product, not a new one to build.`,
        ),
      };
    }

    if (claimsGap(action.detail)) {
      if (primary) {
        if (!citedUrls.has(primary.url)) {
          notes.push(`cited ${primary.url} for a gap claim that named no docs page`);
          cite(primary);
        }
      } else if (openQuestions.length < 3) {
        notes.push("flagged an unverified gap claim as an open question");
        openQuestions.push(
          `Does PostHog already do this? The action says it does not, no PostHog docs page in context confirmed that, so read the docs for ${namedProducts(action) || "the product involved"} before acting on it.`,
        );
      }
    }

    // A consider_enhancing with no feature renders in Slack as a title that
    // names nothing, and the docs say which product this is about.
    if (action.type === "consider_enhancing" && !action.feature && primary) {
      const feature = productForDocUrl(primary.url)?.label;
      if (feature) {
        notes.push(`named ${feature} as the feature to enhance, from ${primary.url}`);
        return { ...action, feature };
      }
    }

    return action;
  });

  return {
    analysis: { ...analysis, actions, posthogRefs: refs, openQuestions },
    notes,
  };

  function cite(doc: PostHogDoc): void {
    if (citedUrls.has(doc.url)) return;
    citedUrls.add(doc.url);
    refs.push({
      url: doc.url,
      claim: truncate(firstSentence(doc.excerpt, 240) || doc.title, 240),
    });
  }
}

/** One sentence added to a detail, without doubling a period. */
function append(detail: string, sentence: string): string {
  const trimmed = detail.trim();
  const separator = /[.!?]$/.test(trimmed) ? " " : ". ";
  return `${trimmed}${trimmed ? separator : ""}${sentence}`;
}

/**
 * The docs pages that speak to one action: the product it names in `feature`
 * first, then whatever its own words are about. Order matters, because the
 * first match is the page the correction cites.
 */
export function relevantDocs(action: RecommendedAction, docs: PostHogDoc[]): PostHogDoc[] {
  const wanted = productNames(action);
  if (wanted.length === 0) return [];

  const ranked = docs
    .map((doc) => {
      const product = productForDocUrl(doc.url);
      const rank = product ? wanted.indexOf(product.label) : -1;
      return { doc, rank };
    })
    .filter((entry) => entry.rank !== -1)
    .sort((a, b) => a.rank - b.rank);

  return ranked.map((entry) => entry.doc);
}

function productNames(action: RecommendedAction): string[] {
  return productsForAction(action).map((product) => product.label);
}

function namedProducts(action: RecommendedAction): string {
  return productNames(action).slice(0, 2).join(" and ");
}
