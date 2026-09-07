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
- "summary" is one or two sentences a marketer reads in Slack over coffee. Concrete, specific, no hype, no filler openers.
- "severity" is a label only. minor = cosmetic or incremental. notable = real capability PostHog customers will ask about. major = strategic move that changes the comparison.
- "action" must be exactly one of: update_pages, new_compare_page, consider_building, consider_enhancing.
  - update_pages: an existing PostHog page now says something stale or beatable.
  - new_compare_page: this deserves a comparison page PostHog does not have.
  - consider_building: PostHog has nothing like this.
  - consider_enhancing: PostHog has something adjacent with a real gap.
- "action_detail" explains the gap: what the competitor now does, what PostHog does or does not do, and the specific next step. Never generic "why this matters" copy.
- "posthog_refs" cites indexed PostHog URLs from the context below. Only cite URLs given to you. Include "suggested_edit" when the action is update_pages or new_compare_page. Use an empty array when no cited page is genuinely relevant.
- Do not invent product facts about PostHog or the competitor. If the source text is thin, say so in the summary and keep severity low.`;

export const RESPONSE_SHAPE = `{
  "severity": "minor" | "notable" | "major",
  "summary": "string",
  "action": "update_pages" | "new_compare_page" | "consider_building" | "consider_enhancing",
  "action_detail": "string",
  "posthog_refs": [{ "url": "string", "claim": "string", "suggested_edit": "string (optional)" }]
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
${body || "(no body text available — reason from the title and URL, and keep severity low)"}

## Indexed PostHog.com pages that mention ${competitor.label}
${renderClaims(claims)}

## Response
Reply with exactly this JSON shape:
${RESPONSE_SHAPE}`;
}
