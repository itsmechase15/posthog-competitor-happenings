import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkActions } from "../src/analysis/analyze.js";
import { gateActions } from "../src/analysis/evidence.js";
import { enforceActionLead } from "../src/analysis/lead.js";
import { renderNoAction } from "../src/analysis/noAction.js";
import { buildAnalysisPrompt } from "../src/analysis/prompt.js";
import { enforcePageTargets, enforceUpdatePagesTopic } from "../src/analysis/relevance.js";
import { parseAnalysis, parseStoredAlert, serializeAlertPayload } from "../src/analysis/schema.js";
import { verifyAgainstDocs } from "../src/analysis/verify.js";
import { buildIssueBody, buildIssueLabels, buildIssueTitle } from "../src/github/issue.js";
import type { IssueEditor, IssuePatch } from "../src/github/issue.js";
import { ACTION_LABEL, ACTION_OWNER, actionLabel } from "../src/labels.js";
import { reviewActions, createReviewBudget } from "../src/review/apply.js";
import { buildReviewPrompt, buildRewritePrompt } from "../src/review/prompt.js";
import type { Reviewer } from "../src/review/reviewer.js";
import { mergeRevision, parseRevision } from "../src/review/schema.js";
import type { ActionWriter } from "../src/review/writer.js";
import {
  buildSlackMessage,
  MAX_POINT_CHARS,
  MAX_SO_WHAT_CHARS,
  renderMessageText,
} from "../src/slack/message.js";
import { relatedTeams } from "../src/teams.js";
import {
  isContentAction,
  productActions,
  type Alert,
  type Analysis,
  type AnalyzedItem,
  type ArticleDraftVisual,
  type IssueRef,
  type RecommendedAction,
  type StoredItem,
} from "../src/types.js";
import { truncate } from "../src/util/text.js";
import { corpus } from "./helpers.js";

/**
 * The marketing path, end to end: a competitor piece that ships nothing gets a
 * product verdict that names the piece, then the question of whether PostHog
 * should write on the angle, answered as a `consider_publishing` action with a
 * draft or as a line under the None.
 *
 * What every case here protects is the product side. A piece to publish is a
 * content action: it never stands in for the product verdict, never moves the
 * bar for `update_pages`, and is checked and reviewed like every other action.
 */

const BLOG = "https://posthog.com/blog/sdk-or-warehouse";
const TUTORIAL = "https://posthog.com/tutorials/import-warehouse-events";
const LIBRARIES = "https://posthog.com/docs/libraries";
const LIFECYCLE = "https://posthog.com/docs/experiments/managing-lifecycle";

const index = corpus(
  {
    url: BLOG,
    title: "Should you install the SDK or send events from your warehouse?",
    kind: "marketing",
    text: "Install the SDK or send events from your warehouse: the case for each, what the SDK does on the client, and what you lose without it.",
  },
  {
    url: TUTORIAL,
    title: "How to import warehouse events into PostHog",
    kind: "marketing",
    text: "A tutorial on importing events from a data warehouse into PostHog without the SDK.",
  },
  {
    url: LIBRARIES,
    title: "SDKs",
    text: "Install the PostHog SDK for your platform. The JavaScript SDK captures pageviews and evaluates feature flags on the client.",
  },
  {
    url: LIFECYCLE,
    title: "Managing the experiment lifecycle",
    text: "You stop an experiment by clicking complete. There is no end date field on an experiment, so stopping is always a manual step.",
  },
);

const item: StoredItem = {
  id: "1",
  competitor: "amplitude",
  source: "blog",
  externalId: "amplitude-sdk-or-not",
  title: "Should you install the Amplitude SDK?",
  url: "https://amplitude.com/blog/amplitude-sdk-or-not",
  publishedAt: new Date("2026-09-01T00:00:00Z"),
  raw: { body: "Whether to install the SDK or send events from a warehouse, and what you give up either way." },
};

const paragraph =
  "Sending events straight from your warehouse means you skip the SDK, and you also skip everything the SDK does for you on the client: session ids, autocapture, feature flag evaluation, and the first pageview a visitor makes before your pipeline has heard of them. ";

const DRAFT = `# Should you install the SDK, or send events from your warehouse?

${paragraph.repeat(3)}

## What the SDK does that a warehouse cannot

${paragraph.repeat(3)}

## When warehouse-only is the right call

${paragraph.repeat(2)}

Try both on one product area and compare what you can answer.`;

const piece: RecommendedAction = {
  type: "consider_publishing",
  detail:
    "Publish a PostHog take on whether to install the SDK or send events from your warehouse – Amplitude has one, and PostHog's blog has nothing on the choice.",
  teams: ["Editorial"],
  articleTitle: "Should you install the SDK, or send events from your warehouse?",
  articleDraft: DRAFT,
};

