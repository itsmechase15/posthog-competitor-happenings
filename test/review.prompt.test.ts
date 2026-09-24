import { describe, expect, it } from "vitest";
import { BRIEF_LABEL_ORDER } from "../src/analysis/brief.js";
import { buildReviewPrompt, buildRewritePrompt } from "../src/review/prompt.js";
import { parseReview } from "../src/review/schema.js";
import type { AnalyzedItem, RecommendedAction, StoredItem } from "../src/types.js";
import type { DocsWorkspace } from "../src/posthog/workspace.js";
import { corpus } from "./helpers.js";

const item: StoredItem = {
  id: "1",
  competitor: "amplitude",
  source: "changelog",
  externalId: "guid-1",
  title: "Web Experiment: Cookie consent management",
  url: "https://fixture.invalid/releases/web-experiment-cookie-consent-management",
  publishedAt: new Date("2026-08-25T00:00:00Z"),
  raw: {},
};

const action: RecommendedAction = {
  type: "consider_enhancing",
  feature: "Experiments",
  detail: "Add a consent-pending mode for web experiments so exposures buffer and flush on grant.",
  gap: "No consent-pending buffer for web experiments.",
  evidenceUrl: "https://posthog.com/docs/tutorials/cookieless-tracking",
  evidenceQuote: "PostHog doesn't capture any events until after consent is either given or denied.",
};

const COMPARE = "https://posthog.com/compare/best-amplitude-alternatives";

const alert: AnalyzedItem = {
  item,
  model: "claude-opus-5",
  analysis: {
    impact: "notable",
    summary: "Amplitude added cookie consent gating to its Web Experiment script.",
    keyPoints: [],
    actions: [action],
    posthogRefs: [
      {
        url: COMPARE,
        claim: "Both tools require manual consent handling.",
        proposedText:
          "Amplitude gates its Web Experiment script on consent. PostHog captures nothing until a visitor gives or denies it.",
        suggestedEdit: "Note that Amplitude gates its experiment script on consent.",
      },
    ],
    openQuestions: [],
  },
};

const pageAction: RecommendedAction = {
  type: "update_pages",
  detail: `On the best amplitude alternatives page, say Amplitude gates its experiment script on consent.`,
};

const docs = [
  {
    url: "https://posthog.com/docs/privacy/data-collection",
    title: "Data collection",
    excerpt: "Integrate your consent management platform with PostHog's opt in and out controls.",
    kind: "docs" as const,
  },
];

const workspace = { dir: "/tmp/corpus" } as DocsWorkspace;

