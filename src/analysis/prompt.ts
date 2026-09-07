import { COMPETITORS } from "../config.js";
import type { PostHogClaim, StoredItem } from "../types.js";
import { truncate } from "../util/text.js";

const MAX_BODY_CHARS = 4_000;
const MAX_CLAIM_CHARS = 400;

function itemBody(item: StoredItem): string {
  const raw = item.raw as Record<string, unknown>;
  const parts = [raw.description, raw.body ?? raw.preview ?? raw.text].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );
  return truncate(parts.join("\n\n"), MAX_BODY_CHARS);
}

function renderClaims(claims: PostHogClaim[]): string {
  if (claims.length === 0) {
    return "(no indexed PostHog.com pages mention this competitor yet)";
  }
  return claims
    .map((claim, index) => {
      const heading = claim.heading ? ` — section "${claim.heading}"` : "";
      return `${index + 1}. ${claim.url}${heading}\n   "${truncate(claim.paragraph, MAX_CLAIM_CHARS)}"`;
    })
    .join("\n");
}

export const SYSTEM_RULES = `You are a competitive-intelligence analyst for PostHog, an open-source product analytics platform.
You read one thing a competitor shipped and decide what PostHog should do about it.

Rules:
- Reply with a single JSON object and nothing else. No prose, no code fences.
- "summary" is exactly one sentence, and it is the only line most people read. Name the competitor and what changed. Concrete, specific, no hype, no filler openers.
- "key_points" is 2 to 4 short lines of substance that go under a "More detail" heading, below the summary and the impact: what it does, who it is for, what it replaces, what is still missing. Fragments, not paragraphs — under 140 characters each. No line repeats the summary.
- "impact" is a label only. minor = cosmetic or incremental. notable = real capability PostHog customers will ask about. major = strategic move that changes the comparison.
- "action" must be exactly one of: update_pages, new_compare_page, consider_building, consider_enhancing.
  - update_pages: an existing PostHog page now says something stale or beatable.
  - new_compare_page: this deserves a comparison page PostHog does not have.
  - consider_building: PostHog has nothing like this.
  - consider_enhancing: PostHog has something adjacent with a real gap.
- "action_detail" explains the gap: what the competitor now does, what PostHog does or does not do, and the specific next step. Never generic "why this matters" copy. Its first sentence is shown on its own, so make that sentence stand up alone.
- "posthog_refs" cites indexed PostHog URLs from the context below. Only cite URLs given to you. Include "suggested_edit" when the action is update_pages or new_compare_page. Use an empty array when no cited page is genuinely relevant.
- "open_questions" is 0 to 3 things the source does not answer that change what PostHog should do. Skip anything you can answer from the source.
- Do not invent product facts about PostHog or the competitor. If the source text is thin, say so in the summary and keep impact minor.`;

export const RESPONSE_SHAPE = `{
  "impact": "minor" | "notable" | "major",
  "summary": "string (one sentence)",
  "key_points": ["string", "string"],
  "action": "update_pages" | "new_compare_page" | "consider_building" | "consider_enhancing",
  "action_detail": "string",
  "posthog_refs": [{ "url": "string", "claim": "string", "suggested_edit": "string (optional)" }],
  "open_questions": ["string"]
}`;

export function buildAnalysisPrompt(item: StoredItem, claims: PostHogClaim[]): string {
  const competitor = COMPETITORS[item.competitor];
  const body = itemBody(item);

  return `${SYSTEM_RULES}

## Competitor signal
Competitor: ${competitor.label}
Source: ${item.source}
Title: ${item.title}
URL: ${item.url}
Published: ${item.publishedAt?.toISOString() ?? "unknown"}

Content:
${body || "(no body text available — reason from the title and URL, and keep impact minor)"}

## Indexed PostHog.com pages that mention ${competitor.label}
${renderClaims(claims)}

## Response
Reply with exactly this JSON shape:
${RESPONSE_SHAPE}`;
}