const verdict = {
  kind: "not_a_gap" as const,
  reason:
    "This is a thought leadership article about whether to install Amplitude's SDK or send events from a warehouse. It's not an announcement of a new feature or product.",
  evidence: [],
};

const analysis: Analysis = {
  impact: "minor",
  summary: "Amplitude published a piece on installing its SDK versus warehouse-only ingestion.",
  keyPoints: ["Makes the case for the SDK over warehouse-only event delivery."],
  actions: [piece],
  noAction: verdict,
  noActionReason: verdict.reason,
  posthogRefs: [],
  openQuestions: [],
};

const analyzed: AnalyzedItem = { item, analysis, model: "claude-opus-5", docs: [] };

/** The analyst read the two PostHog pieces nearest the angle before recommending. */
const readBoth = { index, seenUrls: new Set([BLOG, TUTORIAL]) };
const readNothing = { index, seenUrls: new Set<string>() };

describe("the action taxonomy", () => {
  it("adds consider_publishing as marketing's action, with a label of its own", () => {
    expect(ACTION_LABEL.consider_publishing).toBe("Consider publishing");
    expect(ACTION_OWNER.consider_publishing).toBe("marketing");
    expect(actionLabel(piece)).toBe("Consider publishing");
  });

  it("tells a content action from the product ones", () => {
    expect(isContentAction(piece)).toBe(true);
    expect(isContentAction({ type: "update_pages" })).toBe(false);
    const building: RecommendedAction = { type: "consider_building", detail: "x" };
    expect(productActions([piece, building])).toEqual([building]);
  });

  it("routes the piece to the team that owns the blog, then whoever owns what it is about", () => {
    expect(relatedTeams(piece).map((team) => team.name)).toEqual(["Editorial"]);
    const derived = relatedTeams({ ...piece, teams: undefined }).map((team) => team.name);
    expect(derived[0]).toBe("Editorial");
    expect(derived.length).toBeGreaterThan(1);
  });
});

describe("parsing a reply with a piece to publish", () => {
  const reply = JSON.stringify({
    impact: "minor",
    summary: analysis.summary,
    key_points: analysis.keyPoints,
    actions: [
      {
        type: "consider_publishing",
        detail: piece.detail,
        teams: ["Editorial"],
        article_title: piece.articleTitle,
        article_draft: "# Title\n\nOne — two.\n\nThree.",
      },
    ],
    no_action: {
      kind: "not_a_gap",
      reason: verdict.reason,
      evidence: [],
    },
    posthog_refs: [],
    open_questions: [],
  });

  it("reads the headline and the draft, and keeps the product verdict next to the action", () => {
    const parsed = parseAnalysis(reply);
    expect(parsed.actions[0]?.type).toBe("consider_publishing");
    expect(parsed.actions[0]?.articleTitle).toBe(piece.articleTitle);
    expect(parsed.actions[0]?.articleDraft).toBe("# Title\n\nOne \u2013 two.\n\nThree.");
    expect(parsed.noAction?.kind).toBe("not_a_gap");
    expect(parsed.noActionReason).toBe(verdict.reason);
  });

  it("drops the verdict once a product action stands", () => {
    const withProduct = JSON.parse(reply) as { actions: unknown[] };
    withProduct.actions.push({
      type: "consider_enhancing",
      feature: "Experiments",
      detail: "Add a scheduled end time on experiments.",
    });
    expect(parseAnalysis(JSON.stringify(withProduct)).noAction).toBeUndefined();
  });

  it("reads a marketing line under the None", () => {
    const parsed = parseAnalysis(
      JSON.stringify({
        impact: "minor",
        summary: analysis.summary,
        actions: [],
        no_action: {
          kind: "not_a_gap",
          reason: verdict.reason,
          marketing: {
            note: "PostHog's blog already covers the SDK versus warehouse choice.",
            pages: [{ url: BLOG }],
          },
        },
      }),
    );
    expect(parsed.noAction?.marketing).toEqual({
      note: "PostHog's blog already covers the SDK versus warehouse choice.",
      pages: [{ url: BLOG }],
    });
  });

  it("round-trips through the stored payload", () => {
    const stored = parseStoredAlert(serializeAlertPayload(analysis, null, [{ action: piece, issue: null }]));
    expect(stored.analysis.actions[0]?.articleDraft).toBe(DRAFT);
    expect(stored.analysis.noAction?.kind).toBe("not_a_gap");
    expect(stored.issues[0]?.action.type).toBe("consider_publishing");
  });
});

