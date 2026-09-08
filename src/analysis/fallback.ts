import { COMPETITORS } from "../config.js";
import type {
  Analysis,
  Impact,
  PostHogClaim,
  PostHogDoc,
  RecommendedAction,
  StoredItem,
} from "../types.js";
import { firstSentence, sentences, SPACED_EN_DASH, truncate } from "../util/text.js";

export const FALLBACK_MODEL = "fallback-heuristic";

/** Words that reliably mark a shipped capability rather than a tweak. */
const NOTABLE_SIGNALS = [
  "introduc",
  "launch",
  "now available",
  "general availability",
  "generally available",
  "new ",
  "announc",
  "beta",
  "agent",
  " ai ",
];

function bodyOf(item: StoredItem): string {
  const raw = item.raw as Record<string, unknown>;
  const candidate = raw.body ?? raw.preview ?? raw.text ?? "";
  return typeof candidate === "string" ? candidate : "";
}

/** The page's own summary beats its first paragraph, which is often a byline. */
function leadOf(item: StoredItem): string {
  const description = (item.raw as Record<string, unknown>).description;
  if (typeof description === "string" && description.trim().length > 0) {
    return truncate(stripLeadingLabel(description.trim()), 280);
  }
  return firstSentences(bodyOf(item), 280);
}

/** Changelogs often open with a bold "Description:" label that reads as noise in Slack. */
const LEADING_LABEL = /^\s*(description|summary|overview|what's new|tl;dr)\s*[:\u2013\u2014-]\s*/i;

function stripLeadingLabel(text: string): string {
  return text.replace(LEADING_LABEL, "");
}

function firstSentences(text: string, max: number): string {
  const trimmed = stripLeadingLabel(text.trim());
  if (!trimmed) return "";
  return truncate(sentences(trimmed).slice(0, 2).join(" ") || trimmed, max);
}

function impactOf(haystack: string): Impact {
  return NOTABLE_SIGNALS.some((signal) => haystack.includes(signal)) ? "notable" : "minor";
}

/**
 * Slack wants one sentence up top and short lines below it, so the source's
 * own lead is split rather than repeated in both places.
 */
function pointsFrom(lead: string, item: StoredItem): string[] {
  const rest = sentences(lead).slice(1);
  const source = rest.length > 0 ? rest : sentences(stripLeadingLabel(bodyOf(item))).slice(1, 4);
  return source
    .map((sentence) => truncate(sentence.trim(), 160))
    .filter((sentence) => sentence.length > 0)
    .slice(0, 3);
}

/**
 * Deterministic stand-in used when `CURSOR_API_KEY` is unset. It never invents
 * product facts. It restates the source and points at the pages we already
 * indexed, so a dry run is honest about being unanalyzed.
 */
export function heuristicAnalysis(
  item: StoredItem,
  claims: PostHogClaim[],
  docs: PostHogDoc[] = [],
): Analysis {
  const competitor = COMPETITORS[item.competitor];
  const haystack = `${item.title} ${bodyOf(item)}`.toLowerCase();
  const lead = leadOf(item);

  const seenUrls = new Set<string>();
  const refs = claims
    .filter((claim) => {
      if (seenUrls.has(claim.url)) return false;
      seenUrls.add(claim.url);
      return true;
    })
    .slice(0, 2)
    .map((claim) => ({ url: claim.url, claim: truncate(claim.paragraph, 240) }));

  // The docs pages this signal touches, so whoever picks the issue up can read
  // what PostHog already ships instead of taking the heuristic's word for it.
  const docRefs = docs
    .slice(0, 2)
    .map((doc) => ({ url: doc.url, claim: truncate(firstSentence(doc.excerpt, 240) || doc.title, 240) }));

  const summary = lead
    ? `${competitor.label}: ${firstSentence(lead, 240)}`
    : `${competitor.label} published "${item.title}".`;

  return {
    impact: impactOf(haystack),
    summary,
    keyPoints: pointsFrom(lead, item),
    actions: [fallbackAction(competitor.label, refs[0]?.url, docRefs[0]?.url)],
    posthogRefs: [...refs, ...docRefs],
    openQuestions: [],
  };
}

/**
 * The heuristic knows no PostHog product facts, so it never recommends
 * enhancing anything: that action has to name the feature to enhance, and
 * guessing one would be an invented fact. It points at page coverage instead,
 * which is the one thing the indexed claims actually tell us.
 */
function fallbackAction(
  label: string,
  closestPage: string | undefined,
  closestDoc: string | undefined,
): RecommendedAction {
  const preamble = "No model analysis ran, so this is unassessed.";
  const docHint = closestDoc
    ? ` What PostHog ships in this area is documented at ${closestDoc}; read it before treating anything here as a gap.`
    : "";

  if (closestPage) {
    return {
      type: "update_pages",
      detail: `${preamble} Closest indexed PostHog page is ${closestPage}${SPACED_EN_DASH}check whether it still describes ${label} accurately after this change.${docHint}`,
    };
  }
  return {
    type: "new_compare_page",
    detail: `${preamble} No indexed PostHog.com page mentions ${label} in a way that covers this, which is itself the gap worth checking.${docHint}`,
  };
}
