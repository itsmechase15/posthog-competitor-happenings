import { describe, expect, it } from "vitest";
import { checkAction, checkAnalysis, type RunContext } from "../src/analysis/analyze.js";
import type { AnalyzerOutput } from "../src/analysis/analyzer.js";
import type { Analysis, PostHogDoc, RecommendedAction, StoredItem } from "../src/types.js";
import { corpus } from "./helpers.js";

/**
 * The whole chain on a hand-written reply, with no model and no network.
 *
 * This is the test that matters most, because it is the mistake the feature
 * exists to stop: a GitHub issue telling PostHog to build something PostHog
 * already ships. Each case is a plausible reply from a good model.
 */

const item: StoredItem = {
  id: "1",
  competitor: "amplitude",
  source: "changelog",
  externalId: "guid-1",
  title: "Schedule experiment stop",
  url: "https://fixture.invalid/releases/schedule-experiment-stop",
  publishedAt: new Date("2026-01-15T00:00:00Z"),
  raw: { body: "You can now pick a date and time for an experiment to stop on its own." },
};

const LIFECYCLE = "https://posthog.com/docs/experiments/managing-lifecycle";
const REPLAY_PRIVACY = "https://posthog.com/docs/session-replay/privacy";
const PROXY = "https://posthog.com/docs/advanced/proxy";

const context: RunContext = {
  index: corpus(
    {
      url: LIFECYCLE,
      title: "Managing the experiment lifecycle",
      text: "Experiments move through draft, running, and complete. You stop an experiment by clicking complete. There is no end date field on an experiment, so stopping is always a manual step.",
    },
    {
      url: REPLAY_PRIVACY,
      title: "Session replay privacy controls",
      text: "Mask every input and all text so a session recording never captures what a person typed. Masking is on by default for password fields, and you can mask any selector you name.",
    },
    {
      url: PROXY,
      title: "Managed reverse proxy",
      text: "PostHog runs a managed reverse proxy on a subdomain you own, so events reach PostHog through your own domain and the certificate is handled for you.",
    },
    {
      url: "https://posthog.com/compare/amplitude-vs-posthog",
      title: "Amplitude vs PostHog",
      kind: "marketing",
      text: "Amplitude cannot schedule an experiment to stop on a date you pick.",
    },
  ),
  workspace: null,
};

function reply(actions: RecommendedAction[], overrides: Partial<Analysis> = {}): AnalyzerOutput {
  return {
    analysis: {
      impact: "notable",
      summary: "Amplitude experiments can now be scheduled to stop on their own.",
      keyPoints: [],
      actions,
      posthogRefs: [],
      openQuestions: [],
      ...overrides,
    },
    readUrls: [],
  };
}

function run(output: AnalyzerOutput, docs: PostHogDoc[] = []): Analysis {
  return checkAnalysis(output, docs, item, context, "claude-opus-5", () => undefined);
}

