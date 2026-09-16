import { describe, expect, it } from "vitest";
import {
  analyzeItems,
  createFallbackAnalyzer,
  type RunContext,
} from "../src/analysis/analyze.js";
import type { Analyzer } from "../src/analysis/analyzer.js";
import {
  describeTopic,
  enforcePageTargets,
  enforceUpdatePagesTopic,
  signalTopic,
  tiesToTopic,
} from "../src/analysis/relevance.js";
import type { Config } from "../src/config.js";
import { MemoryStore } from "../src/db/memory.js";
import { docUrlsForText } from "../src/posthog/products.js";
import type { Analysis, RecommendedAction, StoredItem } from "../src/types.js";
import { titleFromUrl } from "../src/util/text.js";
import { corpus } from "./helpers.js";

const scheduleStop: StoredItem = {
  id: "1",
  competitor: "amplitude",
  source: "changelog",
  externalId: "schedule-experiment-stop",
  title: "Schedule experiment stop",
  url: "https://amplitude.com/releases/schedule-experiment-stop",
  publishedAt: new Date("2026-09-01T00:00:00Z"),
  raw: { body: "Pick an end date when you start an experiment and it stops itself." },
};

const enhanceExperiments: RecommendedAction = {
  type: "consider_enhancing",
  feature: "Experiments",
  detail:
    "PostHog schedules flag changes but not an experiment stop, so add an end time to the experiment itself.",
};

function analysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    impact: "notable",
    summary:
      "Amplitude now lets you schedule an experiment to stop automatically on a date you pick.",
    keyPoints: ["Pick the end date when you launch."],
    actions: [],
    posthogRefs: [],
    openQuestions: [],
    ...overrides,
  };
}

function types(result: { analysis: Analysis }): string[] {
  return result.analysis.actions.map((action) => action.type);
}

describe("enforcePageTargets", () => {
  const editDocs = {
    type: "update_pages" as const,
    detail: "On the experiments docs, say an experiment can stop on a schedule.",
  };

  it("drops a page action that only ever wanted a docs page edited", () => {
    const result = enforcePageTargets(
      analysis({
        actions: [editDocs, enhanceExperiments],
        posthogRefs: [
          {
            url: "https://posthog.com/docs/experiments/managing-lifecycle",
            claim: "Experiments are started, paused, and stopped by hand.",
            suggestedEdit: "Mention scheduled stops.",
          },
        ],
      }),
    );

    expect(types(result)).toEqual(["consider_enhancing"]);
    expect(result.notes[0]).toContain("managing-lifecycle");
  });

  it("keeps it when one of the pages it wants edited is marketing's", () => {
    const result = enforcePageTargets(
      analysis({
        actions: [editDocs],
        posthogRefs: [
          {
            url: "https://posthog.com/docs/experiments/managing-lifecycle",
            claim: "Experiments stop by hand.",
            suggestedEdit: "Mention scheduled stops.",
          },
          {
            url: "https://posthog.com/compare/best-amplitude-alternatives",
            claim: "Both tools require manual experiment management.",
            suggestedEdit: "Say Amplitude schedules stops.",
          },
        ],
      }),
    );

    expect(types(result)).toEqual(["update_pages"]);
    expect(result.notes).toEqual([]);
  });

  it("says nothing about an action that suggested no edit at all", () => {
    const result = enforcePageTargets(
      analysis({
        actions: [editDocs],
        posthogRefs: [
          {
            url: "https://posthog.com/docs/experiments",
            claim: "Experiments compare variants.",
          },
        ],
      }),
    );

    expect(types(result)).toEqual(["update_pages"]);
    expect(result.notes).toEqual([]);
  });

  it("leaves an analysis with no page action untouched", () => {
    const result = enforcePageTargets(analysis({ actions: [enhanceExperiments] }));
    expect(types(result)).toEqual(["consider_enhancing"]);
  });
});

describe("signalTopic", () => {
  it("keeps what changed and drops the product it changed in", () => {
    const topic = signalTopic(scheduleStop.title, analysis().summary);
    expect(topic.products).toEqual(["Experiments"]);
    expect(topic.terms).toContain("schedul");
    expect(topic.terms).toContain("stop");
    // Experiments is the area, not the topic: both the launch and the tangent
    // that this guard exists to catch are about experiments.
    expect(topic.terms).not.toContain("experiment");
  });

  it("reads the scheduling capability, so a synonym still counts", () => {
    const topic = signalTopic(scheduleStop.title, analysis().summary);
    expect(topic.phrases).toContain("end date");
    expect(tiesToTopic("The page says an experiment has no end date.", topic)).toBe(true);
  });

  it("matches a word whatever ending the model gave it", () => {
    const topic = signalTopic(scheduleStop.title, analysis().summary);
    for (const text of [
      "PostHog cannot schedule an experiment stop.",
      "Scheduling an experiment stop is not possible in PostHog.",
      "Amplitude scheduled stops land in the compare page.",
      "The page claims nobody stops an experiment on a timer.",
      "The page says an experiment takes no end dates.",
    ]) {
      expect(tiesToTopic(text, topic)).toBe(true);
    }
  });
});

