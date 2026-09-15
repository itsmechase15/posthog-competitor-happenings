import { describe, expect, it } from "vitest";
import {
  gapQuery,
  gateActions,
  isDocumentationOnlyAction,
  isPackagingGap,
  quoteAppearsOn,
  type CoverageContext,
} from "../src/analysis/evidence.js";
import type { Analysis, RecommendedAction } from "../src/types.js";
import { corpus, EMPTY_CORPUS } from "./helpers.js";

/**
 * A small corpus that mirrors the shape of the real one: a product PostHog
 * documents in depth, a product marketing page, and a changelog entry.
 */
const index = corpus(
  {
    url: "https://posthog.com/docs/experiments/managing-lifecycle",
    title: "Managing the experiment lifecycle",
    text: "Experiments move through draft, running, and complete. You stop an experiment by clicking complete when you have enough data. There is no end date field on an experiment, so stopping is always a manual step.",
  },
  {
    url: "https://posthog.com/docs/feature-flags/scheduled-flag-changes",
    title: "Scheduled flag changes",
    text: "Schedule a feature flag change for a future date. You can schedule a rollout percentage change or turn the flag off entirely.",
  },
  {
    url: "https://posthog.com/docs/session-replay/privacy",
    title: "Session replay privacy controls",
    text: "Mask every input and all text so a session recording never captures what a person typed. Masking is on by default for password fields.",
  },
  {
    url: "https://posthog.com/compare/mixpanel-vs-posthog",
    title: "Mixpanel vs PostHog",
    kind: "marketing",
    text: "PostHog is the open-source alternative to Mixpanel. Mixpanel has no session replay of its own.",
  },
  {
    url: "https://posthog.com/experiments",
    title: "Experiments",
    kind: "marketing",
    text: "Run A/B tests and read the result without leaving PostHog.",
  },
  {
    url: "https://posthog.com/changelog/2026-01",
    title: "January changelog",
    kind: "changelog",
    text: "Experiments can now be stopped from the API, which nothing in the docs mentions yet.",
  },
);

function context(seen: string[] = []): CoverageContext {
  return { index, seenUrls: new Set(seen) };
}

function analysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    impact: "notable",
    summary: "Amplitude shipped a scheduled experiment stop.",
    keyPoints: [],
    actions: [],
    posthogRefs: [],
    openQuestions: [],
    ...overrides,
  };
}

const LIFECYCLE = "https://posthog.com/docs/experiments/managing-lifecycle";

/** A gap claim with real evidence, read off the page the corpus ranks for it. */
const goodGap: RecommendedAction = {
  type: "consider_enhancing",
  feature: "Experiments",
  detail: "Add a scheduled end time on experiments so a test can stop on its own.",
  gap: "no end date field on an experiment, so stopping is a manual step",
  evidenceUrl: LIFECYCLE,
  evidenceQuote: "There is no end date field on an experiment",
};

describe("quoteAppearsOn", () => {
  const text = "There is no end date field on an experiment, so stopping is always a manual step.";

  it("accepts a quote copied off the page, punctuation and all", () => {
    expect(quoteAppearsOn("There is no end date field on an experiment", text)).toBe(true);
  });

  it("forgives punctuation the analyst tidied, because the words are the claim", () => {
    expect(quoteAppearsOn("there is no end-date field, on an experiment", text)).toBe(true);
  });

  it("rejects a paraphrase, which is the thing it exists to catch", () => {
    expect(quoteAppearsOn("Experiments cannot be scheduled to end", text)).toBe(false);
  });

  it("accepts an elided quote when every part of it is on the page", () => {
    expect(quoteAppearsOn("There is no end date field ... always a manual step", text)).toBe(true);
  });

  it("rejects an elided quote where one part is invented", () => {
    expect(quoteAppearsOn("There is no end date field ... and no API either", text)).toBe(false);
  });

  it("rejects a fragment too short to prove anything", () => {
    expect(quoteAppearsOn("no end", text)).toBe(false);
  });

  it("rejects anything at all against a page with no text", () => {
    expect(quoteAppearsOn("There is no end date field on an experiment", "")).toBe(false);
  });
});

