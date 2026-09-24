import { describe, expect, it, vi } from "vitest";
import { analyzeItems, type Analyzer } from "../src/analysis/analyze.js";
import { FALLBACK_MODEL } from "../src/analysis/fallback.js";
import {
  MAX_ARTICLE_DRAFT_CHARS,
  MAX_DETAIL_CHARS,
  MAX_KEY_POINT_CHARS,
  parseAnalysis,
} from "../src/analysis/schema.js";
import { MAX_SO_WHAT_CHARS } from "../src/slack/message.js";
import { parseReview, parseRevision } from "../src/review/schema.js";
import type { Config } from "../src/config.js";
import type { Store } from "../src/db/store.js";
import type { StoredItem } from "../src/types.js";
import { corpus } from "./helpers.js";

/**
 * A length a model wrote past shortens the string, never the analysis.
 *
 * The bug this is here for: on 2026-09-23 a forced run of the Amplitude SDK
 * post came back with a `consider_publishing` action whose `detail` ran to
 * about a thousand characters. The cap was 900 and it threw, so the parse
 * failed, `analyzeItems` dropped the item, and the alert that reached Slack
 * was **None – not analyzed this run** with a restatement of the competitor's
 * own post under it. Three minutes of an analyst reading four thousand docs
 * pages, thrown away over one long field.
 *
 * Every case below is a reply that used to take the whole analysis down.
 */

const item: StoredItem = {
  id: "1",
  competitor: "amplitude",
  source: "blog",
  externalId: "amplitude-sdk-or-not",
  title: "Should I install the Amplitude SDK?",
  url: "https://amplitude.com/blog/amplitude-sdk-or-not",
  publishedAt: new Date("2026-09-01T00:00:00Z"),
  raw: { body: "Whether to install the SDK or send events from a warehouse." },
};

const words = (count: number): string => "warehouse events and the SDK ".repeat(count).trim();

/** The detail as the failing run wrote it: a real recommendation, over the old cap. */
const LONG_DETAIL = `Publish a PostHog take on whether to install the SDK or send events from your warehouse. ${words(60)}`;

function reply(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    impact: "minor",
    summary: "Amplitude published a piece on installing its SDK versus warehouse-only ingestion.",
    key_points: ["Makes the case for the SDK over warehouse-only event delivery."],
    actions: [
      {
        type: "consider_publishing",
        detail: LONG_DETAIL,
        article_title: "Should you install the SDK, or send events from your warehouse?",
        article_draft: `# Should you install the SDK?\n\n${words(120)}`,
      },
    ],
    no_action: {
      kind: "not_a_gap",
      reason: "This is a thought leadership article about installing an SDK. It's not an announcement of a new feature or product.",
    },
    posthog_refs: [],
    open_questions: [],
    ...overrides,
  });
}

