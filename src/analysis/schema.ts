import { z } from "zod";
import {
  ACTIONS,
  IMAGE_ORIGINS,
  IMPACTS,
  LEGACY_IMPACTS,
  toImpact,
  type Analysis,
  type FeatureImage,
  type IssueRef,
  type RecommendedAction,
} from "../types.js";
import { sanitizeCopy } from "../util/text.js";

const refSchema = z.object({
  url: z.string().min(1),
  claim: z.string().min(1),
  suggested_edit: z.string().min(1).optional(),
  suggestedEdit: z.string().min(1).optional(),
});

const lines = z.array(z.string().min(1)).max(8);

/** Either scale, so a row or a reply on the low/medium/high tokens still parses. */
const impactToken = z.enum([...IMPACTS, ...LEGACY_IMPACTS]);

const actionToken = z.enum(ACTIONS);
const detail = z.string().min(1).max(900);
/**
 * Always optional, and a model that writes `""` means it named no product. Read
 * that as absent rather than rejecting it: the feature is decoration on the
 * action title, `verifyAgainstDocs` can recover the name from the docs anyway,
 * and refusing the reply throws away the whole verdict over a blank field.
 */
const feature = z.string().max(120).transform((value) => value.trim() || undefined);

/** One entry of `actions`, in whichever casing the model reached for. */
const actionSchema = z.object({
  type: actionToken.optional(),
  action: actionToken.optional(),
  detail: detail.optional(),
  action_detail: detail.optional(),
  actionDetail: detail.optional(),
  feature: feature.optional(),
  posthog_feature: feature.optional(),
  posthogFeature: feature.optional(),
});

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
  action_detail: detail.optional(),
  actionDetail: detail.optional(),
  feature: feature.optional(),
  posthog_feature: feature.optional(),
  posthogFeature: feature.optional(),
  posthog_refs: z.array(refSchema).max(5).optional(),
  posthogRefs: z.array(refSchema).max(5).optional(),
  open_questions: lines.optional(),
  openQuestions: lines.optional(),
});

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
  return {
    type,
    detail: clean(detail),
    ...(feature ? { feature: clean(feature) } : {}),
  };
}

/**
 * An alert can need several actions. Replies and rows written before `actions`
 * existed carry exactly one, inline, so they are read as a list of one.
 */
function readActions(parsed: z.infer<typeof analysisSchema>): RecommendedAction[] {
  const listed = (parsed.actions ?? [])
    .map(toAction)
    .filter((action): action is RecommendedAction => action !== null);
  if (listed.length > 0) return listed;

  const single = toAction(parsed);
  if (!single) throw new Error("analysis is missing an action with an action_detail");
  return [single];
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

  return {
    impact,
    summary: clean(parsed.summary),
    keyPoints: keyPoints.map(clean).filter(Boolean),
    actions,
    posthogRefs: refs.map((ref) => {
      const suggestedEdit = ref.suggested_edit ?? ref.suggestedEdit;
      return {
        url: ref.url.trim(),
        claim: clean(ref.claim),
        ...(suggestedEdit ? { suggestedEdit: clean(suggestedEdit) } : {}),
      };
    }),
    openQuestions: openQuestions.map(clean).filter(Boolean),
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
 * What actually goes in `analyses.analysis`: the verdict plus the picture and
 * the issue it was posted with, so a retry re-posts the same alert instead of
 * re-resolving an image and opening a second issue.
 */
export const alertPayloadSchema = analysisSchema.extend({
  image: imageSchema.optional().nullable(),
  issue: issueSchema.optional().nullable(),
});

export interface StoredAlertPayload {
  analysis: Analysis;
  image: FeatureImage | null;
  issue: IssueRef | null;
}

export function parseStoredAlert(raw: unknown): StoredAlertPayload {
  const parsed = alertPayloadSchema.parse(raw);
  return {
    analysis: normalizeAnalysis(parsed),
    image: parsed.image ?? null,
    issue: parsed.issue ?? null,
  };
}

export function serializeAlertPayload(
  analysis: Analysis,
  image: FeatureImage | null,
  issue: IssueRef | null,
): Record<string, unknown> {
  return { ...analysis, image, issue };
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
