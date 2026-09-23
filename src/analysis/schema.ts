import { z } from "zod";
import {
  ACTIONS,
  IMAGE_ORIGINS,
  IMPACTS,
  LEGACY_IMPACTS,
  NO_ACTION_KINDS,
  REVIEW_VERDICTS,
  productActions,
  toImpact,
  type ActionIssue,
  type Analysis,
  type FeatureImage,
  type MarketingNote,
  type NoAction,
  type RecommendedAction,
} from "../types.js";
import { createLogger } from "../log.js";
import { parseDate, sanitizeCopy, truncate } from "../util/text.js";
import { shapeNoAction, UNSTATED_NO_ACTION_REASON } from "./noAction.js";
import { asQuestions } from "./questions.js";

const log = createLogger("analysis");

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

/**
 * A length a model wrote past, shortened rather than refused.
 *
 * Every cap in this file used to be a wall: one string over it threw, the
 * parse failed, and `analyzeItems` dropped the item, so the alert said "not
 * analyzed this run" and three minutes of an analyst reading the docs went in
 * the bin. That happened for real on 2026-09-23, on a
 * `consider_publishing` action whose `detail` ran past 900 characters, and
 * what reached Slack was a restatement of the competitor's own post.
 *
 * A cap is a rendering budget, not a fact about the reply. So it is applied
 * the way a rendering budget should be: the string is cut at a word boundary,
 * the run log says which field was cut and by how much, and everything else
 * the model wrote survives. The budgets are generous enough that a cut is a
 * bug worth reading about in the log rather than a daily occurrence, and the
 * prompt states them so a reply written to the rule is never cut at all.
 */
export function capText(value: unknown, max: number, field: string): unknown {
  if (typeof value !== "string" || value.length <= max) return value;
  log.warn(
    `shortened "${field}" from ${value.length} to ${max} characters, which is the budget for it; the rest of the reply is unchanged`,
  );
  return truncate(value, max);
}

/** Entries past a list's budget, dropped rather than failing the list. */
export function capList(value: unknown, max: number, field: string): unknown {
  if (!Array.isArray(value) || value.length <= max) return value;
  log.warn(`kept the first ${max} of ${value.length} entries in "${field}"`);
  return value.slice(0, max);
}

const optionalText = (max: number, field: string) =>
  z.preprocess(
    (value) => capText(blankAsMissing(value), max, field),
    z.string().min(1).max(max).optional(),
  );

/** The same budget on a field the reply has to carry. */
const requiredText = (max: number, field: string) =>
  z.preprocess((value) => capText(value, max, field), z.string().min(1).max(max));

/** Blank entries are dropped rather than failing the list they are in. */
const lineList = (max: number, field: string) =>
  z.preprocess(
    (value) =>
      capList(
        Array.isArray(value)
          ? value
              .filter((entry) => typeof entry !== "string" || entry.trim() !== "")
              .map((entry) => capText(entry, MAX_LINE_CHARS, field))
          : value,
        max,
        field,
      ),
    z.array(z.string().min(1)).max(max),
  );

/** A bullet, an open question, a page title: one line, not a paragraph. */
const MAX_LINE_CHARS = 600;

const lines = lineList(8, "lines");

/** A paragraph of replacement copy, which runs longer than a one-line instruction. */
const proposedText = optionalText(1_200, "proposed_text");

const refSchema = z.object({
  url: requiredText(1_000, "url"),
  claim: requiredText(1_200, "claim"),
  suggested_edit: optionalText(600, "suggested_edit"),
  suggestedEdit: optionalText(600, "suggested_edit"),
  proposed_text: proposedText,
  proposedText,
  replacement_text: proposedText,
});

/** A citation with no page or no claim says nothing, so it goes rather than throws. */
const refs = z.preprocess(
  (value) =>
    capList(
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
      5,
      "posthog_refs",
    ),
  z.array(refSchema).max(5),
);

/** Either scale, so a row or a reply on the low/medium/high tokens still parses. */
const impactToken = z.enum([...IMPACTS, ...LEGACY_IMPACTS]);

const actionToken = z.enum(ACTIONS);