describe("a reply longer than a budget", () => {
  it("parses the detail that used to fail the whole analysis", () => {
    expect(LONG_DETAIL.length).toBeGreaterThan(900);
    expect(LONG_DETAIL.length).toBeLessThan(MAX_DETAIL_CHARS);

    const parsed = parseAnalysis(reply());
    expect(parsed.actions).toHaveLength(1);
    expect(parsed.actions[0]?.type).toBe("consider_publishing");
    expect(parsed.actions[0]?.detail).toBe(LONG_DETAIL);
    expect(parsed.noAction?.kind).toBe("not_a_gap");
  });

  it("shortens a detail past the budget and keeps everything else", () => {
    const parsed = parseAnalysis(
      reply({
        actions: [
          { type: "consider_publishing", detail: `Publish it. ${words(400)}`, article_title: "T", article_draft: words(200) },
        ],
      }),
    );
    expect(parsed.actions).toHaveLength(1);
    expect((parsed.actions[0]?.detail ?? "").length).toBeLessThanOrEqual(MAX_DETAIL_CHARS);
    expect(parsed.actions[0]?.detail?.startsWith("Publish it.")).toBe(true);
    expect(parsed.summary).toContain("Amplitude published a piece");
  });

  it("shortens every other string a model can overrun, one field at a time", () => {
    const parsed = parseAnalysis(
      reply({
        summary: words(400),
        key_points: [words(400)],
        open_questions: [`Does PostHog cover this? ${words(400)}`],
        actions: [
          {
            type: "consider_enhancing",
            feature: words(40),
            detail: "Close this gap in Experiments.",
            gap: words(200),
            evidence_url: "https://posthog.com/docs/experiments",
            evidence_quote: words(200),
          },
        ],
        posthog_refs: [{ url: "https://posthog.com/pricing", claim: words(400), proposed_text: words(400) }],
        no_action: undefined,
      }),
    );
    expect(parsed.summary.length).toBeLessThanOrEqual(600);
    expect(parsed.actions).toHaveLength(1);
    expect((parsed.actions[0]?.gap ?? "").length).toBeLessThanOrEqual(400);
    expect((parsed.actions[0]?.feature ?? "").length).toBeLessThanOrEqual(120);
    expect((parsed.actions[0]?.evidenceQuote ?? "").length).toBeLessThanOrEqual(600);
    expect((parsed.posthogRefs[0]?.claim ?? "").length).toBeLessThanOrEqual(1_200);
    expect((parsed.posthogRefs[0]?.proposedText ?? "").length).toBeLessThanOrEqual(1_200);
    expect(parsed.keyPoints).toHaveLength(1);
    expect(parsed.openQuestions).toHaveLength(1);
  });

  it("shortens a draft past its budget rather than losing the piece", () => {
    const parsed = parseAnalysis(
      reply({
        actions: [
          {
            type: "consider_publishing",
            detail: "Publish a PostHog take on the SDK question.",
            article_title: "Should you install the SDK?",
            article_draft: words(4_000),
          },
        ],
      }),
    );
    expect(parsed.actions).toHaveLength(1);
    expect((parsed.actions[0]?.articleDraft ?? "").length).toBeLessThanOrEqual(MAX_ARTICLE_DRAFT_CHARS);
  });

  /**
   * The last key point is the so-what, and the prompt asks for up to
   * `MAX_SO_WHAT_CHARS` of it. The schema budget sits above that on purpose:
   * a so-what cut in half is the thin closer it was written to replace.
   */
  it("keeps a so-what last key point whole, and holds room above what the prompt asks for", () => {
    expect(MAX_KEY_POINT_CHARS).toBeGreaterThanOrEqual(MAX_SO_WHAT_CHARS * 2);

    const soWhat = `${"The piece argues for their SDK as the layer their platform needs on top of the warehouse. ".repeat(4)}A PostHog answer has to say which parts warehouse sources already cover.`;
    expect(soWhat.length).toBeGreaterThan(MAX_SO_WHAT_CHARS);
    expect(soWhat.length).toBeLessThanOrEqual(MAX_KEY_POINT_CHARS);

    const parsed = parseAnalysis(reply({ key_points: ["An explainer for data teams.", soWhat] }));
    expect(parsed.keyPoints).toEqual(["An explainer for data teams.", soWhat]);
    expect(parsed.keyPoints[1]).not.toContain("\u2026");
  });

  it("keeps the first entries of a list that ran long rather than failing it", () => {
    const action = { type: "consider_building", detail: "Build it." };
    const parsed = parseAnalysis(
      reply({
        actions: [action, action, action, action, action, action],
        posthog_refs: Array.from({ length: 9 }, (_, index) => ({
          url: `https://posthog.com/page-${index}`,
          claim: "Something it says.",
        })),
        open_questions: Array.from({ length: 12 }, (_, index) => `Question ${index}?`),
        no_action: undefined,
      }),
    );
    expect(parsed.actions.length).toBeGreaterThan(0);
    expect(parsed.posthogRefs).toHaveLength(5);
    expect(parsed.openQuestions.length).toBeLessThanOrEqual(8);
  });

  it("does the same for a reviewer's reply and a rewrite", () => {
    const review = parseReview(
      JSON.stringify({
        verdict: "revise",
        reason: words(400),
        pages_checked: Array.from({ length: 20 }, (_, index) => `https://posthog.com/p-${index}`),
        changes: Array.from({ length: 10 }, () => words(300)),
      }),
    );
    expect(review.verdict).toBe("revise");
    expect(review.reason.length).toBeLessThanOrEqual(900);
    expect(review.pagesChecked).toHaveLength(12);
    expect(review.changes).toHaveLength(6);

    const revision = parseRevision(JSON.stringify({ detail: words(400), gap: words(200) }));
    expect((revision.detail ?? "").length).toBeLessThanOrEqual(MAX_DETAIL_CHARS);
    expect((revision.gap ?? "").length).toBeLessThanOrEqual(400);
  });
});