describe("enforceUpdatePagesTopic", () => {
  it("drops the basic A/B tangent the schedule-stop signal did not find", () => {
    const guarded = enforceUpdatePagesTopic(
      analysis({
        actions: [
          enhanceExperiments,
          {
            type: "update_pages",
            detail:
              "On the PostHog versus Amplitude experiments section, answer Amplitude's claim that PostHog only launched basic A/B testing in November 2025.",
          },
        ],
      }),
      scheduleStop,
    );

    expect(types(guarded)).toEqual(["consider_enhancing"]);
    expect(guarded.notes.join(" ")).toContain("dropped an update_pages action");
    expect(guarded.notes.join(" ")).toContain("schedul");
  });

  it("keeps a page edit that answers a false claim about scheduling", () => {
    const kept = analysis({
      actions: [
        {
          type: "update_pages",
          detail:
            "Amplitude's compare page says PostHog cannot schedule an experiment stop, and the PostHog versus Amplitude page does not answer it.",
        },
        enhanceExperiments,
      ],
      posthogRefs: [
        {
          url: "https://posthog.com/compare/amplitude-vs-posthog",
          claim: "Both tools stop an experiment by hand.",
          suggestedEdit: "Say that PostHog schedules flag changes today.",
        },
      ],
    });

    const guarded = enforceUpdatePagesTopic(kept, scheduleStop);
    expect(guarded.analysis).toEqual(kept);
    expect(guarded.notes).toEqual([]);
  });

  it("drops a pricing tangent on the same page", () => {
    const guarded = enforceUpdatePagesTopic(
      analysis({
        actions: [
          {
            type: "update_pages",
            detail:
              "The pricing table on the Amplitude compare page still quotes their old per-seat plan.",
          },
          enhanceExperiments,
        ],
      }),
      scheduleStop,
    );
    expect(types(guarded)).toEqual(["consider_enhancing"]);
  });

  it("reads the suggested edit as part of one page action, not just its detail", () => {
    const guarded = enforceUpdatePagesTopic(
      analysis({
        actions: [
          {
            type: "update_pages",
            detail: "The Amplitude compare page has a line that no longer holds.",
          },
        ],
        posthogRefs: [
          {
            url: "https://posthog.com/compare/amplitude-vs-posthog",
            claim: "Neither tool ends an experiment for you.",
            suggestedEdit:
              "Drop the claim that nobody can schedule a stop, and say what PostHog schedules today.",
          },
        ],
      }),
      scheduleStop,
    );
    expect(types(guarded)).toEqual(["update_pages"]);
  });

  it("leaves an alert with no action when the page edit was all there was", () => {
    const guarded = enforceUpdatePagesTopic(
      analysis({
        actions: [
          {
            type: "update_pages",
            detail: "Add a holdouts row to the experiments feature matrix while you are in there.",
          },
        ],
      }),
      scheduleStop,
    );

    expect(guarded.analysis.actions).toEqual([]);
    expect(guarded.analysis.noAction?.kind).toBe("not_a_gap");
    expect(guarded.analysis.noAction?.reason).toContain("no page to fix");
    expect(guarded.analysis.noAction?.reason).toContain("schedul");
  });

  it("judges only page edits, and leaves the other action types alone", () => {
    const wander = analysis({
      actions: [
        {
          type: "consider_enhancing",
          feature: "Experiments",
          detail: "PostHog's A/B testing statistics could use sequential testing.",
        },
        { type: "new_compare_page", detail: "PostHog has no page on experiment tooling at all." },
      ],
    });
    expect(enforceUpdatePagesTopic(wander, scheduleStop).analysis).toEqual(wander);
  });

  it("falls back to the product when the launch is the product", () => {
    const replayItem: StoredItem = {
      ...scheduleStop,
      competitor: "mixpanel",
      title: "Session replay",
      url: "https://mixpanel.com/blog/session-replay",
    };
    const replay = analysis({ summary: "Mixpanel now ships session replay." });
    const topic = signalTopic(replayItem.title, replay.summary);
    expect(topic.terms).toEqual([]);

    const guarded = enforceUpdatePagesTopic(
      {
        ...replay,
        actions: [
          {
            type: "update_pages",
            detail: "The Mixpanel compare page still says only PostHog has session replay.",
          },
          { type: "update_pages", detail: "The pricing page undersells the free tier." },
        ],
      },
      replayItem,
    );

    expect(types(guarded)).toEqual(["update_pages"]);
    expect(guarded.analysis.actions[0]?.detail).toContain("session replay");
  });

  it("does nothing at all when the model asked for no page edit", () => {
    const noPages = analysis({ actions: [enhanceExperiments] });
    const guarded = enforceUpdatePagesTopic(noPages, scheduleStop);
    expect(guarded.analysis).toBe(noPages);
    expect(guarded.notes).toEqual([]);
  });
});