describe("the chain from a reply to an alert", () => {
  it("keeps a gap read off the page the corpus ranks for it", () => {
    const good: RecommendedAction = {
      type: "consider_enhancing",
      feature: "Experiments",
      detail: "Add a scheduled end time on experiments so a test can stop on its own.",
      gap: "no end date field on an experiment, so stopping is a manual step",
      evidenceUrl: LIFECYCLE,
      evidenceQuote: "There is no end date field on an experiment",
    };

    const analysis = run({ ...reply([good]), readUrls: [LIFECYCLE] });

    expect(analysis.actions.map((action) => action.type)).toEqual(["consider_enhancing"]);
    expect(analysis.pagesRead).toEqual([LIFECYCLE]);
  });

  it("blocks the issue that says build what PostHog already ships", () => {
    // The reply is fluent, the gap is specific, and PostHog has masked inputs
    // by default for years. Nothing but the corpus catches this.
    const wrong: RecommendedAction = {
      type: "consider_building",
      feature: "Session replay",
      detail: "Build input masking for session recordings so nothing typed is ever captured.",
      gap: "no way to mask inputs and text in a session recording",
    };

    const analysis = run(reply([wrong]));

    expect(analysis.actions).toEqual([]);
    expect(analysis.openQuestions.join(" ")).toContain("cites no PostHog docs page");
    expect(analysis.noActionReason).toContain("survived the evidence checks");
  });

  it("blocks a gap whose evidence is real but is about the wrong page", () => {
    const misread: RecommendedAction = {
      type: "consider_building",
      feature: "Managed reverse proxy",
      detail: "Build a managed proxy so events reach PostHog through a customer's own domain.",
      gap: "no managed reverse proxy on a subdomain the customer owns",
      evidenceUrl: LIFECYCLE,
      evidenceQuote: "There is no end date field on an experiment",
    };

    const analysis = run({ ...reply([misread]), readUrls: [LIFECYCLE] });

    expect(analysis.actions).toEqual([]);
    expect(analysis.openQuestions.join(" ")).toContain(PROXY);
  });

  it("keeps an alert that recommends nothing, with the reason it gave", () => {
    const analysis = run(
      reply([], { noActionReason: "PostHog already schedules experiment stops." }),
    );

    expect(analysis.actions).toEqual([]);
    expect(analysis.noActionReason).toBe("PostHog already schedules experiment stops.");
  });

  it("keeps the good action and drops the bad one from the same reply", () => {
    const good: RecommendedAction = {
      type: "consider_enhancing",
      feature: "Experiments",
      detail: "Add a scheduled end time on experiments so a test can stop on its own.",
      gap: "no end date field on an experiment, so stopping is a manual step",
      evidenceUrl: LIFECYCLE,
      evidenceQuote: "There is no end date field on an experiment",
    };
    const padding: RecommendedAction = {
      type: "consider_building",
      detail: "Build something about pricing.",
      gap: "their free tier is more generous than ours",
      evidenceUrl: LIFECYCLE,
      evidenceQuote: "There is no end date field on an experiment",
    };

    const analysis = run({ ...reply([good, padding]), readUrls: [LIFECYCLE] });

    expect(analysis.actions.map((action) => action.type)).toEqual(["consider_enhancing"]);
    expect(analysis.noActionReason).toBeUndefined();
  });

  /**
   * The review pass rewrites one action after its issue is already open, and it
   * earns nothing for having been reviewed: the rewrite goes past the same five
   * checks the original did, or it does not reach the issue at all.
   */
  describe("one action, checked again after the fact", () => {
    const check = (action: RecommendedAction, readUrls: string[] = []) =>
      checkAction({
        analysis: reply([action]).analysis,
        action,
        refs: [],
        impact: "notable",
        docs: [],
        item,
        coverage: { index: context.index, seenUrls: new Set(readUrls) },
        model: "claude-opus-5",
      });

    it("keeps a rewrite that lands on the page the corpus ranks for its gap", () => {
      const rewritten: RecommendedAction = {
        type: "consider_enhancing",
        feature: "Experiments",
        detail: "Add a scheduled end time on experiments so a test can stop on its own.",
        gap: "no end date field on an experiment, so stopping is a manual step",
        evidenceUrl: LIFECYCLE,
        evidenceQuote: "There is no end date field on an experiment",
      };

      const checked = check(rewritten, [LIFECYCLE]);
      expect(checked.action?.evidenceUrl).toBe(LIFECYCLE);
      expect(checked.notes).toEqual([]);
    });

    it("refuses a rewrite whose quote is not on the page it cites", () => {
      const invented: RecommendedAction = {
        type: "consider_enhancing",
        feature: "Experiments",
        detail: "Add a scheduled end time on experiments so a test can stop on its own.",
        gap: "no end date field on an experiment, so stopping is a manual step",
        evidenceUrl: LIFECYCLE,
        evidenceQuote: "Experiments can be scheduled to stop at a time you choose",
      };

      const checked = check(invented, [LIFECYCLE]);
      expect(checked.action).toBeNull();
      expect(checked.notes.join(" ")).toContain("its quote is not on");
    });

    it("refuses a rewrite that moved the gap onto a page nobody read", () => {
      const misread: RecommendedAction = {
        type: "consider_building",
        feature: "Managed reverse proxy",
        detail: "Build a managed proxy so events reach PostHog through a customer's own domain.",
        gap: "no managed reverse proxy on a subdomain the customer owns",
        evidenceUrl: LIFECYCLE,
        evidenceQuote: "There is no end date field on an experiment",
      };

      const checked = check(misread, [LIFECYCLE]);
      expect(checked.action).toBeNull();
      expect(checked.notes.join(" ")).toContain(PROXY);
    });

    it("shapes the surviving rewrite's opening sentence, the same as the first time", () => {
      const backwards: RecommendedAction = {
        type: "consider_enhancing",
        feature: "Experiments",
        detail:
          "PostHog stops an experiment by hand. Add a scheduled end time so a test can stop on its own.",
        gap: "no end date field on an experiment, so stopping is a manual step",
        evidenceUrl: LIFECYCLE,
        evidenceQuote: "There is no end date field on an experiment",
      };

      expect(check(backwards, [LIFECYCLE]).action?.detail).toMatch(/^Close this gap in Experiments/);
    });
  });

  it("opens the action with the work, after the gate has finished dropping things", () => {
    const backwards: RecommendedAction = {
      type: "consider_enhancing",
      feature: "Experiments",
      detail:
        "PostHog stops an experiment by hand. Add a scheduled end time so a test can stop on its own.",
      gap: "no end date field on an experiment, so stopping is a manual step",
      evidenceUrl: LIFECYCLE,
      evidenceQuote: "There is no end date field on an experiment",
    };

    const analysis = run({ ...reply([backwards]), readUrls: [LIFECYCLE] });

    // Slack shows the first sentence and nothing else, so it has to name the
    // work rather than opening with what PostHog lacks.
    expect(analysis.actions[0]?.detail).not.toMatch(/^PostHog stops an experiment by hand/);
    expect(analysis.actions[0]?.detail).toMatch(/^Close this gap in Experiments/);
  });
});
