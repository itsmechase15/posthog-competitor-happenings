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
} from "../types.js";

const refSchema = z.object({
  url: z.string().min(1),
  claim: z.string().min(1),
  suggested_edit: z.string().min(1).optional(),
  suggestedEdit: z.string().min(1).optional(),
});

const lines = z.array(z.string().min(1)).max(8);

/** Either scale, so a row or a reply on the low/medium/high tokens still parses. */
const impactToken = z.enum([...IMPACTS, ...LEGACY_IMPACTS]);

export const analysisSchema = z.object({
  impact: impactToken.optional(),
  /** Phase 1 rows and older model replies call the same field severity. */
  severity: impactToken.optional(),
  summary: z.string().min(1).max(600),
  key_points: lines.optional(),
  keyPoints: lines.optional(),
  action: z.enum(ACTIONS),
  action_detail: z.string().min(1).max(900).optional(),
  actionDetail: z.string().min(1).max(900).optional(),
  posthog_refs: z.array(refSchema).max(5).optional(),
  posthogRefs: z.array(refSchema).max(5).optional(),
  open_questions: lines.optional(),
  openQuestions: lines.optional(),
});

/** Models drift between snake_case and camelCase; accept both and normalize. */
export function normalizeAnalysis(parsed: z.infer<typeof analysisSchema>): Analysis {
  const detail = parsed.action_detail ?? parsed.actionDetail;
  if (!detail) throw new Error("analysis is missing action_detail");

  const token = parsed.impact ?? parsed.severity;
  if (!token) throw new Error("analysis is missing impact");
  const impact = toImpact(token);

  const refs = parsed.posthog_refs ?? parsed.posthogRefs ?? [];
  const keyPoints = parsed.key_points ?? parsed.keyPoints ?? [];
  const openQuestions = parsed.open_questions ?? parsed.openQuestions ?? [];

  return {
    impact,
    summary: parsed.summary.trim(),
    keyPoints: keyPoints.map((point) => point.trim()).filter(Boolean),
    action: parsed.action,
    actionDetail: detail.trim(),
    posthogRefs: refs.map((ref) => {
      const suggestedEdit = ref.suggested_edit ?? ref.suggestedEdit;
      return {
        url: ref.url.trim(),
        claim: ref.claim.trim(),
        ...(suggestedEdit ? { suggestedEdit: suggestedEdit.trim() } : {}),
      };
    }),
    openQuestions: openQuestions.map((question) => question.trim()).filter(Boolean),
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