describe("the prompt", () => {
  const prompt = buildAnalysisPrompt(item, {});

  it("asks the marketing question after the product one, and says it never moves the product answer", () => {
    expect(prompt).toContain("The marketing question.");
    expect(prompt).toContain("does PostHog publish anything on the same angle?");
    expect(prompt).toContain("This is marketing's question and it never moves the product answer.");
  });

  it("says what similar means: the same reader question, not the same product area", () => {
    expect(prompt).toContain("Similar means the same reader question or thesis, not the same product area");
    expect(prompt).toContain("a tutorial on installing the SDK in a Django app");
    expect(prompt).toContain("give the draft a headline that says what question it answers");
  });

  it("asks for the draft, in PostHog's voice, matched against PostHog's own posts", () => {
    expect(prompt).toContain("Every consider_publishing action ships the piece with it");
    expect(prompt).toContain("open two or three on a nearby topic and match how they are written");
    expect(prompt).toContain('"article_draft"');
  });

  it("makes the last key point the so-what, with room to be one", () => {
    expect(prompt).toContain("The last key point is the so-what");
    expect(prompt).toContain(`up to ${MAX_SO_WHAT_CHARS} characters`);
    expect(prompt).toContain("what the competitor is selling in this piece");
    expect(prompt).toContain(
      "written so a PostHog marketer can see what a piece positioned against it would have to answer",
    );
    // The thin closers this replaced, named as the mistake they are.
    expect(prompt).toContain('Bad: "Closes by pointing at their install docs and their agent."');
    expect(prompt).toContain('Also bad: "A pitch for their analytics platform."');
    expect(prompt).toContain("Prefer one rich last line to four thin ones");
    // The lines above it stay fragments, at the budget Slack renders them to.
    expect(prompt).toContain(`as a fragment under ${MAX_POINT_CHARS} characters`);
  });

  it("asks a publishing detail for the positioning, the products, and the draft's beats", () => {
    expect(prompt).toContain('For consider_publishing, "detail" is the brief a marketer acts on');
    expect(prompt).toContain(
      "how PostHog should position the piece against what the competitor is selling",
    );
    expect(prompt).toContain("which PostHog products the piece rests on, by the names the docs use");
    expect(prompt).toContain(`Then "**What's in the draft**" on a line of its own`);
    expect(prompt).toContain('each starting with "- "');
    expect(prompt).toContain("Beats, not the draft.");
    // Slack still shows one sentence, so the extra lines go under it.
    expect(prompt).toContain("Slack shows that sentence and nothing else");
    expect(prompt).toContain(
      "The positioning, the PostHog products to highlight, and the draft's beats go in the lines under it, never in this sentence.",
    );
  });

  it("does not ask for the sections that were taken out", () => {
    expect(prompt).not.toContain("Does PostHog already cover this?");
    expect(prompt).not.toContain("Product verdict section");
  });
});

/**
 * The standing rules a person reads. The prompts are written from them, so a
 * change to one that never reaches the other leaves the model and the
 * handbook disagreeing about what an issue should say.
 */
describe("docs/writing.md", () => {
  const writing = readFileSync(new URL("../docs/writing.md", import.meta.url), "utf8");
  /** The prose is hard-wrapped, so a sentence is matched without its line breaks. */
  const prose = writing.replace(/\s+/g, " ");

  it("states the so-what rule for the last key point, with the budgets", () => {
    expect(writing).toContain("## The last detail bullet says what they are selling");
    expect(prose).toContain("it says what the competitor is selling in this piece");
    expect(writing).toContain("MAX_SO_WHAT_CHARS");
    expect(writing).toContain("MAX_KEY_POINT_CHARS");
    expect(prose).toContain("One rich last line beats four thin ones");
  });

  it("states the shape of a publishing ask: lead, positioning, products, then beats", () => {
    expect(writing).toContain("## The ask above that draft is a brief, not a retelling");
    expect(prose).toContain("how PostHog should position the piece against the pitch");
    expect(prose).toContain("which PostHog products it rests on, by the names the docs use");
    expect(writing).toContain("**What's in the draft**");
    expect(prose).toContain("Beats, not the draft.");
  });
});

