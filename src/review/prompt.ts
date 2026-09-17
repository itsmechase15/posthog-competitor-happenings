import { COMPETITORS } from "../config.js";
import { actionLabel } from "../labels.js";
import { isMarketingTarget } from "../posthog/pages.js";
import { EVIDENCE_LABEL, TOC_FILENAME, type DocsWorkspace } from "../posthog/workspace.js";
import { PAGE_REWRITE_RULES, STYLE_RULES } from "../analysis/prompt.js";
import { describeProportion, MIN_GROWTH_WORDS } from "../analysis/proportion.js";
import type { CorpusIndex } from "../posthog/retrieval.js";
import { MAX_ACTION_CHARS } from "../slack/message.js";
import type {
  AnalyzedItem,
  Impact,
  PostHogDoc,
  PostHogRef,
  RecommendedAction,
} from "../types.js";
import { EN_DASH, truncate } from "../util/text.js";
import type { ReviewDecision } from "./schema.js";

/**
 * The two prompts of the review pass.
 *
 * This is not the guess-then-fix pass the analyst deliberately does not have.
 * That pass shows one model its own claim and asks it to check itself, which
 * gets a better-argued guess rather than a checked one. This is a different
 * model, reading the same corpus, told what the first one claimed and asked
 * whether the docs bear it out – and whatever it decides, the rewrite goes back
 * through the same evidence checks in code before anyone sees it.
 */

const MAX_EXCERPT_CHARS = 900;
const MAX_DETAIL_CHARS = 1_200;

export interface ReviewInput {
  /** The alert the action came out of, with the docs it was checked against. */
  alert: AnalyzedItem;
  action: RecommendedAction;
  /** The corpus on disk, which the reviewer searches read-only. Null runs it on the prompt alone. */
  workspace: DocsWorkspace | null;
  /** Corpus excerpts already ranked for this signal, as a starting point. */
  docs: PostHogDoc[];
  /**
   * The corpus in memory, for the one thing the excerpts cannot answer: how
   * long the page an edit lands on actually is. Absent leaves the size line
   * out rather than guessing at it.
   */
  index?: CorpusIndex;
}

export interface RewriteInput {
  alert: AnalyzedItem;
  action: RecommendedAction;
  /** What the reviewer decided and what it asked for. */
  review: ReviewDecision;
  /**
   * Every page the rewrite may quote: the excerpts the analysis was checked
   * against, plus the pages the reviewer opened. A quote from anywhere else
   * fails the evidence check and throws the rewrite away.
   */
  docs: PostHogDoc[];
  /** The same as on a review: how long the page being rewritten is. */
  index?: CorpusIndex;
}

/** A page action's rewrite is copy for posthog.com; a product action's is a claim about it. */
function isPageAction(action: RecommendedAction): boolean {
  return action.type === "update_pages" || action.type === "new_compare_page";
}

function renderDocs(docs: PostHogDoc[]): string {
  if (docs.length === 0) {
    return "(nothing was pre-loaded, so search the workspace yourself)";
  }
  return docs
    .map((doc, index) => {
      const kind = doc.kind && doc.kind !== "docs" ? ` [${EVIDENCE_LABEL[doc.kind]}]` : "";
      return `${index + 1}. ${doc.title}${kind}\n   ${doc.url}\n   "${truncate(doc.excerpt, MAX_EXCERPT_CHARS)}"`;
    })
    .join("\n");
}

/**
 * The page edits this action carries: what the page says now, the copy proposed
 * for it, and the one-line reason. These are the only strings a rewrite may
 * replace, and for an `update_pages` action the proposed copy is the substance
 * of the recommendation, so it is shown in full rather than summarized.
 */
function renderEdits(
  refs: PostHogRef[],
  action: RecommendedAction,
  index: CorpusIndex | null,
): string {
  // For a page action, every page it could edit is listed whether or not copy
  // came back for it, because a page action with no copy is itself the finding.
  const edits = isPageAction(action)
    ? refs.filter((ref) => isMarketingTarget(ref.url))
    : refs.filter((ref) => ref.suggestedEdit ?? ref.proposedText);
  if (edits.length === 0) return "(none)";
  return edits
    .map((ref) => {
      const lines = [`- ${ref.url}`, `  on the page today: "${ref.claim}"`];
      lines.push(
        ref.proposedText
          ? `  copy proposed for it: "${ref.proposedText}"`
          : "  copy proposed for it: (none, which is a revise on its own for update_pages)",
      );
      if (ref.suggestedEdit) lines.push(`  why: "${ref.suggestedEdit}"`);
      // How long the page is, so "is this edit proportional to the page?" is a
      // question with numbers under it rather than a guess at a page the
      // reviewer may never open.
      const proportion = describeProportion(index?.page(ref.url), ref);
      if (proportion) lines.push(`  size: ${proportion}`);
      return lines.join("\n");
    })
    .join("\n");
}

