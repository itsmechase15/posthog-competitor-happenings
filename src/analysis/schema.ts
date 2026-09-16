import { z } from "zod";
import {
  ACTIONS,
  IMAGE_ORIGINS,
  IMPACTS,
  LEGACY_IMPACTS,
  NO_ACTION_KINDS,
  REVIEW_VERDICTS,
  toImpact,
  type ActionIssue,
  type Analysis,
  type FeatureImage,
  type NoAction,
  type RecommendedAction,
} from "../types.js";
import { parseDate, sanitizeCopy } from "../util/text.js";
import { UNSTATED_NO_ACTION_REASON } from "./noAction.js";

/**
 * A field the model means to leave out but sends as "" instead. Read as
 * absent, because the alternative is throwing away a whole good analysis over
 * one empty string: a reply that correctly gave no `feature` to an
 * update_pages action, by writing `"feature": ""`, used to fail the parse and
 * take the other two actions down with it.
 */
function blankAsMissing(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

const optionalText = (max: number) =>
  z.preprocess(blankAsMissing, z.string().min(1).max(max).optional());

/** Blank entries are dropped rather than failing the list they are in. */
const lines = z.preprocess(
  (value) =>
    Array.isArray(value)
      ? value.filter((entry) => typeof entry !== "string" || entry.trim() !== "")
      : value,
  z.array(z.string().min(1)).max(8),
);

/** A paragraph of replacement copy, which runs longer than a one-line instruction. */
const proposedText = optionalText(1_200);

const refSchema = z.object({
  url: z.string().min(1),
  claim: z.string().min(1),
  suggested_edit: optionalText(600),
  suggestedEdit: optionalText(600),
  proposed_text: proposedText,
  proposedText,
  replacement_text: proposedText,
});

/** A citation with no page or no claim says nothing, so it goes rather than throws. */
const refs = z.preprocess(
  (value) =>
    Array.isArray(value)
      ? value.filter((entry) => {
          if (typeof entry !== "object" || entry === null) return false;
          const ref = entry as { url?: unknown; claim?: unknown };
          return (
            typeof ref.url === "string" &&
            ref.url.trim() !== "" &&
            typeof ref.claim === "string" &&
            ref.claim.trim() !== ""
          );
        })
      : value,
  z.array(refSchema).max(5),
);

/** Either scale, so a row or a reply on the low/medium/high tokens still parses. */
const impactToken = z.enum([...IMPACTS, ...LEGACY_IMPACTS]);

const actionToken = z.enum(ACTIONS);
const detail = optionalText(900);
const feature = optionalText(120);
const gap = optionalText(400);
const quote = optionalText(600);

/** Small team names, blanks dropped. Validated against the catalog later. */
const teamNames = z.preprocess(
  (value) =>
    Array.isArray(value)
      ? value.filter((entry) => typeof entry === "string" && entry.trim() !== "")
      : value,
  z.array(z.string().min(1)).max(5).optional(),
);

/** One entry of `actions`, in whichever casing the model reached for. */
const actionSchema = z.object({
  type: actionToken.optional(),
  action: actionToken.optional(),
  detail,
  action_detail: detail,
  actionDetail: detail,
  feature,
  posthog_feature: feature,
  posthogFeature: feature,
  teams: teamNames,
  posthog_teams: teamNames,
  posthogTeams: teamNames,
  gap,
  gap_today: gap,
  evidence_url: optionalText(500),
  evidenceUrl: optionalText(500),
  evidence_quote: quote,
  evidenceQuote: quote,
});

/**
 * The verdict when there are no actions. The kind is read loosely: a model that
 * invents one loses the title it would have picked, not the sentence it wrote.
 */
const noActionSchema = z
  .object({
    kind: optionalText(60),
    reason: optionalText(600),
    no_action_reason: optionalText(600),
    evidence: z
      .preprocess(
        (value) =>
          Array.isArray(value)
            ? value.filter(
                (entry) =>
                  typeof entry === "object" &&
                  entry !== null &&
                  typeof (entry as { url?: unknown }).url === "string" &&
                  (entry as { url: string }).url.trim() !== "",
              )
            : value,
        z.array(
          z.object({
            url: z.string().min(1),
            title: optionalText(300),
            quote: optionalText(600),
          }),
        ),
      )
      .optional(),
  })
  .optional();

export const analysisSchema = z.object({
  impact: impactToken.optional(),
  /** Phase 1 rows and older model replies call the same field severity. */
  severity: impactToken.optional(),
  summary: z.string().min(1).max(600),
  key_points: lines.optional(),
  keyPoints: lines.optional(),
  actions: z.array(actionSchema).max(4).optional(),
  /** A single action is how rows written before this field looked. */
  action: actionToken.optional(),
  action_detail: detail,
  actionDetail: detail,
  feature,
  posthog_feature: feature,
  posthogFeature: feature,
  no_action: noActionSchema,
  noAction: noActionSchema,
  no_action_reason: optionalText(600),
  noActionReason: optionalText(600),
  posthog_refs: refs.optional(),
  posthogRefs: refs.optional(),
  open_questions: lines.optional(),
  openQuestions: lines.optional(),
  pages_read: lines.optional(),
  pagesRead: lines.optional(),
});

/**
 * Zero to three. The cap is Slack's: a fourth action would not render, and an
 * alert asking for four things is an alert nobody starts.
 */
export const MAX_ACTIONS = 3;

/** Every string a model wrote is punctuated PostHog's way before anything renders it. */
function clean(value: string): string {
  return sanitizeCopy(value).trim();
}

/** An entry is only usable when it says both what to do and why. */
function toAction(parsed: z.infer<typeof actionSchema>): RecommendedAction | null {
  const type = parsed.type ?? parsed.action;
  const detail = parsed.detail ?? parsed.action_detail ?? parsed.actionDetail;
  if (!type || !detail) return null;

  const feature = parsed.feature ?? parsed.posthog_feature ?? parsed.posthogFeature;
  const teams = parsed.teams ?? parsed.posthog_teams ?? parsed.posthogTeams;
  const namedGap = parsed.gap ?? parsed.gap_today;
  const evidenceUrl = parsed.evidence_url ?? parsed.evidenceUrl;
  const evidenceQuote = parsed.evidence_quote ?? parsed.evidenceQuote;
  return {
    type,
    detail: clean(detail),
    ...(feature ? { feature: clean(feature) } : {}),
    ...(teams && teams.length > 0 ? { teams: teams.map((team) => team.trim()) } : {}),
    ...(namedGap ? { gap: clean(namedGap) } : {}),
    ...(evidenceUrl ? { evidenceUrl: evidenceUrl.trim() } : {}),
    // Not punctuation-corrected: a quote is checked character by character
    // against the stored page, and rewriting its dashes would fail that check.
    ...(evidenceQuote ? { evidenceQuote: evidenceQuote.trim() } : {}),
  };
}

/**
 * An alert can need several actions, and can need none. Replies and rows
 * written before `actions` existed carry exactly one, inline, so they are read
 * as a list of one.
 */
function readActions(parsed: z.infer<typeof analysisSchema>): RecommendedAction[] {
  const listed = (parsed.actions ?? [])
    .map(toAction)
    .filter((action): action is RecommendedAction => action !== null);
  if (listed.length > 0) return listed.slice(0, MAX_ACTIONS);

  const single = toAction(parsed);
  if (single) return [single];
  // An empty list is an answer: plenty of launches ask nothing of PostHog.
  // Nothing at all under `actions` is a reply that did not answer the field,
  // and only the reason it gives makes the difference readable.
  if (Array.isArray(parsed.actions)) return [];
  if (parsed.no_action ?? parsed.noAction ?? parsed.no_action_reason ?? parsed.noActionReason) {
    return [];
  }
  throw new Error("analysis is missing its actions list");
}

/**
 * The verdict an empty reply came with.
 *
 * A structured one is read as written, with a kind we recognize or `unverified`
 * when the model invented one. A bare sentence – which is every row stored
 * before the verdict had a shape, and every model that reached for the old
 * field – is unverified too: it may well be right that PostHog ships this, and
 * nothing in it names the page that would show so.
 */
function readNoAction(parsed: z.infer<typeof analysisSchema>): NoAction {
  const structured = parsed.no_action ?? parsed.noAction;
  const stated = parsed.no_action_reason ?? parsed.noActionReason;
  const reason = structured?.reason ?? structured?.no_action_reason ?? stated;
  const kind = NO_ACTION_KINDS.find((known) => known === structured?.kind?.trim());

  return {
    kind: kind ?? "unverified",
    reason: clean(reason ?? UNSTATED_NO_ACTION_REASON),
    evidence: (structured?.evidence ?? []).map((entry) => ({
      url: entry.url.trim(),
      ...(entry.title ? { title: clean(entry.title) } : {}),
      // A quote is matched character by character against the stored page, so
      // it is the one string here that is not repunctuated.
      ...(entry.quote ? { quote: entry.quote.trim() } : {}),
    })),
  };
}

/** Models drift between snake_case and camelCase; accept both and normalize. */
export function normalizeAnalysis(parsed: z.infer<typeof analysisSchema>): Analysis {
  const actions = readActions(parsed);

  const token = parsed.impact ?? parsed.severity;
  if (!token) throw new Error("analysis is missing impact");
  const impact = toImpact(token);

  const refs = parsed.posthog_refs ?? parsed.posthogRefs ?? [];
  const keyPoints = parsed.key_points ?? parsed.keyPoints ?? [];
  const openQuestions = parsed.open_questions ?? parsed.openQuestions ?? [];
  const pagesRead = parsed.pages_read ?? parsed.pagesRead ?? [];
  const noAction = actions.length > 0 ? undefined : readNoAction(parsed);

  return {
    impact,
    summary: clean(parsed.summary),
    keyPoints: keyPoints.map(clean).filter(Boolean),
    actions,
    ...(noAction ? { noAction, noActionReason: noAction.reason } : {}),
    posthogRefs: refs.map((ref) => {
      const suggestedEdit = ref.suggested_edit ?? ref.suggestedEdit;
      const proposed = ref.proposed_text ?? ref.proposedText ?? ref.replacement_text;
      return {
        url: ref.url.trim(),
        claim: clean(ref.claim),
        ...(suggestedEdit ? { suggestedEdit: clean(suggestedEdit) } : {}),
        // Punctuated PostHog's way like everything else the bot publishes:
        // this string is destined for a posthog.com page, so an em dash the
        // model slipped in is fixed here rather than pasted onto the site.
        ...(proposed ? { proposedText: clean(proposed) } : {}),
      };
    }),
    openQuestions: openQuestions.map(clean).filter(Boolean),
    ...(pagesRead.length > 0 ? { pagesRead: pagesRead.map((url) => url.trim()) } : {}),
  };
}

const imageSchema = z.object({
  url: z.string().min(1),
  altText: z.string().default(""),
  origin: z.enum(IMAGE_ORIGINS).default("page"),
});

const issueSchema = z.object({
  url: z.string().min(1),
  number: z.number().int().nonnegative(),
});

/**
 * The review one action got. Stored so a retry of an analysis that never
 * reached Slack finds the verdict already there and does not review again: the
 * loop runs once per action, not once per attempt to post it.
 */
const reviewSchema = z.object({
  verdict: z.enum(REVIEW_VERDICTS),
  model: z.string().min(1),
  at: z.preprocess((value) => (value instanceof Date ? value.toISOString() : value), z.string().min(1)),
  reason: z.string().min(1),
  applied: z.boolean().optional(),
});

/** One action's issue, stored in the same order as `actions`. */
const actionIssueSchema = z.object({
  type: actionToken.optional(),
  feature: feature.optional(),
  issue: issueSchema.optional().nullable(),
  review: reviewSchema.optional().nullable(),
});

/**
 * What actually goes in `analyses.analysis`: the verdict plus the picture and
 * the issues it was posted with, so a retry re-posts the same alert instead of
 * re-resolving an image and opening a second set of issues.
 */
export const alertPayloadSchema = analysisSchema.extend({
  image: imageSchema.optional().nullable(),
  issues: z.array(actionIssueSchema).max(4).optional().nullable(),
  /** How a row written before an alert had one issue per action stored it. */
  issue: issueSchema.optional().nullable(),
});

export interface StoredAlertPayload {
  analysis: Analysis;
  image: FeatureImage | null;
  /** One entry per action, in order, whether or not an issue was opened for it. */
  issues: ActionIssue[];
}

/**
 * Pair each action with its issue. A row from before the split carries one
 * issue for the whole alert, which belonged to the first action, so that is
 * where it is read back.
 */
function readActionIssues(
  parsed: z.infer<typeof alertPayloadSchema>,
  actions: RecommendedAction[],
): ActionIssue[] {
  const stored = parsed.issues ?? null;
  return actions.map((action, index) => {
    const review = stored?.[index]?.review;
    return {
      action,
      issue: stored
        ? (stored[index]?.issue ?? null)
        : index === 0
          ? (parsed.issue ?? null)
          : null,
      ...(review
        ? {
            review: {
              verdict: review.verdict,
              model: review.model,
              at: parseDate(review.at) ?? new Date(0),
              reason: review.reason,
              ...(review.applied === undefined ? {} : { applied: review.applied }),
            },
          }
        : {}),
    };
  });
}

export function parseStoredAlert(raw: unknown): StoredAlertPayload {
  const parsed = alertPayloadSchema.parse(raw);
  const analysis = normalizeAnalysis(parsed);
  return {
    analysis,
    image: parsed.image ?? null,
    issues: readActionIssues(parsed, analysis.actions),
  };
}

export function serializeAlertPayload(
  analysis: Analysis,
  image: FeatureImage | null,
  issues: ActionIssue[],
): Record<string, unknown> {
  return {
    ...analysis,
    image,
    issues: issues.map(({ action, issue, review }) => ({
      type: action.type,
      ...(action.feature ? { feature: action.feature } : {}),
      issue,
      ...(review ? { review: { ...review, at: review.at.toISOString() } } : {}),
    })),
  };
}

/**
 * Agent replies often wrap JSON in prose or fences. Pull out the first
 * balanced JSON object rather than trusting the whole response to parse.
 */
export function extractJsonObject(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced?.[1] ?? raw).trim();

  const start = text.indexOf("{");
  if (start === -1) throw new Error("no JSON object found in model output");

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  throw new Error("unterminated JSON object in model output");
}

export function parseAnalysis(raw: string): Analysis {
  const json = JSON.parse(extractJsonObject(raw)) as unknown;
  return normalizeAnalysis(analysisSchema.parse(json));
}
