import { z } from "zod";
import { ACTIONS, SEVERITIES, type Analysis } from "../types.js";

const refSchema = z.object({
  url: z.string().min(1),
  claim: z.string().min(1),
  suggested_edit: z.string().min(1).optional(),
  suggestedEdit: z.string().min(1).optional(),
});

export const analysisSchema = z.object({
  severity: z.enum(SEVERITIES),
  summary: z.string().min(1).max(600),
  action: z.enum(ACTIONS),
  action_detail: z.string().min(1).max(900).optional(),
  actionDetail: z.string().min(1).max(900).optional(),
  posthog_refs: z.array(refSchema).max(5).optional(),
  posthogRefs: z.array(refSchema).max(5).optional(),
});

/** Models drift between snake_case and camelCase; accept both and normalize. */
export function normalizeAnalysis(parsed: z.infer<typeof analysisSchema>): Analysis {
  const detail = parsed.action_detail ?? parsed.actionDetail;
  if (!detail) throw new Error("analysis is missing action_detail");

  const refs = parsed.posthog_refs ?? parsed.posthogRefs ?? [];
  return {
    severity: parsed.severity,
    summary: parsed.summary.trim(),
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