describe("buildReviewPrompt", () => {
  const prompt = buildReviewPrompt({ alert, action, workspace, docs });

  it("shows the reviewer the action exactly as it was filed", () => {
    expect(prompt).toContain("Action type: consider_enhancing");
    expect(prompt).toContain("PostHog feature named: Experiments");
    expect(prompt).toContain("Gap claimed: No consent-pending buffer for web experiments.");
    expect(prompt).toContain(
      "Evidence page: https://posthog.com/docs/tutorials/cookieless-tracking",
    );
    expect(prompt).toContain(
      'Evidence quote: "PostHog doesn\'t capture any events until after consent is either given or denied."',
    );
  });

  it("shows the copy proposed for a page, which is what a page action is judged on", () => {
    expect(prompt).toContain(`- ${COMPARE}`);
    expect(prompt).toContain('on the page today: "Both tools require manual consent handling."');
    expect(prompt).toContain(
      'copy proposed for it: "Amplitude gates its Web Experiment script on consent.',
    );
    expect(prompt).toContain('why: "Note that Amplitude gates its experiment script on consent."');
  });

  it("says an update_pages action with no copy for the page is a revise on its own", () => {
    const noCopy = buildReviewPrompt({
      alert: {
        ...alert,
        analysis: {
          ...alert.analysis,
          posthogRefs: [{ url: COMPARE, claim: "Both tools require manual consent handling." }],
        },
      },
      action: pageAction,
      workspace,
      docs,
    });
    expect(noCopy).toContain("(none, which is a revise on its own for update_pages)");
    expect(prompt).toContain(
      "An update_pages action with no proposed copy at all is a revise, not a drop",
    );
  });

  /**
   * "Is this edit proportional to the page?" is unanswerable from an excerpt,
   * so the reviewer gets both lengths and the number the gate measures with.
   */
  const shortPage = corpus({
    url: COMPARE,
    title: "The best Amplitude alternatives",
    kind: "marketing",
    text: "Both tools require manual consent handling. PostHog is the open-source alternative to Amplitude.",
  });

  it("says how long the page is and how much the copy adds to it", () => {
    const sized = buildReviewPrompt({
      alert,
      action: pageAction,
      workspace,
      docs,
      index: shortPage,
    });

    expect(sized).toContain("size: the page runs about 13 words");
    expect(sized).toContain("within the 60 a page that length carries");
  });

  it("says when the copy is more than the page can carry", () => {
    const dump = Array.from(
      { length: 8 },
      (_, index) =>
        `Amplitude gates its Web Experiment script on consent, and their ${index + 1} paragraph of release notes says how the buffer flushes when a visitor grants it.`,
    ).join(" ");
    const sized = buildReviewPrompt({
      alert: {
        ...alert,
        analysis: {
          ...alert.analysis,
          posthogRefs: [
            {
              url: COMPARE,
              claim: "Both tools require manual consent handling.",
              proposedText: dump,
            },
          ],
        },
      },
      action: pageAction,
      workspace,
      docs,
      index: shortPage,
    });

    expect(sized).toContain("over the 60 a page that length carries");
  });

  it("leaves the size out rather than guessing when the corpus is not to hand", () => {
    expect(buildReviewPrompt({ alert, action: pageAction, workspace, docs })).not.toContain(
      "size: the page runs",
    );
  });

  it("makes a page edit out of proportion to its page a revise, and sometimes a drop", () => {
    expect(prompt).toContain("the copy is out of proportion to the page it lands on");
    expect(prompt).toContain("an edit may add up to a fifth of the page's own length");
    expect(prompt).toContain("Where no short version is worth making, that is a drop");
  });

  it("names the three verdicts and the bar for each", () => {
    for (const fragment of [
      '"agree": it stands',
      '"revise": there is real work to file here',
      '"drop": there is nothing to file',
      "Do not revise for style",
      "Do not drop because you could not confirm the gap",
    ]) {
      expect(prompt).toContain(fragment);
    }
  });

  it("rules out the type changes a review may not ask for", () => {
    expect(prompt).toContain(
      "There is no path from a product action into update_pages or new_compare_page",
    );
  });

  it("calibrates on a real revise rather than describing one", () => {
    expect(prompt).toContain("## What a revise looks like");
    expect(prompt).toContain("Why that is a revise and not an agree or a drop");
    expect(prompt).toContain("Narrow the gap to what the quoted page supports");
    expect(prompt).toContain("What the same reply must not do");
  });

  it("tells it to search the corpus on disk, and what each page is evidence of", () => {
    expect(prompt).toContain("## The PostHog docs, as files you can search");
    expect(prompt).toContain("kind: changelog");
    expect(prompt).toContain("shipped, may be undocumented");
    expect(prompt).toContain("Cite the `url` from a file's header, never the file path.");
  });

  it("holds back the verdicts that need the docs when there is no corpus on disk", () => {
    const textOnly = buildReviewPrompt({ alert, action, workspace: null, docs });
    expect(textOnly).toContain("You have no searchable copy of PostHog's docs this run");
    expect(textOnly).toContain("you cannot drop the action");
    expect(textOnly).not.toContain("## The PostHog docs, as files you can search");
  });

  it("carries the handbook, because the reason is posted as a comment", () => {
    expect(prompt).toContain("Never use an em dash");
    expect(prompt).toContain("posthog.com/handbook/wizard-and-docs/docs-style-guide");
  });

  it("asks for the shape the parser reads", () => {
    // The parser is what actually enforces the contract, so the two have to agree.
    expect(prompt).toContain('"verdict": "agree" | "revise" | "drop"');
    expect(() =>
      parseReview(
        JSON.stringify({
          verdict: "revise",
          reason: "The quote does not carry the gap.",
          pages_checked: ["https://posthog.com/docs/privacy/data-collection"],
          changes: ["Narrow the gap."],
          impact: "notable",
          action_type: "consider_enhancing",
        }),
      ),
    ).not.toThrow();
  });
});

