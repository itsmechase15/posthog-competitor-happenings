import { describe, expect, it } from "vitest";
import { enforceActionLead } from "../src/analysis/lead.js";
import type { Analysis, RecommendedAction } from "../src/types.js";
import { firstSentence } from "../src/util/text.js";

const base: Analysis = {
  impact: "notable",
  summary: "Amplitude experiments can now be scheduled to stop on their own.",
  keyPoints: ["Set a start time, an end time, or both."],
  actions: [],
  posthogRefs: [
    {
      url: "https://posthog.com/compare/best-amplitude-alternatives",
      claim: "Both tools require manual experiment management.",
      suggestedEdit: "Say Amplitude can schedule an experiment stop, and PostHog stops by hand.",
    },
  ],
  openQuestions: [],
};

/** What Slack shows under the bold action title, and nothing more. */
function slackLine(analysis: Analysis, index = 0): string {
  return firstSentence((analysis.actions[index] as RecommendedAction).detail, 150);
}

function withAction(action: RecommendedAction, overrides: Partial<Analysis> = {}): Analysis {
  return { ...base, actions: [action], ...overrides };
}

describe("enforceActionLead", () => {
  it("leaves a consider_enhancing that already leads with the change alone", () => {
    const good =
      "Add a scheduled end time on experiments so a test can stop on its own \u2013 flags already schedule changes, experiments stop by hand.";
    const { analysis, notes } = enforceActionLead(
      withAction({ type: "consider_enhancing", feature: "Experiments", detail: good }),
    );

    expect(slackLine(analysis)).toBe(good);
    expect(notes).toEqual([]);
  });

  it("puts the ask in front of a consider_enhancing that only states the gap", () => {
    const bad = "PostHog schedules flag changes, but an experiment still has to be stopped by hand.";
    const { analysis, notes } = enforceActionLead(
      withAction({ type: "consider_enhancing", feature: "Experiments", detail: bad }),
    );

    expect(slackLine(analysis)).toBe(`Close this gap in Experiments: ${bad}`);
    // The gap is evidence, so it is kept, not replaced.
    expect(analysis.actions[0]?.detail).toContain(bad);
    expect(notes).toHaveLength(1);
  });

  it("names the product from the action's own words when it has no feature", () => {
    const { analysis } = enforceActionLead(
      withAction({
        type: "consider_enhancing",
        detail: "PostHog session replay has no way to jump to a rage click.",
      }),
    );
    expect(slackLine(analysis)).toContain("Close this gap in Session replay:");
  });

  it("asks for the build first when PostHog has nothing in the area", () => {
    const { analysis } = enforceActionLead(
      withAction({
        type: "consider_building",
        detail: "PostHog has nothing like a warehouse-native audience builder.",
      }),
    );
    expect(slackLine(analysis)).toBe(
      "Build this into PostHog: PostHog has nothing like a warehouse-native audience builder.",
    );
  });

  it("leaves an update_pages that names its page alone", () => {
    const good =
      "On the best amplitude alternatives page, say Amplitude can now schedule an experiment stop.";
    const { analysis, notes } = enforceActionLead(
      withAction({ type: "update_pages", detail: good }),
    );

    expect(slackLine(analysis)).toBe(good);
    expect(notes).toEqual([]);
  });

  it("leads with the cited page when the sentence says only that a page is wrong", () => {
    const { analysis, notes } = enforceActionLead(
      withAction({ type: "update_pages", detail: "The compare page is out of date." }),
    );

    expect(slackLine(analysis)).toBe(
      "On the best amplitude alternatives page: Say Amplitude can schedule an experiment stop, and PostHog stops by hand.",
    );
    expect(analysis.actions[0]?.detail).toContain("The compare page is out of date.");
    expect(notes[0]).toContain("https://posthog.com/compare/best-amplitude-alternatives");
  });

  it("keeps the model's own words when the cited page suggests no edit", () => {
    const { analysis } = enforceActionLead(
      withAction(
        { type: "new_compare_page", detail: "There is nowhere to send someone who asks." },
        {
          posthogRefs: [
            {
              url: "https://posthog.com/compare/best-amplitude-alternatives",
              claim: "Both tools require manual experiment management.",
            },
          ],
        },
      ),
    );
    expect(slackLine(analysis)).toBe(
      "On the best amplitude alternatives page: There is nowhere to send someone who asks.",
    );
  });

  it("never opens a page action on a docs URL, which is evidence not a target", () => {
    const { analysis, notes } = enforceActionLead(
      withAction(
        { type: "update_pages", detail: "The compare page is out of date." },
        {
          posthogRefs: [
            {
              url: "https://posthog.com/docs/experiments/managing-lifecycle",
              claim: "Experiments stop by hand.",
              suggestedEdit: "Mention scheduled stops.",
            },
            {
              url: "https://posthog.com/compare/best-amplitude-alternatives",
              claim: "Both tools require manual experiment management.",
            },
          ],
        },
      ),
    );

    expect(slackLine(analysis)).toBe(
      "On the best amplitude alternatives page: The compare page is out of date.",
    );
    expect(notes[0]).toContain("https://posthog.com/compare/best-amplitude-alternatives");
  });

  it("leaves a page action alone when the only page cited is a docs page", () => {
    const detail = "The compare page is out of date.";
    const { analysis, notes } = enforceActionLead(
      withAction(
        { type: "update_pages", detail },
        {
          posthogRefs: [
            {
              url: "https://posthog.com/docs/experiments/managing-lifecycle",
              claim: "Experiments stop by hand.",
              suggestedEdit: "Mention scheduled stops.",
            },
          ],
        },
      ),
    );

    expect(analysis.actions[0]?.detail).toBe(detail);
    expect(notes).toEqual([]);
  });

  it("leaves a page action alone when there is no page to name it with", () => {
    const detail = "The compare page is out of date.";
    const { analysis, notes } = enforceActionLead(
      withAction({ type: "update_pages", detail }, { posthogRefs: [] }),
    );

    expect(analysis.actions[0]?.detail).toBe(detail);
    expect(notes).toEqual([]);
  });

  it("keeps every action, in order", () => {
    const { analysis } = enforceActionLead({
      ...base,
      actions: [
        { type: "update_pages", detail: "The compare page is out of date." },
        {
          type: "consider_enhancing",
          feature: "Experiments",
          detail: "PostHog experiments stop by hand.",
        },
      ],
    });
    expect(analysis.actions.map((action) => action.type)).toEqual([
      "update_pages",
      "consider_enhancing",
    ]);
    expect(slackLine(analysis, 1)).toContain("Close this gap in Experiments:");
  });
});