/**
 * How long an action's reasoning may run.
 *
 * Slack shows the first sentence and the GitHub issue carries the rest, so
 * this is the length of the rest: the change to make, what the competitor now
 * does, what PostHog does today, and for a piece to publish what the angle is
 * and who it is for. Two thousand characters is three or four paragraphs,
 * which is more than any of those needs and well past where the old 900 sat.
 * It is stated in the prompt as well, so the budget is something a reply aims
 * under rather than something it discovers.
 */
export const MAX_DETAIL_CHARS = 2_000;

const detail = optionalText(MAX_DETAIL_CHARS, "detail");
const feature = optionalText(120, "feature");
const gap = optionalText(400, "gap");
const quote = optionalText(600, "evidence_quote");
const articleTitle = optionalText(160, "article_title");
/**
 * How long a draft may run. About two thousand words: a PostHog blog post is
 * usually shorter, and past this the model is writing a guide rather than the
 * post a marketer edits into one.
 */
export const MAX_ARTICLE_DRAFT_CHARS = 12_000;
const articleDraft = optionalText(MAX_ARTICLE_DRAFT_CHARS, "article_draft");

/** Small team names, blanks dropped. Validated against the catalog later. */
const teamNames = z.preprocess(
  (value) =>
    capList(
      Array.isArray(value)
        ? value.filter((entry) => typeof entry === "string" && entry.trim() !== "")
        : value,
      5,
      "teams",
    ),
  z.array(z.string().min(1)).max(5).optional(),
);

/**
 * A markdown heading inside an action's `detail`, which prose never has and a
 * blog draft always does.
 */
const HEADING_LINE = /(^|\n)#{1,3}[ \t]+\S/;

/** Below this, a run of text with a heading in it is a note, not a draft. */
const MIN_LIFTED_DRAFT_WORDS = 60;

/**
 * Move a draft the model wrote into `detail` over to `article_draft`.
 *
 * `detail` is the reasoning and `article_draft` is the piece, and the prompt
 * says so, but a model writing a post sometimes puts the post where it was
 * explaining the post. Left alone, the long field is cut to its budget and a
 * marketer gets a truncated draft filed as a recommendation, or no draft at
 * all and the gate drops the action as a brief. Neither is what the reply
 * said.
 *
 * So the unambiguous shape is read rather than refused: an action with no
 * draft of its own whose `detail` carries a markdown heading and a post's
 * worth of prose after it. The heading and everything below become the draft,
 * what sat above it stays the detail, and where nothing sat above it the
 * draft's own first paragraph becomes the detail. Nothing is written that the
 * model did not write, and a `detail` that merely runs long is untouched.
 */
