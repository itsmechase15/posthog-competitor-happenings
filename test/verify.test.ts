import { describe, expect, it } from "vitest";
import { claimsGap, relevantDocs, verifyAgainstDocs } from "../src/analysis/verify.js";
import type { Analysis, PostHogDoc } from "../src/types.js";

const flagScheduling: PostHogDoc = {
  url: "https://posthog.com/docs/feature-flags/scheduled-flag-changes",
  title: "Scheduled flag changes",
  excerpt:
    "Scheduled flag changes let you set a date and time for a feature flag to change. You can schedule a rollout percentage change, or schedule the flag to turn off.",
};

const experimentLifecycle: PostHogDoc = {
  url: "https://posthog.com/docs/experiments/managing-lifecycle",
  title: "Managing the experiment lifecycle",
  excerpt:
    "You launch an experiment by hand and stop it by hand when it has enough data. There is no end date field on an experiment.",
};

const replay: PostHogDoc = {
  url: "https://posthog.com/docs/session-replay",
  title: "Session replay",
  excerpt: "Session replay records what a person did in your product so you can watch it back.",
};

function analysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    impact: "notable",
    summary: "Amplitude now schedules an experiment stop.",
    keyPoints: ["Pick an end date when you launch."],
    actions: [],
    posthogRefs: [],
    openQuestions: [],
    ...overrides,
  };
}

describe("claimsGap", () => {
  it("spots the claim a reader acts on without checking", () => {
    for (const detail of [
      "PostHog has no way to schedule an experiment stop.",
      "PostHog does not schedule experiment stops.",
      "PostHog can't stop an experiment on a date.",
      "PostHog experiments have no end time.",
      "There is no PostHog equivalent of this.",
      "PostHog lacks scheduled stops.",
    ]) {
      expect(claimsGap(detail)).toBe(true);
    }
  });

  it("leaves a claim about the competitor alone", () => {
    expect(claimsGap("Amplitude cannot schedule a stop on the free plan.")).toBe(false);
    expect(
      claimsGap("PostHog schedules flag changes, and experiments stop when you click complete."),
    ).toBe(false);
  });
});

describe("relevantDocs", () => {
  it("finds the docs for the feature an action names", () => {
    const docs = relevantDocs(
      { type: "consider_enhancing", feature: "Experiments", detail: "d" },
      [replay, experimentLifecycle],
    );
    expect(docs.map((doc) => doc.url)).toEqual([experimentLifecycle.url]);
  });

  it("falls back to what the detail is about when no feature is named", () => {
    const docs = relevantDocs(
      { type: "consider_building", detail: "PostHog has no scheduled stop for an experiment." },
      [replay, experimentLifecycle],
    );
    expect(docs.map((doc) => doc.url)).toEqual([experimentLifecycle.url]);
  });

  it("returns nothing when no docs page speaks to the action", () => {
    expect(
      relevantDocs({ type: "consider_building", detail: "PostHog has no billing portal." }, [
        replay,
      ]),
    ).toEqual([]);
  });
});