describe("buildRewritePrompt", () => {
  const review = parseReview(
    JSON.stringify({
      verdict: "revise",
      reason: "The gap claims more than the quoted page supports.",
      pages_checked: ["https://posthog.com/docs/privacy/data-collection"],
      changes: ["Narrow the gap to what the quote carries.", "Cite the data collection page."],
      impact: "major",
    }),
  );
  const prompt = buildRewritePrompt({ alert, action, review, docs });

  it("hands over the reviewer's reason, its changes, and the pages it read", () => {
    expect(prompt).toContain("Reason: The gap claims more than the quoted page supports.");
    expect(prompt).toContain("- Narrow the gap to what the quote carries.");
    expect(prompt).toContain("- Cite the data collection page.");
    expect(prompt).toContain("Pages it read:\n- https://posthog.com/docs/privacy/data-collection");
    expect(prompt).toContain("The impact should be: major");
  });

  it("says the rewrite is checked afterwards, and what fails it", () => {
    expect(prompt).toContain("Code re-runs the whole evidence gate on your answer");
    expect(prompt).toContain("a rewrite that fails it is thrown away with the original left standing");
    expect(prompt).toContain("has to appear on that page exactly as it is written there");
  });

  it("bounds what it may quote to the pages already read", () => {
    expect(prompt).toContain("## The pages you may quote");
    expect(prompt).toContain("https://posthog.com/docs/privacy/data-collection");
    expect(prompt).toContain("A quote from anywhere else does not.");
  });

  it("asks for the sentence shape Slack renders", () => {
    expect(prompt).toContain("leads with the work to do, not with what PostHog lacks");
    expect(prompt).toContain("under 220 characters");
  });

  it("says nothing about the type when the reviewer did not ask for one", () => {
    const asIs = buildRewritePrompt({
      alert,
      action,
      review: { ...review, actionType: undefined, impact: undefined },
      docs,
    });
    expect(asIs).not.toContain("The type should be:");
    expect(asIs).not.toContain("The impact should be:");
  });

  it("says so when the reviewer listed no specific change", () => {
    const bare = buildRewritePrompt({ alert, action, review: { ...review, changes: [] }, docs });
    expect(bare).toContain("Changes it asked for: none listed");
  });

  /**
   * A revise may replace `detail`, so the brief's shape is asked for again
   * here. Without it a rewritten piece comes back in whatever shape the writer
   * felt like, and the labels last exactly one review.
   */
  it("gives a piece to publish the brief's labels and the antecedent rule", () => {
    const piece: RecommendedAction = {
      type: "consider_publishing",
      detail: "Publish a PostHog take on whether to install the SDK or send from your warehouse.",
      articleTitle: "SDK or warehouse?",
      articleDraft: "# SDK or warehouse?\n\nA draft.",
    };
    const prompt = buildRewritePrompt({ alert, action: piece, review, docs });
    for (const label of BRIEF_LABEL_ORDER) expect(prompt).toContain(`"**${label}**"`);
    expect(prompt).toContain('"PostHog can own this because it ships both sides" fails twice');
  });

  it("says nothing about the brief on a product action", () => {
    for (const label of BRIEF_LABEL_ORDER) expect(prompt).not.toContain(label);
    expect(prompt).not.toContain('For consider_publishing, "detail" is the brief');
  });
});