function liftDraftFromDetail(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const entry = value as Record<string, unknown>;
  if ((entry.type ?? entry.action) !== "consider_publishing") return value;

  const written = (key: string): boolean =>
    typeof entry[key] === "string" && (entry[key] as string).trim() !== "";
  if (written("article_draft") || written("articleDraft") || written("draft")) return value;

  const key = ["detail", "action_detail", "actionDetail"].find((name) => written(name));
  const detail = key ? (entry[key] as string) : "";
  const found = HEADING_LINE.exec(detail);
  if (!key || !found) return value;

  const at = found.index === 0 ? 0 : found.index + 1;
  const draft = detail.slice(at).trim();
  if (draft.split(/\s+/).length < MIN_LIFTED_DRAFT_WORDS) return value;

  const above = detail.slice(0, at).trim();
  const lead = above || firstParagraph(draft.replace(/^#{1,3}[ \t]+.*\n+/, ""));
  log.warn(
    `moved a ${draft.length}-character draft out of a consider_publishing action's detail and into article_draft, where the checks and the issue can read it`,
  );
  return { ...entry, [key]: lead || draft.slice(0, 200), article_draft: draft };
}

/** The first block of a markdown document, which is its own summary of itself. */
function firstParagraph(text: string): string {
  return (text.split(/\n\s*\n/)[0] ?? "").trim();
}

/** One entry of `actions`, in whichever casing the model reached for. */
const actionSchema = z.preprocess(liftDraftFromDetail, z.object({
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
  evidence_url: optionalText(500, "evidence_url"),
  evidenceUrl: optionalText(500, "evidence_url"),
  evidence_quote: quote,
  evidenceQuote: quote,
  article_title: articleTitle,
  articleTitle,
  article_draft: articleDraft,
  articleDraft,
  draft: articleDraft,
}));

/** Pages named by URL, blanks dropped. Titles and quotes are optional on each. */
const namedPages = z
  .preprocess(
    (value) =>
      capList(
        Array.isArray(value)
          ? value.filter(
              (entry) =>
                typeof entry === "object" &&
                entry !== null &&
                typeof (entry as { url?: unknown }).url === "string" &&
                (entry as { url: string }).url.trim() !== "",
            )
          : value,
        MAX_NAMED_PAGES,
        "pages",
      ),
    z.array(
      z.object({
        url: requiredText(1_000, "page url"),
        title: optionalText(300, "page title"),
        quote: optionalText(600, "page quote"),
      }),
    ),
  )
  .optional();

/** More pages than this under one verdict is a reading list, not evidence. */
const MAX_NAMED_PAGES = 8;

/**
 * The marketing half of a None: PostHog already covers this angle, or nothing
 * here is worth a piece. A note with no words in it is no note.
 */
const marketingSchema = z
  .object({
    note: optionalText(600, "marketing note"),
    reason: optionalText(600, "marketing note"),
    pages: namedPages,
    existing_pages: namedPages,
  })
  .optional();

/**
 * The verdict when there are no actions. The kind is read loosely: a model that
 * invents one loses the title it would have picked, not the sentence it wrote.
 */
const noActionSchema = z
  .object({
    kind: optionalText(60, "no_action.kind"),
    reason: optionalText(600, "no_action.reason"),
    no_action_reason: optionalText(600, "no_action.reason"),
    evidence: namedPages,
    marketing: marketingSchema,
    content: marketingSchema,
  })
  .optional();

export const analysisSchema = z.object({
  impact: impactToken.optional(),
  /** Phase 1 rows and older model replies call the same field severity. */
  severity: impactToken.optional(),
  summary: requiredText(600, "summary"),
  key_points: lines.optional(),
  keyPoints: lines.optional(),
  actions: z.preprocess((value) => capList(value, 4, "actions"), z.array(actionSchema).max(4)).optional(),
  /** A single action is how rows written before this field looked. */
  action: actionToken.optional(),
  action_detail: detail,
  actionDetail: detail,
  feature,
  posthog_feature: feature,
  posthogFeature: feature,
  no_action: noActionSchema,
  noAction: noActionSchema,
  no_action_reason: optionalText(600, "no_action_reason"),
  noActionReason: optionalText(600, "no_action_reason"),
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
  const title = parsed.article_title ?? parsed.articleTitle;
  const draft = parsed.article_draft ?? parsed.articleDraft ?? parsed.draft;
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
    ...(title ? { articleTitle: clean(title) } : {}),
    // Punctuated PostHog's way: this is the string most likely to be pasted
    // into a posthog.com post, so an em dash in it is fixed here. Whitespace is
    // kept, because the draft is markdown and its blank lines are paragraphs.
    ...(draft ? { articleDraft: sanitizeCopy(draft).trim() } : {}),
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
  const marketing = readMarketing(structured?.marketing ?? structured?.content);

  return shapeNoAction({
    kind: kind ?? "unverified",
    reason: clean(reason ?? UNSTATED_NO_ACTION_REASON),
    evidence: readPages(structured?.evidence ?? []),
    ...(marketing ? { marketing } : {}),
  });
}

function readPages(entries: Array<{ url: string; title?: string; quote?: string }>) {
  return entries.map((entry) => ({
    url: entry.url.trim(),
    ...(entry.title ? { title: clean(entry.title) } : {}),
    // A quote is matched character by character against the stored page, so
    // it is the one string here that is not repunctuated.
    ...(entry.quote ? { quote: entry.quote.trim() } : {}),
  }));
}

function readMarketing(
  parsed: z.infer<typeof marketingSchema>,
): MarketingNote | undefined {
  const note = parsed?.note ?? parsed?.reason;
  if (!note) return undefined;
  return { note: clean(note), pages: readPages(parsed?.pages ?? parsed?.existing_pages ?? []) };
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
  // The product verdict is read whenever there is no product action. An alert
  // whose only action is consider_publishing still has to say what the ship
  // asks of the product, which is nothing, and why.
  const noAction = productActions(actions).length > 0 ? undefined : readNoAction(parsed);

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
    // A model that means to ask something often writes it down as a note to
    // itself ("whether Headless is generally available"). The section is
    // called Open questions, so it holds questions.
    openQuestions: asQuestions(openQuestions.map(clean).filter(Boolean)),
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