describe("verifyAgainstDocs", () => {
  it("will not let consider_building stand when the docs cover the product", () => {
    const verified = verifyAgainstDocs(
      analysis({
        actions: [
          {
            type: "consider_building",
            detail: "PostHog has nothing that stops an experiment on a schedule.",
          },
        ],
      }),
      [experimentLifecycle, flagScheduling],
    );

    const [action] = verified.analysis.actions;
    expect(action?.type).toBe("consider_enhancing");
    expect(action?.feature).toBe("Experiments");
    expect(action?.detail).toContain("PostHog already ships Experiments here");
    expect(action?.detail).toContain(experimentLifecycle.url);
    expect(verified.analysis.posthogRefs.map((ref) => ref.url)).toContain(experimentLifecycle.url);
    expect(verified.notes.join(" ")).toContain("retyped consider_building");
  });

  it("keeps consider_building when no docs page contradicts it", () => {
    const verified = verifyAgainstDocs(
      analysis({
        actions: [
          { type: "consider_building", detail: "PostHog has no phone support product at all." },
        ],
      }),
      [replay],
    );
    expect(verified.analysis.actions[0]?.type).toBe("consider_building");
  });

  it("gives a gap claim the docs page it should have cited", () => {
    const verified = verifyAgainstDocs(
      analysis({
        actions: [
          {
            type: "consider_enhancing",
            feature: "Experiments",
            detail: "PostHog experiments have no end time, so someone stops them by hand.",
          },
        ],
      }),
      [experimentLifecycle],
    );

    expect(verified.analysis.posthogRefs).toEqual([
      {
        url: experimentLifecycle.url,
        claim: "You launch an experiment by hand and stop it by hand when it has enough data.",
      },
    ]);
    expect(verified.notes.join(" ")).toContain("gap claim that named no docs page");
  });

  it("does not cite the same page twice when the model already cited it", () => {
    const verified = verifyAgainstDocs(
      analysis({
        actions: [
          {
            type: "consider_enhancing",
            feature: "Experiments",
            detail: "PostHog experiments have no end time.",
          },
        ],
        posthogRefs: [{ url: experimentLifecycle.url, claim: "Stopping is manual." }],
      }),
      [experimentLifecycle],
    );

    expect(verified.analysis.posthogRefs).toHaveLength(1);
    expect(verified.notes).toEqual([]);
  });

  it("flags a gap claim no docs page in context can settle", () => {
    const verified = verifyAgainstDocs(
      analysis({
        actions: [
          {
            type: "consider_enhancing",
            feature: "Experiments",
            detail: "PostHog cannot schedule an experiment stop.",
          },
        ],
      }),
      [],
    );

    expect(verified.analysis.openQuestions).toHaveLength(1);
    expect(verified.analysis.openQuestions[0]).toContain("no PostHog docs page in context");
    expect(verified.analysis.openQuestions[0]).toContain("Experiments");
    // It goes under "Open questions", so it asks one.
    expect(verified.analysis.openQuestions[0]).toMatch(/^Does PostHog already do this\?/);
  });

  it("respects the three-question ceiling rather than pushing a fourth", () => {
    const verified = verifyAgainstDocs(
      analysis({
        actions: [
          { type: "consider_enhancing", feature: "Experiments", detail: "PostHog cannot do this." },
        ],
        openQuestions: ["a", "b", "c"],
      }),
      [],
    );
    expect(verified.analysis.openQuestions).toEqual(["a", "b", "c"]);
  });

  it("leaves an honest verdict exactly as the model wrote it", () => {
    const honest = analysis({
      actions: [
        {
          type: "consider_enhancing",
          feature: "Experiments",
          detail:
            "PostHog schedules flag changes but not an experiment stop. Feature flags take a date, and an experiment still has to be stopped by hand, so the gap is an end time on the experiment itself.",
        },
      ],
      posthogRefs: [
        { url: flagScheduling.url, claim: "Flags take a scheduled change." },
        { url: experimentLifecycle.url, claim: "Experiments stop by hand." },
      ],
    });

    const verified = verifyAgainstDocs(honest, [flagScheduling, experimentLifecycle]);

    expect(verified.analysis).toEqual(honest);
    expect(verified.notes).toEqual([]);
  });

  it("names the feature to enhance when the model left it blank", () => {
    const verified = verifyAgainstDocs(
      analysis({
        actions: [
          { type: "consider_enhancing", detail: "Add an end time to a running experiment." },
        ],
      }),
      [experimentLifecycle],
    );
    expect(verified.analysis.actions[0]?.feature).toBe("Experiments");
  });

  it("does not touch an action that recommends fixing a page", () => {
    const pageFix = analysis({
      actions: [
        {
          type: "update_pages",
          detail: "The Amplitude comparison page still says neither tool schedules a stop.",
        },
      ],
    });
    expect(verifyAgainstDocs(pageFix, [flagScheduling]).analysis).toEqual(pageFix);
  });
});