/** One action exactly as it was filed, so both models judge the same thing. */
export function renderFiledAction(
  alert: AnalyzedItem,
  action: RecommendedAction,
  index: CorpusIndex | null = null,
): string {
  const competitor = COMPETITORS[alert.item.competitor].label;
  return [
    `Competitor: ${competitor}`,
    `Signal: ${alert.item.title}`,
    `Signal URL: ${alert.item.url}`,
    `Alert summary: ${alert.analysis.summary}`,
    `Alert impact: ${alert.analysis.impact}`,
    "",
    `Action title: ${actionLabel(action)}`,
    `Action type: ${action.type}`,
    `PostHog feature named: ${action.feature ?? "(none)"}`,
    `Detail: ${truncate(action.detail, MAX_DETAIL_CHARS)}`,
    `Gap claimed: ${action.gap ?? "(none)"}`,
    `Evidence page: ${action.evidenceUrl ?? "(none)"}`,
    `Evidence quote: ${action.evidenceQuote ? `"${action.evidenceQuote}"` : "(none)"}`,
    `Pages it asks someone to edit:\n${renderEdits(alert.analysis.posthogRefs, action, index)}`,
  ].join("\n");
}

function renderWorkspaceRules(workspace: DocsWorkspace | null): string {
  if (!workspace) {
    return `## The PostHog docs
You have no searchable copy of PostHog's docs this run, only the excerpts below. That limits what you may conclude: without a page in front of you saying PostHog does this, you cannot drop the action, and "agree" on excerpts alone is the honest answer when nothing here contradicts it.`;
  }

  return `## The PostHog docs, as files you can search
Your working directory holds PostHog's whole product corpus as markdown, one file per page, plus \`${TOC_FILENAME}\` listing every page in it. You have read-only tools: read a file, grep the text, glob for paths, list a directory. Use them. Reading the docs is the whole job here – the analyst had the same corpus and you are checking what it did with it.

How to work:
1. Grep \`${TOC_FILENAME}\` for the part of the site this action is about, and for what PostHog would call the capability rather than what the competitor calls it. Amplitude's "cohort sync" is PostHog's "cohort export", Mixpanel's "boards" are PostHog's "dashboards".
2. Open the cited evidence page and read it. Then open the pages the analyst did not, especially the ones the gap's own words lead to.
3. Only then decide.

Each file opens with a header saying what it is evidence of:
${Object.entries(EVIDENCE_LABEL)
  .map(([kind, label]) => `  - kind: ${kind} ${EN_DASH} ${label}`)
  .join("\n")}

A changelog entry proves PostHog shipped something and proves nothing about whether the docs mention it. PostHog ships several things a week and the docs lag, so a changelog entry saying PostHog does this is enough to drop the action.

Cite the \`url\` from a file's header, never the file path.`;
}

const VERDICT_RULES = `## Your verdict
One of three, and the middle one is the interesting one.

- "agree": it stands. The gap is real, the page it cites says what it is quoted as saying, the type and the named feature are right, and the impact matches what the post shipped.
- "revise": there is real work to file here and part of what was written is wrong in a way somebody can fix. Put each fix in "changes", one line each, specific enough to act on. The ones that come up:
  - The gap claims more than the evidence supports. "PostHog captures nothing until consent is given" is on the page; "PostHog has no consent-pending buffer for experiments" is a different and larger claim.
  - The evidence page is real but is not the page this is about, and a better page exists. Name it.
  - The quote is not on the page as stored, or was tidied on the way in.
  - The feature named is the wrong PostHog product for the gap.
  - It says consider_building where PostHog has an adjacent product to enhance, or consider_enhancing where PostHog has nothing in the area at all.
  - The impact label does not match what the post shipped.
  - For an update_pages action: the copy proposed for the page is wrong about what PostHog does, or is a note about the edit rather than the words to put on the page, or restates what the page already says, or does not read as if it came off that page. An update_pages action with no proposed copy at all is a revise, not a drop: the recommendation may be right and the writing is missing.
  - For an update_pages action: the copy is out of proportion to the page it lands on. Each page above carries its length and how much this copy adds to it, so this is a measurement rather than a feeling: an edit may add up to a fifth of the page's own length, and never less than ${MIN_GROWTH_WORDS} words, on top of the line it replaces. A short page given a long competitive write-up is a revise asking for the one or two sentences that make the point, and naming what to cut ${EN_DASH} the competitor's pricing tiers, their rollout history, and the rest of their launch post go first. Where no short version is worth making, that is a drop: the page is not wrong, it just does not need this.
- "drop": there is nothing to file. PostHog already does this and you can name the pages that show it, or the gap is about what a competitor charges rather than what the product does, or the action asks for documentation to be written.

The bar, which matters more than the list:
- Do not revise for style, for tone, or because you would have written it differently. Revise for something that is wrong.
- Do not drop because you could not confirm the gap. Confirming it is not your job. The analyst read the same corpus, and "I did not find it" is not "PostHog ships it". Drop only when you can point at pages that show PostHog does this.
- Impact is what the competitor shipped, and nothing else: a brand-new feature is major, a new control on an existing one is notable, a post with no feature in it is minor. Whether PostHog has a gap never moves it. Only set "impact" when the label is wrong.
- Only set "action_type" for a swap between consider_building and consider_enhancing. There is no path from a product action into update_pages or new_compare_page, or the other way: those send someone to edit posthog.com, and that is a different recommendation, not a corrected one.
- "agree" is a normal answer and often the right one. An analyst that read the docs and wrote a checked claim usually got it right, and a review that revises everything it touches is a review nobody trusts.`;