describe("gapQuery", () => {
  it("searches on the gap and the product it names", () => {
    expect(gapQuery(goodGap)).toContain("end date field");
    expect(gapQuery(goodGap)).toContain("Experiments");
  });
});

describe("isPackagingGap", () => {
  it("catches a gap about what a competitor charges", () => {
    expect(isPackagingGap({ ...goodGap, gap: "their free tier is more generous" })).toBe(true);
    expect(isPackagingGap({ ...goodGap, gap: "per-seat billing is cheaper there" })).toBe(true);
  });

  it("leaves a gap about what the product does, whatever it says about money", () => {
    expect(
      isPackagingGap({
        ...goodGap,
        gap: "session replay stops recording past the free tier limit without telling anyone",
      }),
    ).toBe(false);
  });

  it("leaves a gap that mentions no money at all", () => {
    expect(isPackagingGap(goodGap)).toBe(false);
  });
});

describe("isDocumentationOnlyAction", () => {
  it("catches an action asking for words rather than a change", () => {
    expect(
      isDocumentationOnlyAction({ ...goodGap, detail: "Document how experiments stop." }),
    ).toBe(true);
  });

  it("leaves an action asking for a change that happens to mention the docs", () => {
    expect(
      isDocumentationOnlyAction({
        ...goodGap,
        detail: "Add a scheduled end time, and document it on the experiments page.",
      }),
    ).toBe(false);
  });
});