describe("describeTopic", () => {
  it("names the launch in the words the guard matched on", () => {
    expect(describeTopic(signalTopic(scheduleStop.title, analysis().summary))).toContain("schedul");
  });
});

describe("the guard inside a run", () => {
  const config = {
    skipPosthogIndex: true,
    posthogMaxPages: 0,
    posthogRefreshDays: 14,
    retrievalTopK: 10,
    retrievalPerSection: 4,
    httpTimeoutMs: 1,
    userAgent: "test",
  } as Config;
  const noCompareClaims = { claimsFor: async () => [] };

  /** The corpus this signal would reach for, so the run touches no network. */
  const context: RunContext = {
    index: corpus(
      ...docUrlsForText(`${scheduleStop.title} ${scheduleStop.raw.body as string}`).map((url) => ({
        url,
        title: titleFromUrl(url),
        text: "You stop an experiment by hand. Scheduled flag changes take a date.",
      })),
    ),
    workspace: null,
  };

  function analyzerReturning(result: Analysis): Analyzer {
    return { model: "test-model", analyze: async () => ({ analysis: result, readUrls: [] }) };
  }

  it("keeps a tangent out of the alert the pipeline hands to Slack", async () => {
    const [analyzed] = await analyzeItems(
      [scheduleStop],
      new MemoryStore(),
      analyzerReturning(
        analysis({
          actions: [
            enhanceExperiments,
            {
              type: "update_pages",
              detail:
                "Answer Amplitude's claim that PostHog only launched basic A/B testing in November 2025.",
            },
          ],
        }),
      ),
      config,
      context,
      noCompareClaims,
    );

    // The tangent goes for being off topic, and the enhancement goes for
    // carrying no evidence. Both are blocks, and neither is a rewrite. What is
    // left is a verdict saying which check the last one failed.
    expect(analyzed?.analysis.actions).toEqual([]);
    expect(analyzed?.analysis.noAction?.kind).toBe("unverified");
    expect(analyzed?.analysis.noAction?.reason).toContain("nothing to check");
  });

  it("keeps a page edit that is about the launch and quotes copy the page carries", async () => {
    const compareUrl = "https://posthog.com/compare/amplitude-vs-posthog";
    const withCompare: RunContext = {
      index: corpus({
        url: compareUrl,
        title: "Amplitude vs PostHog",
        kind: "marketing",
        text: "Amplitude cannot schedule an experiment to stop on a date you pick.",
      }),
      workspace: null,
    };

    const [analyzed] = await analyzeItems(
      [scheduleStop],
      new MemoryStore(),
      analyzerReturning(
        analysis({
          actions: [
            {
              type: "update_pages",
              detail: `On ${compareUrl}, say Amplitude can now schedule an experiment stop.`,
            },
          ],
          posthogRefs: [
            {
              url: compareUrl,
              claim: "Amplitude cannot schedule an experiment to stop on a date you pick",
              suggestedEdit: "Say they can now schedule a stop.",
              proposedText:
                "Amplitude schedules an experiment to stop on a date you pick. PostHog experiments stop when you stop them.",
            },
          ],
        }),
      ),
      config,
      withCompare,
      noCompareClaims,
    );

    expect(analyzed?.analysis.actions.map((action) => action.type)).toEqual(["update_pages"]);
  });

  it("lets the heuristic through, because it recommends nothing to judge", async () => {
    const [analyzed] = await analyzeItems(
      [scheduleStop],
      new MemoryStore(),
      createFallbackAnalyzer(),
      config,
      context,
      noCompareClaims,
    );

    expect(analyzed?.analysis.actions).toEqual([]);
    expect(analyzed?.analysis.noActionReason).toContain("No model analysis ran");
  });
});
