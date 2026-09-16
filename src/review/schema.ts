import { z } from "zod";
import { isMarketingTarget } from "../posthog/pages.js";
import { findProductByName } from "../posthog/products.js";
import { extractJsonObject } from "../analysis/schema.js";
import {
  ACTIONS,
  IMPACTS,
  LEGACY_IMPACTS,
  REVIEW_VERDICTS,
  toImpact,
  type Action,
  type Impact,
  type PostHogRef,
  type RecommendedAction,
  type ReviewVerdict,
} from "../types.js";
import { sanitizeCopy } from "../util/text.js";

/**
 * The two replies in the review pass, read the same defensive way the analysis
 * reply is: a blank string is an absent field, an unusable entry is dropped
 * rather than throwing, and nothing a model writes is trusted to be in the
 * shape it was asked for.
 *
 * The rules about what a rewrite may change live here rather than in the
 * prompt, because a prompt is a request and this is the answer. A writer that
 * renames the feature to something the catalog has never heard of, or retypes a
 * page action into a product one, is a writer whose extra changes are dropped
 * on the way in.
 */

function blankAsMissing(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

const optionalText = (max: number) =>
  z.preprocess(blankAsMissing, z.string().min(1).max(max).optional());

const urls = z.preprocess(
  (value) =>
    Array.isArray(value)
      ? value.filter((entry) => typeof entry === "string" && entry.trim() !== "")
      : value,
  z.array(z.string().min(1)).max(12).optional(),
);

const lines = z.preprocess(
  (value) =>
    Array.isArray(value)
      ? value.filter((entry) => typeof entry === "string" && entry.trim() !== "")
      : value,
  z.array(z.string().min(1)).max(6).optional(),
);

const impactToken = z.preprocess(blankAsMissing, z.enum([...IMPACTS, ...LEGACY_IMPACTS]).optional());
const actionToken = z.preprocess(blankAsMissing, z.enum(ACTIONS).optional());

export const reviewSchema = z.object({
  verdict: z.enum(REVIEW_VERDICTS),
  reason: z.string().min(1).max(900),
  pages_checked: urls,
  pagesChecked: urls,
  changes: lines,
  requested_changes: lines,
  impact: impactToken,
  action_type: actionToken,
  actionType: actionToken,
});

/** What one reviewer run decided, before the pages it actually opened are attached. */
export interface ReviewDecision {
  verdict: ReviewVerdict;
  /** One or two sentences. The issue comment quotes this. */
  reason: string;
  /** Pages the reviewer says it read. Its own account, not the observed list. */
  pagesChecked: string[];
  /** What it wants changed, which is all the writer is told to act on. */
  changes: string[];
  /** The impact it says is right. A rewrite may only move impact when this is set. */
  impact?: Impact;
  /** The action type it says is right. Only a product-to-product switch is honored. */
  actionType?: Action;
}

function clean(value: string): string {
  return sanitizeCopy(value).trim();
}

export function parseReview(raw: string): ReviewDecision {
  const parsed = reviewSchema.parse(JSON.parse(extractJsonObject(raw)) as unknown);
  const impact = parsed.impact;
  const actionType = parsed.action_type ?? parsed.actionType;

  return {
    verdict: parsed.verdict,
    reason: clean(parsed.reason),
    pagesChecked: (parsed.pages_checked ?? parsed.pagesChecked ?? []).map((url) => url.trim()),
    changes: (parsed.changes ?? parsed.requested_changes ?? []).map(clean).filter(Boolean),
    ...(impact ? { impact: toImpact(impact) } : {}),
    ...(actionType ? { actionType } : {}),
  };
}

const editSchema = z.object({
  url: z.string().min(1),
  suggested_edit: optionalText(600),
  suggestedEdit: optionalText(600),
});

export const revisionSchema = z.object({
  type: actionToken,
  action: actionToken,
  detail: optionalText(900),
  gap: optionalText(400),
  feature: optionalText(120),
  evidence_url: optionalText(500),
  evidenceUrl: optionalText(500),
  evidence_quote: optionalText(600),
  evidenceQuote: optionalText(600),
  impact: impactToken,
  suggested_edits: z.preprocess(
    (value) =>
      Array.isArray(value)
        ? value.filter((entry) => {
            if (typeof entry !== "object" || entry === null) return false;
            return typeof (entry as { url?: unknown }).url === "string";
          })
        : value,
    z.array(editSchema).max(4).optional(),
  ),
});

/** One rewrite, as the writer sent it. Nothing here has been allowed onto the action yet. */
export interface Revision {
  type?: Action;
  detail?: string;
  gap?: string;
  feature?: string;
  evidenceUrl?: string;
  evidenceQuote?: string;
  impact?: Impact;
  suggestedEdits: Array<{ url: string; suggestedEdit: string }>;
}

export function parseRevision(raw: string): Revision {
  const parsed = revisionSchema.parse(JSON.parse(extractJsonObject(raw)) as unknown);
  const type = parsed.type ?? parsed.action;
  const evidenceUrl = parsed.evidence_url ?? parsed.evidenceUrl;
  const evidenceQuote = parsed.evidence_quote ?? parsed.evidenceQuote;

  return {
    ...(type ? { type } : {}),
    ...(parsed.detail ? { detail: clean(parsed.detail) } : {}),
    ...(parsed.gap ? { gap: clean(parsed.gap) } : {}),
    ...(parsed.feature ? { feature: clean(parsed.feature) } : {}),
    ...(evidenceUrl ? { evidenceUrl: evidenceUrl.trim() } : {}),
    // Not punctuation-corrected, for the same reason the analysis reply is not:
    // the quote is matched character by character against the stored page, and
    // rewriting its dashes would fail that check.
    ...(evidenceQuote ? { evidenceQuote: evidenceQuote.trim() } : {}),
    ...(parsed.impact ? { impact: toImpact(parsed.impact) } : {}),
    suggestedEdits: (parsed.suggested_edits ?? []).flatMap((edit) => {
      const suggestedEdit = edit.suggested_edit ?? edit.suggestedEdit;
      return suggestedEdit ? [{ url: edit.url.trim(), suggestedEdit: clean(suggestedEdit) }] : [];
    }),
  };
}

/** The product actions, which are the only two a rewrite may switch between. */
const PRODUCT_ACTIONS: readonly Action[] = ["consider_building", "consider_enhancing"];

export interface MergeResult {
  action: RecommendedAction;
  refs: PostHogRef[];
  /** The impact the rewritten alert carries. Unchanged unless the reviewer moved it. */
  impact: Impact;
  /** What was refused, for the run log and the issue comment. */
  notes: string[];
}

/**
 * Fold a rewrite into the action that was filed.
 *
 * A rewrite is a correction to one action, not a second analysis, so this is
 * where the writer's reach is bounded:
 *
 * - The type may only move between the two product actions. A page action that
 *   comes back as `consider_building`, or anything at all that comes back as a
 *   type the reviewer never asked for, keeps the type it was filed with. There
 *   is no path into `update_pages` or `new_compare_page`: those send someone to
 *   edit posthog.com, and a rewrite of a product recommendation has no business
 *   turning into one.
 * - `feature` has to be a name the catalog knows, and it lands in the catalog's
 *   own casing. A feature nobody can look up is a label nobody can query and a
 *   title that names nothing.
 * - Impact moves only when the reviewer said it was wrong. The writer's own
 *   opinion about impact is not asked for and not taken.
 * - A suggested edit may only replace one on a page the analysis already cited,
 *   and only where that page is somewhere marketing writes. Inventing a page to
 *   edit is the mistake this whole pass exists to catch, in a smaller form.
 */
export function mergeRevision(
  action: RecommendedAction,
  refs: PostHogRef[],
  revision: Revision,
  review: ReviewDecision,
  impact: Impact,
): MergeResult {
  const notes: string[] = [];
  const revised: RecommendedAction = { ...action };

  if (revision.type && revision.type !== action.type) {
    if (PRODUCT_ACTIONS.includes(revision.type) && PRODUCT_ACTIONS.includes(action.type)) {
      revised.type = revision.type;
    } else {
      notes.push(
        `refused a type change from ${action.type} to ${revision.type}: only consider_building and consider_enhancing may swap`,
      );
    }
  }

  if (revision.detail) revised.detail = revision.detail;
  if (revision.gap) revised.gap = revision.gap;
  if (revision.evidenceUrl) revised.evidenceUrl = revision.evidenceUrl;
  if (revision.evidenceQuote) revised.evidenceQuote = revision.evidenceQuote;

  if (revision.feature && revision.feature !== action.feature) {
    const product = findProductByName(revision.feature);
    if (product) revised.feature = product.label;
    else {
      notes.push(
        `kept the feature as ${action.feature ?? "unnamed"}: the catalog has no product called "${revision.feature}"`,
      );
    }
  }

  const nextImpact = review.impact ?? impact;
  if (!review.impact && revision.impact && revision.impact !== impact) {
    notes.push(
      `kept impact at ${impact}: the reviewer did not say it was wrong, so a rewrite does not move it`,
    );
  }

  const citedUrls = new Set(refs.map((ref) => ref.url));
  const edits = new Map<string, string>();
  for (const edit of revision.suggestedEdits) {
    if (!citedUrls.has(edit.url)) {
      notes.push(`dropped a suggested edit for ${edit.url}, which this analysis never cited`);
      continue;
    }
    if (!isMarketingTarget(edit.url)) {
      notes.push(`dropped a suggested edit for ${edit.url}, which is not a page marketing writes`);
      continue;
    }
    edits.set(edit.url, edit.suggestedEdit);
  }

  return {
    action: revised,
    refs: refs.map((ref) => {
      const suggestedEdit = edits.get(ref.url);
      return suggestedEdit ? { ...ref, suggestedEdit } : ref;
    }),
    impact: nextImpact,
    notes,
  };
}