describe("gateActions", () => {
  it("lets through a gap whose page was read and whose quote is on it", () => {
    const result = gateActions(analysis({ actions: [goodGap] }), context([LIFECYCLE]));

    expect(result.blocked).toEqual([]);
    expect(result.analysis.actions).toEqual([goodGap]);
  });

  describe("what it blocks", () => {
    const cases: Array<{ name: string; action: RecommendedAction; because: string }> = [
      {
        name: "a gap claim that names no gap",
        action: { ...goodGap, gap: undefined },
        because: "nothing to check",
      },
      {
        name: "a gap claim that cites no page",
        action: { ...goodGap, evidenceUrl: undefined },
        because: "cites no PostHog docs page",
      },
      {
        name: "a gap claim citing a page the corpus does not hold",
        action: { ...goodGap, evidenceUrl: "https://posthog.com/docs/made-up" },
        because: "not a page in PostHog's docs corpus",
      },
      {
        name: "a gap read off marketing copy",
        action: { ...goodGap, evidenceUrl: "https://posthog.com/experiments" },
        because: "marketing copy is written on some past date",
      },
      {
        name: "a gap read off a changelog entry",
        action: { ...goodGap, evidenceUrl: "https://posthog.com/changelog/2026-01" },
        because: "the opposite of evidence for a gap",
      },
      {
        name: "a gap with a page but no quote",
        action: { ...goodGap, evidenceQuote: undefined },
        because: "without quoting what the page says",
      },
      {
        name: "a gap whose quote is a paraphrase",
        action: { ...goodGap, evidenceQuote: "Experiments cannot be scheduled to end at all" },
        because: "does not contain",
      },
      {
        name: "a gap about what the competitor charges",
        action: { ...goodGap, gap: "their free tier is more generous than ours" },
        because: "what a competitor charges",
      },
      {
        name: "an action asking for the docs to be written",
        action: { ...goodGap, detail: "Document how experiments stop today." },
        because: "not one of this bot's actions",
      },
    ];

    for (const { name, action, because } of cases) {
      it(`blocks ${name}`, () => {
        const result = gateActions(analysis({ actions: [action] }), context([LIFECYCLE]));

        expect(result.analysis.actions).toEqual([]);
        expect(result.blocked).toHaveLength(1);
        expect(result.blocked[0]?.reason).toContain(because);
      });
    }
  });

  it("blocks a well-argued gap the docs answer on a page nobody opened", () => {
    // The failure every other check misses: the evidence offered is real, and
    // it is not the relevant evidence.
    const wrongPage: RecommendedAction = {
      type: "consider_building",
      feature: "Session replay",
      detail: "Build masking for session recordings so nothing typed is captured.",
      gap: "no way to mask inputs and text in a session recording",
      evidenceUrl: LIFECYCLE,
      evidenceQuote: "There is no end date field on an experiment",
    };

    const result = gateActions(analysis({ actions: [wrongPage] }), context([LIFECYCLE]));

    expect(result.analysis.actions).toEqual([]);
    expect(result.blocked[0]?.reason).toContain("session-replay/privacy");
  });

  it("turns what it blocked into an open question rather than a correction", () => {
    const result = gateActions(
      analysis({ actions: [{ ...goodGap, evidenceQuote: undefined }] }),
      context([LIFECYCLE]),
    );

    expect(result.analysis.openQuestions).toHaveLength(1);
    expect(result.analysis.openQuestions[0]).toContain("without quoting what the page says");
  });

  it("says why there is nothing to do once everything is blocked", () => {
    const result = gateActions(
      analysis({ actions: [{ ...goodGap, gap: undefined }] }),
      context([LIFECYCLE]),
    );

    expect(result.analysis.actions).toEqual([]);
    expect(result.analysis.noActionReason).toContain("survived the evidence checks");
  });

  it("keeps the actions that pass and drops only the ones that do not", () => {
    const result = gateActions(
      analysis({ actions: [goodGap, { ...goodGap, gap: "their plan price is lower" }] }),
      context([LIFECYCLE]),
    );

    expect(result.analysis.actions).toEqual([goodGap]);
    expect(result.analysis.noActionReason).toBeUndefined();
  });

  describe("page edits", () => {
    const edit: RecommendedAction = {
      type: "update_pages",
      detail: "On the Mixpanel compare page, say Mixpanel now ships session replay.",
    };

    it("lets through an edit whose page and quoted copy are both real", () => {
      const result = gateActions(
        analysis({
          actions: [edit],
          posthogRefs: [
            {
              url: "https://posthog.com/compare/mixpanel-vs-posthog",
              claim: "Mixpanel has no session replay of its own",
              suggestedEdit: "Say they now ship it.",
            },
          ],
        }),
        context(),
      );

      expect(result.blocked).toEqual([]);
    });

    it("blocks an edit that names no page anyone owns", () => {
      const result = gateActions(analysis({ actions: [edit] }), context());
      expect(result.blocked[0]?.reason).toContain("names no PostHog marketing");
    });

    it("blocks an edit that names a page but not what it should say", () => {
      const result = gateActions(
        analysis({
          actions: [edit],
          posthogRefs: [
            {
              url: "https://posthog.com/compare/mixpanel-vs-posthog",
              claim: "Mixpanel has no session replay of its own",
            },
          ],
        }),
        context(),
      );
      expect(result.blocked[0]?.reason).toContain("not what the page should say instead");
    });

    it("blocks an edit correcting copy the page no longer carries", () => {
      // A page that has already been fixed is a page nobody should be sent to.
      const result = gateActions(
        analysis({
          actions: [edit],
          posthogRefs: [
            {
              url: "https://posthog.com/compare/mixpanel-vs-posthog",
              claim: "Mixpanel cannot record a single session anywhere in their product",
              suggestedEdit: "Say they now ship it.",
            },
          ],
        }),
        context(),
      );
      expect(result.blocked[0]?.reason).toContain("may already say something else");
    });
  });

  describe("new compare pages", () => {
    const newPage: RecommendedAction = {
      type: "new_compare_page",
      detail: "Write a PostHog vs Heap comparison page.",
    };

    it("lets through a page PostHog does not already publish", () => {
      expect(gateActions(analysis({ actions: [newPage] }), context()).blocked).toEqual([]);
    });

    it("blocks a page PostHog already publishes", () => {
      // The same class of mistake as telling PostHog to build what it ships.
      const result = gateActions(
        analysis({
          actions: [newPage],
          posthogRefs: [
            {
              url: "https://posthog.com/compare/mixpanel-vs-posthog",
              claim: "PostHog is the open-source alternative to Mixpanel",
            },
          ],
        }),
        context(),
      );

      expect(result.blocked[0]?.reason).toContain("already publishes");
    });
  });

  it("blocks every gap claim when the corpus is empty, because none can be checked", () => {
    const result = gateActions(analysis({ actions: [goodGap] }), {
      index: EMPTY_CORPUS,
      seenUrls: new Set(),
    });

    expect(result.analysis.actions).toEqual([]);
    expect(result.blocked[0]?.reason).toContain("not a page in PostHog's docs corpus");
  });
});