const CALIBRATION = `## What a revise looks like
The alert: Amplitude added cookie consent gating to its Web Experiment script, so experiments keep applying variants while consent is pending and buffered writes flush once a visitor grants it.

The action filed: consider_enhancing Experiments. "Add a consent-pending mode for web experiments so variants apply and exposures buffer in memory, then flush when a visitor consents." Gap: "No consent-pending buffer for web experiments: exposures during the pending window are not captured and not replayed on consent." Evidence: https://posthog.com/docs/tutorials/cookieless-tracking quoting "PostHog doesn't capture any events until after consent is either given or denied."

Why that is a revise and not an agree or a drop. There is real work here: PostHog does not buffer and replay exposures during the pending window, and Amplitude now does. But the gap sentence is two claims welded together, and the quote only carries one of them. The page says capture waits for a consent decision. It does not say anything about experiment exposures, about variants applying, or about replay on grant, and it is a tutorial rather than the page that owns consent behaviour. So: keep the type, keep Experiments, narrow the gap to the part the evidence carries, and cite the page that owns it.

The changes that go with it, as they would be written:
- Narrow the gap to what the quoted page supports: capture waits for a consent decision, so exposures in the pending window are lost.
- Move the evidence to https://posthog.com/docs/privacy/data-collection, which is the page that owns opt-in and opt-out behaviour, and quote the consent-management line from it.
- Keep the detail's second half, which names PostHog's existing opt-in controls and cookieless mode. That part is right, and it is what makes this an enhancement rather than something to build.

What the same reply must not do: drop the action because the docs are quiet about experiment exposures, or widen it into "PostHog has no consent support" because one page did not answer the question.`;

export const REVIEW_RESPONSE_SHAPE = `{
  "verdict": "agree" | "revise" | "drop",
  "reason": "string (one or two sentences; it is posted as a comment on the issue, so write it for whoever opens it)",
  "pages_checked": ["string (the PostHog URLs you opened and read, from the file headers)"],
  "changes": ["string (required for revise: one specific change each, and nothing about style)"],
  "impact": "minor | notable | major (only when the alert's label is wrong)",
  "action_type": "consider_building | consider_enhancing (only when the type is wrong)"
}`;

export function buildReviewPrompt(input: ReviewInput): string {
  return `You are reviewing one recommended action that a PostHog competitive-intelligence analyst has already filed as a GitHub issue. A different model wrote it, with the same PostHog docs corpus you have.

Your job is to decide whether it is true, not to write a better version of it.

The mistake this review exists to catch is an issue telling PostHog to build or improve something PostHog already ships. That issue is worse than no alert: it costs a reader's trust in every alert after it, and it is the easy mistake to make, because a competitor's launch is written to sound like a gap and the PostHog page that answers it is one of several thousand.

Reply with a single JSON object and nothing else. No prose, no code fences.

${VERDICT_RULES}

${CALIBRATION}

${renderWorkspaceRules(input.workspace)}

## The action as filed
${renderFiledAction(input.alert, input.action, input.index ?? null)}

## Pre-loaded excerpts the analyst was shown
The pages the analysis was checked against. A starting point, not the answer.
${renderDocs(input.docs)}

${STYLE_RULES}

## Response
Reply with exactly this JSON shape:
${REVIEW_RESPONSE_SHAPE}`;
}

export const REWRITE_RESPONSE_SHAPE = `{
  "type": "consider_building" | "consider_enhancing" (only when the reviewer asked for the type to change),
  "detail": "string (the whole detail, rewritten; omit to keep what was filed)",
  "gap": "string (one line: what PostHog does not do today)",
  "feature": "string (the PostHog product name, exactly as PostHog writes it)",
  "evidence_url": "string (a PostHog docs URL from the excerpts below)",
  "evidence_quote": "string (words copied from that page, verbatim, punctuation untouched)",
  "impact": "minor | notable | major (only when the reviewer said the label is wrong)",
  "page_edits": [
    {
      "url": "string (a page already cited above, and one marketing writes)",
      "proposed_text": "string (the exact copy to put on the page, in the page's own voice)",
      "suggested_edit": "string (one line: what is wrong and what you are changing)"
    }
  ]
}`;