describe("gateActions on a piece to publish", () => {
  it("keeps a drafted piece whose nearest PostHog pages the analyst read, and names them", () => {
    const gated = gateActions(analysis, readBoth);
    expect(gated.blocked).toEqual([]);
    expect(gated.analysis.actions).toHaveLength(1);
    expect(gated.analysis.actions[0]?.similarPages).toContain(BLOG);
    // The product verdict stays next to it.
    expect(gated.analysis.noAction?.kind).toBe("not_a_gap");
    expect(gated.analysis.noAction?.reason).toBe(verdict.reason);
  });

  it("blocks a piece PostHog already published, on pages nobody opened, and says so under the None", () => {
    const gated = gateActions(analysis, readNothing);
    expect(gated.analysis.actions).toEqual([]);
    expect(gated.blocked[0]?.cause).toBe("article_exists");
    expect(gated.analysis.noAction?.kind).toBe("not_a_gap");
    expect(gated.analysis.noAction?.marketing?.note).toContain("PostHog already covers this angle");
    expect(gated.analysis.noAction?.marketing?.pages.map((page) => page.url)).toContain(BLOG);
    // The product verdict is the analyst's, untouched: the block was about the blog.
    expect(gated.analysis.noAction?.reason).toBe(verdict.reason);
  });

  it("blocks a piece with no draft, and says so under the None", () => {
    const gated = gateActions(
      { ...analysis, actions: [{ ...piece, articleDraft: undefined }] },
      readBoth,
    );
    expect(gated.blocked[0]?.cause).toBe("article_no_draft");
    expect(gated.analysis.noAction?.marketing?.note).toMatch(/A PostHog piece was suggested/);
    expect(gated.analysis.noAction?.marketing?.pages).toEqual([]);
  });

  it("keeps the product verdict from the blocked product action when only the piece survives", () => {
    const badProduct: RecommendedAction = {
      type: "consider_enhancing",
      feature: "Experiments",
      detail: "Add a scheduled end time on experiments.",
      gap: "no scheduled end time on an experiment",
      evidenceUrl: "https://posthog.com/docs/nowhere",
      evidenceQuote: "There is no end date field on an experiment",
    };
    const gated = gateActions(
      { ...analysis, actions: [badProduct, piece], noAction: undefined, noActionReason: undefined },
      readBoth,
    );
    expect(gated.analysis.actions.map((action) => action.type)).toEqual(["consider_publishing"]);
    expect(gated.analysis.noAction?.kind).toBe("unverified");
    expect(gated.analysis.noAction?.reason).toContain("no scheduled end time on an experiment");
  });

  it("turns a blocked piece into an open question when a product action still stands", () => {
    const product: RecommendedAction = {
      type: "consider_enhancing",
      feature: "Experiments",
      detail: "Add a scheduled end time on experiments.",
      gap: "no end date field on an experiment",
      evidenceUrl: LIFECYCLE,
      evidenceQuote: "There is no end date field on an experiment",
    };
    const gated = gateActions(
      {
        ...analysis,
        actions: [product, piece],
        noAction: undefined,
        noActionReason: undefined,
        posthogRefs: [{ url: LIFECYCLE, claim: "There is no end date field on an experiment" }],
      },
      { index, seenUrls: new Set([LIFECYCLE]) },
    );
    expect(gated.analysis.actions.map((action) => action.type)).toEqual(["consider_enhancing"]);
    expect(gated.analysis.noAction).toBeUndefined();
    expect(gated.analysis.openQuestions[0]).toMatch(/^Does the piece PostHog already publishes cover this angle\?/);
  });

  it("checks the pages a marketing line names against the corpus", () => {
    const gated = gateActions(
      {
        ...analysis,
        actions: [],
        noAction: {
          ...verdict,
          marketing: {
            note: "PostHog's blog already covers this.",
            pages: [{ url: BLOG }, { url: "https://posthog.com/blog/never-written" }],
          },
        },
      },
      readNothing,
    );
    expect(gated.analysis.noAction?.marketing?.pages).toEqual([
      { url: BLOG, title: "Should you install the SDK or send events from your warehouse?" },
    ]);
    expect(gated.notes.some((note) => note.includes("never-written"))).toBe(true);
  });
});

describe("the rest of the chain", () => {
  it("leaves a piece alone in the docs pass, the page guards, and the lead shaper", () => {
    const verified = verifyAgainstDocs(analysis, [
      { url: LIBRARIES, title: "SDKs", excerpt: "Install the PostHog SDK.", kind: "docs" },
    ]);
    expect(verified.notes).toEqual([]);
    expect(verified.analysis.openQuestions).toEqual([]);

    expect(enforcePageTargets(analysis).analysis).toBe(analysis);
    expect(enforceUpdatePagesTopic(analysis, item).analysis).toBe(analysis);
    expect(enforceActionLead(analysis).notes).toEqual([]);
  });

  it("leads a piece that opens by describing their post with the piece to write", () => {
    const led = enforceActionLead({
      ...analysis,
      actions: [{ ...piece, detail: "This is a thought leadership post about SDKs." }],
    });
    expect(led.analysis.actions[0]?.detail).toMatch(
      /^Publish a PostHog piece, "Should you install the SDK, or send events from your warehouse\?": /,
    );
  });

  it("writes the product verdict when the only update_pages goes and a piece stays", () => {
    const withPage: Analysis = {
      ...analysis,
      noAction: undefined,
      noActionReason: undefined,
      actions: [
        { type: "update_pages", detail: "On the pricing page, answer their claim about seats." },
        piece,
      ],
      posthogRefs: [
        {
          url: "https://posthog.com/pricing",
          claim: "Per-seat pricing is not a thing here.",
          suggestedEdit: "Answer their seats claim.",
          proposedText: "PostHog does not charge per seat. Every plan lets the whole team in.",
        },
      ],
    };
    const scoped = enforceUpdatePagesTopic(withPage, item);
    expect(scoped.analysis.actions.map((action) => action.type)).toEqual(["consider_publishing"]);
    expect(scoped.analysis.noAction?.kind).toBe("not_a_gap");
  });

  it("runs the whole chain and comes out with the piece and the verdict", () => {
    const checked = checkActions(analysis, [], item, readBoth, "claude-opus-5");
    expect(checked.analysis.actions.map((action) => action.type)).toEqual(["consider_publishing"]);
    expect(checked.analysis.noAction?.kind).toBe("not_a_gap");
  });
});