describe("a draft written into the detail", () => {
  it("moves it to article_draft, and keeps what was written above it as the detail", () => {
    const lead = "Publish a PostHog take on whether to install the SDK or send events from your warehouse.";
    const draft = `## What the SDK does\n\n${words(80)}\n\n## What the warehouse does\n\n${words(80)}`;
    const parsed = parseAnalysis(
      reply({
        actions: [
          {
            type: "consider_publishing",
            detail: `${lead}\n\n${draft}`,
            article_title: "Should you install the SDK?",
          },
        ],
      }),
    );
    expect(parsed.actions[0]?.detail).toBe(lead);
    expect(parsed.actions[0]?.articleDraft).toContain("## What the SDK does");
    expect(parsed.actions[0]?.articleDraft).toContain("## What the warehouse does");
  });

  it("falls back to the draft's own first paragraph when nothing was written above it", () => {
    const parsed = parseAnalysis(
      reply({
        actions: [
          {
            type: "consider_publishing",
            detail: `# Should you install the SDK?\n\nThe short answer is that it depends on what you want to see.\n\n${words(80)}`,
            article_title: "Should you install the SDK?",
          },
        ],
      }),
    );
    expect(parsed.actions[0]?.detail).toBe("The short answer is that it depends on what you want to see.");
    expect(parsed.actions[0]?.articleDraft?.startsWith("# Should you install the SDK?")).toBe(true);
  });

  it("leaves a detail that merely runs long alone, and one that already has its draft", () => {
    const parsed = parseAnalysis(reply());
    expect(parsed.actions[0]?.detail).toBe(LONG_DETAIL);
    expect(parsed.actions[0]?.articleDraft).toContain("# Should you install the SDK?");

    const product = parseAnalysis(
      reply({
        actions: [{ type: "consider_building", detail: `Build it.\n\n## Why\n\n${words(80)}` }],
        no_action: undefined,
      }),
    );
    expect(product.actions[0]?.articleDraft).toBeUndefined();
  });
});

/**
 * The end the bug was felt at: the item reaches Slack analyzed, with its
 * action, rather than as "not analyzed this run".
 */
describe("analyzeItems on the reply that used to be dropped", () => {
  const store = {
    getClaims: async () => [],
    recordCorpusRun: async () => undefined,
  } as unknown as Store;

  const config = { retrievalTopK: 4, retrievalPerSection: 2 } as Config;
  const context = { index: corpus({ url: "https://posthog.com/docs/libraries", title: "SDKs", text: "Install the SDK." }), workspace: null };
  const compare = { claimsFor: async () => [] };

  const analyzer = (text: string): Analyzer => ({
    model: "claude-opus-5",
    analyze: async () => ({ analysis: parseAnalysis(text), readUrls: [] }),
  });

  it("analyzes it instead of giving up on it", async () => {
    const analyzed = await analyzeItems([item], store, analyzer(reply()), config, context, compare);
    expect(analyzed).toHaveLength(1);
    expect(analyzed[0]?.model).not.toBe(FALLBACK_MODEL);
    expect(analyzed[0]?.analysis.actions.map((action) => action.type)).toEqual(["consider_publishing"]);
    expect(analyzed[0]?.analysis.noAction?.kind).toBe("not_a_gap");
  });

  it("still gives up on a reply that is not an analysis at all", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken: Analyzer = {
      model: "claude-opus-5",
      analyze: async () => {
        throw new Error("no JSON object found in model output");
      },
    };
    expect(await analyzeItems([item], store, broken, config, context, compare)).toEqual([]);
    warn.mockRestore();
  });
});