function renderReviewerAsk(review: ReviewDecision, impact: Impact): string {
  const lines = [`Verdict: revise`, `Reason: ${review.reason}`];
  if (review.actionType) lines.push(`The type should be: ${review.actionType}`);
  if (review.impact && review.impact !== impact) {
    lines.push(`The impact should be: ${review.impact}`);
  }
  if (review.pagesChecked.length > 0) {
    lines.push(`Pages it read:\n${review.pagesChecked.map((url) => `- ${url}`).join("\n")}`);
  }
  lines.push(
    review.changes.length > 0
      ? `Changes it asked for:\n${review.changes.map((change) => `- ${change}`).join("\n")}`
      : "Changes it asked for: none listed, so act on the reason above and change nothing else.",
  );
  return lines.join("\n");
}

const PRODUCT_CHECKS = `- "evidence_url" has to be a PostHog docs page, and it has to be one of the pages listed below.
- "evidence_quote" has to appear on that page exactly as it is written there. Copy it. Do not paraphrase it, do not tidy its punctuation, do not join two sentences into one.
- "gap" has to be the thing the cited page is actually about. If the gap's own words lead somewhere else in the docs, the cited page is the wrong one.
- "feature" has to be PostHog's own name for the product, e.g. "Experiments", "Session replay", "AI observability". A name PostHog does not use is dropped and the old one kept.
- Never change the type into update_pages or new_compare_page, and never out of one. Those ask marketing to edit posthog.com, which is a different recommendation.`;

const PAGE_CHECKS = `- "proposed_text" is measured against the page it lands on: it may add up to a fifth of that page's own length, and never less than ${MIN_GROWTH_WORDS} words, on top of the line it replaces. The size line under each page above says where this one stands. Copy over the line is thrown away with the action, so on a short page write the one or two sentences that make the point and cut the competitor detail around them.
- "proposed_text" is the words that go on the page, and the check on it is mechanical: copy that opens with mention, note, say, add, update, clarify, reword or the like, copy that talks about "the page" or "this section" or what the copy "should say", copy shorter than a sentence or two, and copy carrying marketing filler the handbook rules out are all thrown out. So is copy that restates what the page already says, and copy that is already on the stored page.
- Only a page this action already cites, and only one marketing writes. A "/docs/" URL is always the wrong answer: the docs are the evidence, never the target.
- "suggested_edit" is the one line saying what is wrong and what you are changing. It never stands in for "proposed_text".`;

export function buildRewritePrompt(input: RewriteInput): string {
  const { alert, action, review } = input;
  const pageWork = isPageAction(action);

  return `You are rewriting one recommended action for PostHog, after a second model read PostHog's own docs and said what is wrong with it.

You are not deciding whether to file it. That is settled: it is being filed, in a corrected form. Apply the changes the reviewer asked for and change nothing else.

Reply with a single JSON object and nothing else. No prose, no code fences. Leave out every field you are not changing.

## What is checked after you write it
Code re-runs the whole evidence gate on your answer before it reaches the issue, and a rewrite that fails it is thrown away with the original left standing. So:
${pageWork ? PAGE_CHECKS : PRODUCT_CHECKS}
- "detail" opens with one sentence under ${MAX_ACTION_CHARS} characters that leads with the work to do, not with what PostHog lacks. That sentence is all Slack shows. Good: "Add a scheduled end time on experiments so a test can stop on its own ${EN_DASH} flags already schedule changes, experiments stop by hand." Bad: "PostHog schedules flag changes, but an experiment still has to be stopped by hand."${
    pageWork
      ? ` For a page action it names the page and what it should say: "On the PostHog vs Amplitude compare, say Amplitude schedules an experiment stop and PostHog stops by hand."`
      : ""
  }
${pageWork ? `\n${PAGE_REWRITE_RULES}\n` : ""}
## The action as filed
${renderFiledAction(alert, action, input.index ?? null)}

## What the reviewer said
${renderReviewerAsk(review, alert.analysis.impact)}

## The pages you may quote
Every page here is in PostHog's corpus, so a verbatim quote from one of these excerpts passes the check. A quote from anywhere else does not.${
    pageWork
      ? " For the page you are rewriting, this is also where its voice comes from: read the excerpt and write in it."
      : ""
  }
${renderDocs(input.docs)}

${STYLE_RULES}

## Response
Reply with exactly this JSON shape, carrying only the fields you are changing:
${REWRITE_RESPONSE_SHAPE}`;
}