describe("Slack", () => {
  const alert: Alert = {
    ...analyzed,
    image: { url: "https://cdn.invalid/hero.png", altText: "Amplitude SDK", origin: "page" },
    issues: [{ action: piece, issue: { url: "https://github.com/o/r/issues/80", number: 80 } }],
  };

  it("shows the product None first, then the piece to publish, with its headline and issue", () => {
    const text = renderMessageText(buildSlackMessage(alert));
    const none = text.indexOf("*None \u2013 not a product gap*");
    const action = text.indexOf("*Consider publishing*");
    expect(none).toBeGreaterThan(-1);
    expect(action).toBeGreaterThan(none);
    expect(text).toContain("It's not an announcement of a new feature or product.");
    expect(text).toContain('> Working title: "Should you install the SDK, or send events from your warehouse?" (draft in the issue)');
    expect(text).toContain("Access GitHub issue #80");
  });

  it("shows the marketing line under a None with no action", () => {
    const quiet: Alert = {
      ...alert,
      issues: [],
      analysis: {
        ...analysis,
        actions: [],
        noAction: {
          ...verdict,
          marketing: { note: "PostHog already covers this angle.", pages: [{ url: BLOG, title: "SDK or warehouse" }] },
        },
      },
    };
    const text = renderMessageText(buildSlackMessage(quiet));
    expect(text).toContain(`*Marketing:* PostHog already covers this angle. See: <${BLOG}|SDK or warehouse>`);
    expect(text).not.toContain("*Consider publishing*");
  });

  it("does not show the None once a product action stands", () => {
    const withProduct: Alert = {
      ...alert,
      analysis: {
        ...analysis,
        noAction: undefined,
        actions: [
          { type: "consider_enhancing", feature: "Experiments", detail: "Add a scheduled end time." },
          piece,
        ],
      },
    };
    expect(renderMessageText(buildSlackMessage(withProduct))).not.toContain("*None");
  });
});

describe("the GitHub issue", () => {
  const draftVisual: ArticleDraftVisual = {
    title: piece.articleTitle as string,
    wordCount: 420,
    capturedOn: "2026-09-23",
    shots: [
      { url: "https://raw.invalid/a-1.png", alt: "Draft, part 1 of 2", path: "a-1.png" },
      { url: "https://raw.invalid/a-2.png", alt: "Draft, part 2 of 2", path: "a-2.png" },
    ],
    stagedOn: "https://posthog.com/blog/product-engineer-vs-software-engineer",
  };
  const withSimilar = { ...piece, similarPages: [TUTORIAL] };
  const body = buildIssueBody(analyzed, null, withSimilar, [], draftVisual);

  it("is titled and labelled as marketing's piece", () => {
    expect(buildIssueTitle(analyzed, piece)).toBe(
      "Amplitude: Should you install the Amplitude SDK? \u2013 Consider publishing",
    );
    expect(buildIssueLabels(analyzed, piece)).toContain("action:consider-publishing");
    expect(buildIssueLabels(analyzed, piece)).toContain("owner:marketing");
    expect(buildIssueLabels(analyzed, piece)).toContain("team:editorial");
  });

  it("reads news, impact, ask, then the draft", () => {
    const order = [
      "## What you need to know",
      "## More detail",
      "## Impact",
      "## Recommended action",
      "## The draft",
      "## Related team(s)",
    ].map((heading) => body.indexOf(heading));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("leaves the product verdict and the coverage question to Slack and the ask", () => {
    expect(body).not.toContain("## Product verdict");
    expect(body).not.toContain("## Does PostHog already cover this?");
    const fresh = buildIssueBody(analyzed, null, piece, [], null);
    expect(fresh).not.toContain("## Product verdict");
    expect(fresh).not.toContain("## Does PostHog already cover this?");
  });

  it("embeds every shot in order, with a caption naming the post it was staged on and that nothing was published", () => {
    const first = body.indexOf("![Draft, part 1 of 2](https://raw.invalid/a-1.png)");
    const second = body.indexOf("![Draft, part 2 of 2](https://raw.invalid/a-2.png)");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(body).toContain("in 2 parts from the top down");
    expect(body).toContain(
      "the live post at https://posthog.com/blog/product-engineer-vs-software-engineer, opened in a headless browser with its headline and copy swapped for the draft",
    );
    expect(body).toContain("Nothing was published.");
  });

  it("carries the whole draft in a fence somebody copies from", () => {
    expect(body).toContain("**Working title** \u2013 Should you install the SDK, or send events from your warehouse?");
    expect(body).toContain("About 420 words.");
    expect(body).toContain("**Copy this**\n\n```markdown\n# Should you install the SDK");
    expect(body).toContain("Try both on one product area and compare what you can answer.\n```");
  });

  it("skips the docs sections, which are about the product", () => {
    expect(body).not.toContain("## What PostHog's docs say today");
    expect(body).not.toContain("## PostHog pages to update");
    expect(body).not.toContain("## Docs that would change if this ships");
    expect(body).not.toContain("## The gap this closes");
  });

  it("still carries the draft when the pictures failed", () => {
    const textOnly = buildIssueBody(analyzed, null, piece, [], { ...draftVisual, shots: [] });
    expect(textOnly).not.toContain("![");
    expect(textOnly).toContain("```markdown");
  });

  /**
   * The brief as the prompt asks for it: the ask, how to position it, the
   * products it rests on, then the draft's beats as bullets. Everything below
   * the first line is markdown, and the issue has to render it as markdown.
   */
  const brief = [
    "Publish a PostHog take on whether you need an SDK or can send events from your warehouse.",
    "Position it against the pitch that the SDK is the layer a warehouse cannot replace: PostHog ships both sides, so the honest answer names what the warehouse covers and what it does not.",
    "Lean on warehouse sources and the capture API for what SQL-first teams already have, and on session replay, surveys, and experiments for what needs posthog-js on the page.",
    "",
    "**What's in the draft**",
    "- What warehouse sources and the capture API already answer.",
    "- The three things that need the SDK on the page, and why.",
    "- A person join resolves at query time, so flags and experiments never see it.",
    "- The hybrid setup most teams land on, and when warehouse-only is right.",
  ].join("\n");

  it("renders a brief's sub-bullets as bullets, not as more of the label's paragraph", () => {
    const body = buildIssueBody(analyzed, null, { ...piece, detail: brief }, [], null);
    expect(body).toContain(
      "## Recommended action\n**Consider publishing** \u2013 Publish a PostHog take on whether you need an SDK or can send events from your warehouse.",
    );
    // A blank line before the list is what makes it a list.
    expect(body).toContain(
      "\n\n**What's in the draft**\n- What warehouse sources and the capture API already answer.\n- The three things that need the SDK on the page, and why.",
    );
    expect(body).toContain("posthog-js on the page.");
    // The draft itself is still the draft's section, not the ask.
    expect(body.indexOf("## Recommended action")).toBeLessThan(body.indexOf("## The draft"));
  });

  it("gives a list its own block even when the model left no blank line before it", () => {
    const tight = `Publish a PostHog take on the SDK question.\n**What's in the draft**\n- The parts a warehouse covers.\n- The parts that need posthog-js.`;
    const body = buildIssueBody(analyzed, null, { ...piece, detail: tight }, [], null);
    expect(body).toContain(
      "## Recommended action\n**Consider publishing** \u2013 Publish a PostHog take on the SDK question.\n\n**What's in the draft**\n- The parts a warehouse covers.",
    );
  });

  it("leaves a one-paragraph ask exactly as it always rendered", () => {
    const body = buildIssueBody(analyzed, null, piece, [], null);
    expect(body).toContain(`## Recommended action\n**Consider publishing** \u2013 ${piece.detail}`);
  });

  it("shows Slack the first sentence of a brief and none of the beats", () => {
    const alert: Alert = {
      ...analyzed,
      image: { url: "https://cdn.invalid/hero.png", altText: "Amplitude SDK", origin: "page" },
      analysis: { ...analysis, actions: [{ ...piece, detail: brief }] },
      issues: [],
    };
    const text = renderMessageText(buildSlackMessage(alert));
    expect(text).toContain(
      "*Consider publishing*\nPublish a PostHog take on whether you need an SDK or can send events from your warehouse.",
    );
    expect(text).not.toContain("What's in the draft");
    expect(text).not.toContain("- The hybrid setup");
  });
});

/**
 * The bullets under "More detail". The lines above the last are facts about
 * the piece; the last one says what the competitor is selling, which is the
 * line a marketer writes against, so nothing between the model and the issue
 * is allowed to cut it down to the closer it replaced.
 */
describe("the so-what bullet", () => {
  const soWhat =
    "The piece argues for their SDK as the collection layer their analytics platform needs on top of the warehouse: session replay, heatmaps, and pre-login attribution exist only if their library is on the page, so a warehouse-first team installs it anyway. A PostHog answer has to say which of those come from warehouse sources and which of them need posthog-js.";
  const facts = [
    "An explainer for data teams who already pipe product events into BigQuery or Snowflake, not an announcement.",
    "Concedes the warehouse wins for reconciled orders and payments, and for teams with one approved collection path.",
  ];
  const points = [...facts, soWhat];

  it("is longer than a fragment and shorter than the budget the prompt asks for", () => {
    expect(soWhat.length).toBeGreaterThan(MAX_POINT_CHARS);
    expect(soWhat.length).toBeLessThanOrEqual(MAX_SO_WHAT_CHARS);
  });

  it("survives the parse whole", () => {
    const parsed = parseAnalysis(
      JSON.stringify({
        impact: "minor",
        summary: analysis.summary,
        key_points: points,
        actions: [],
        no_action: { kind: "not_a_gap", reason: verdict.reason },
      }),
    );
    expect(parsed.keyPoints).toEqual(points);
  });

  it("reaches the issue in full, as the last bullet under More detail", () => {
    const body = buildIssueBody(
      { ...analyzed, analysis: { ...analysis, keyPoints: points } },
      null,
      piece,
      [],
      null,
    );
    expect(body).toContain(`## More detail\n- ${facts[0]}`);
    expect(body).toContain(`- ${soWhat}`);
    expect(body).not.toContain("\u2026");
  });

  it("keeps its room in Slack, where the lines above it stay fragments", () => {
    const long = `${facts[0]} ${facts[1]} ${facts[0]}`;
    const alert: Alert = {
      ...analyzed,
      image: { url: "https://cdn.invalid/hero.png", altText: "Amplitude SDK", origin: "page" },
      analysis: { ...analysis, keyPoints: [long, soWhat] },
      issues: [],
    };
    const rendered = renderMessageText(buildSlackMessage(alert));
    expect(rendered).toContain(`\u2022 ${soWhat}`);
    // The fact above it is held to the shorter budget, and says so with an ellipsis.
    expect(rendered).toContain(`\u2022 ${truncate(long, MAX_POINT_CHARS)}`);
    expect(rendered).toContain("\u2026");
  });
});

describe("the review pass", () => {
  it("shows the reviewer the whole draft and the pieces nearest it", () => {
    const prompt = buildReviewPrompt({
      alert: analyzed,
      action: { ...piece, similarPages: [TUTORIAL] },
      workspace: null,
      docs: [],
      index,
    });
    expect(prompt).toContain("Working title: Should you install the SDK");
    expect(prompt).toContain(`- ${TUTORIAL}`);
    expect(prompt).toContain("Try both on one product area and compare what you can answer.");
    expect(prompt).toContain("Product verdict it sits next to: not_a_gap");
    expect(prompt).toContain("For a consider_publishing action: the draft says something about PostHog the docs do not support");
    expect(prompt).toContain(
      "PostHog already publishes a piece on the same angle – the same reader question or thesis, not the same product area",
    );
  });

  it("asks the writer for the whole piece again, never a fragment", () => {
    const prompt = buildRewritePrompt({
      alert: analyzed,
      action: piece,
      review: { verdict: "revise", reason: "The draft says the SDK is required for flags.", pagesChecked: [LIBRARIES], changes: ["Fix the flags claim."] },
      docs: [],
      index,
    });
    expect(prompt).toContain('"article_draft" is the whole piece, rewritten, in markdown. Never a fragment');
    expect(prompt).toContain("Every consider_publishing action ships the piece with it");
    expect(prompt).not.toContain("Every update_pages action ships the rewrite with it");
  });

  it("reads a rewritten draft and folds it into the piece, and only into a piece", () => {
    const revision = parseRevision(
      JSON.stringify({ article_title: "SDK or warehouse?", article_draft: "# SDK or warehouse?\n\nNew — draft." }),
    );
    expect(revision.articleDraft).toBe("# SDK or warehouse?\n\nNew \u2013 draft.");

    const review = { verdict: "revise" as const, reason: "r", pagesChecked: [], changes: [] };
    const merged = mergeRevision(piece, [], revision, review, "minor");
    expect(merged.action.articleTitle).toBe("SDK or warehouse?");
    expect(merged.action.articleDraft).toBe("# SDK or warehouse?\n\nNew \u2013 draft.");
    expect(merged.action.type).toBe("consider_publishing");

    const product: RecommendedAction = { type: "consider_building", detail: "Build it." };
    const wrong = mergeRevision(product, [], revision, review, "minor");
    expect(wrong.action.articleDraft).toBeUndefined();
    expect(wrong.notes[0]).toMatch(/dropped an article draft from a consider_building rewrite/);
  });

  it("refuses to turn a piece into a product action, or a product action into a piece", () => {
    const review = { verdict: "revise" as const, reason: "r", pagesChecked: [], changes: [] };
    expect(mergeRevision(piece, [], { type: "consider_building", pageEdits: [] }, review, "minor").action.type).toBe("consider_publishing");
    expect(
      mergeRevision({ type: "consider_building", detail: "x" }, [], { type: "consider_publishing", pageEdits: [] }, review, "minor").action.type,
    ).toBe("consider_building");
  });

  class RecordingEditor implements IssueEditor {
    readonly description = "recording";
    readonly patches: IssuePatch[] = [];
    readonly comments: string[] = [];
    async update(issue: IssueRef | null, patch: IssuePatch): Promise<boolean> {
      this.patches.push(patch);
      return issue !== null;
    }
    async comment(_issue: IssueRef | null, body: string): Promise<boolean> {
      this.comments.push(body);
      return true;
    }
    async close(issue: IssueRef | null, reason: "completed" | "not_planned", labels?: string[]): Promise<boolean> {
      return this.update(issue, { state: "closed", stateReason: reason, ...(labels ? { labels } : {}) });
    }
  }

  const reviewer = (verdict: "agree" | "drop" | "revise", reason: string): Reviewer => ({
    model: "claude-fable-5-1",
    description: "fake",
    async review() {
      return { verdict, reason, pagesChecked: [BLOG], changes: ["Fix the flags claim."], readUrls: [BLOG], model: "claude-fable-5-1" };
    },
  });
  const issue: IssueRef = { number: 80, url: "https://github.com/o/r/issues/80" };
  const labels = ["competitor-happenings", "amplitude", "owner:marketing"];

  it("writes a dropped piece as a marketing line under the product verdict, not as the verdict", async () => {
    const editor = new RecordingEditor();
    const result = await reviewActions({
      alert: analyzed,
      image: null,
      targets: [{ action: piece, issue, labels }],
      editor,
      reviewer: reviewer("drop", "PostHog's blog already has this piece."),
      writer: null,
      index,
      workspace: null,
      budget: createReviewBudget({ reviewMaxPerRun: 12 } as never),
    });
    expect(result.analysis.actions).toEqual([]);
    expect(result.analysis.noAction?.kind).toBe("not_a_gap");
    expect(result.analysis.noAction?.reason).toBe(verdict.reason);
    expect(result.analysis.noAction?.marketing?.note).toContain("PostHog's blog already has this piece.");
    expect(result.analysis.noAction?.marketing?.pages.map((page) => page.url)).toEqual([BLOG]);
    expect(editor.patches.some((patch) => patch.state === "closed")).toBe(true);
  });

  it("re-renders the draft on a revise and files the rewritten piece", async () => {
    const editor = new RecordingEditor();
    const rewritten = `${DRAFT}\n\nFeature flags evaluate on the client with the SDK.`;
    const writer: ActionWriter = {
      model: "claude-opus-5",
      description: "fake",
      async rewrite() {
        return { pageEdits: [], articleDraft: rewritten };
      },
    };
    let rendered: string | undefined;
    const result = await reviewActions({
      alert: analyzed,
      image: null,
      targets: [{ action: { ...piece, similarPages: [BLOG] }, issue, labels }],
      editor,
      reviewer: reviewer("revise", "The draft says flags need the SDK."),
      writer,
      drafts: {
        description: "fake drafts",
        async make(_alert, action) {
          rendered = action.articleDraft;
          return { title: action.articleTitle ?? "", wordCount: 1, capturedOn: "2026-09-23", shots: [{ url: "https://raw.invalid/new-1.png", alt: "new", path: "new-1.png" }] };
        },
      },
      index,
      workspace: null,
      budget: createReviewBudget({ reviewMaxPerRun: 12 } as never),
    });
    expect(result.issues[0]?.action.articleDraft).toBe(rewritten);
    expect(result.issues[0]?.review?.verdict).toBe("revise");
    expect(rendered).toBe(rewritten);
    const patched = editor.patches.find((patch) => patch.body);
    expect(patched?.body).toContain("![new](https://raw.invalid/new-1.png)");
    expect(patched?.body).toContain("Feature flags evaluate on the client with the SDK.");
    expect(editor.comments.some((comment) => comment.includes("Working title:"))).toBe(true);
  });
});

describe("renderNoAction with a marketing line", () => {
  it("labels the second answer so it reads apart from the first", () => {
    const rendered = renderNoAction(
      { ...verdict, marketing: { note: "Nothing here is worth a PostHog piece.", pages: [] } },
      { flavor: "markdown" },
    );
    expect(rendered.split("\n")).toEqual([
      "**None \u2013 not a product gap**",
      verdict.reason,
      "**Marketing:** Nothing here is worth a PostHog piece.",
    ]);
  });
});
