import { describe, expect, it } from "vitest";
import {
  countUpdatePages,
  isExactRewrite,
  repeatsCurrentCopy,
  rewriteForAction,
  rewriteProblem,
} from "../src/analysis/rewrite.js";
import type { Analysis, PostHogRef, RecommendedAction } from "../src/types.js";

/** Copy as it would sit on a compare page: a claim, in PostHog's voice. */
const GOOD =
  "Amplitude schedules an experiment to stop on a date you pick. PostHog experiments stop when you stop them, so a fixed-length test needs someone to end it.";

describe("rewriteProblem", () => {
  it("accepts copy a person could paste onto the page", () => {
    expect(rewriteProblem(GOOD)).toBeNull();
    expect(isExactRewrite(GOOD)).toBe(true);
  });

  it("rejects nothing at all, which is the common failure", () => {
    expect(rewriteProblem(undefined)).toContain("no replacement copy");
    expect(rewriteProblem("   ")).toContain("no replacement copy");
  });

  it("rejects a fragment too short to replace a paragraph", () => {
    expect(rewriteProblem("Amplitude schedules stops.")).toContain("too short");
  });

  it("rejects an instruction to whoever opens the issue", () => {
    for (const instruction of [
      "Mention that Amplitude can now schedule an experiment stop on a date you choose.",
      "Update the pricing section to say Amplitude schedules experiment stops now.",
      "Please add a line saying Amplitude schedules an experiment stop from settings.",
      "Reword the comparison so it does not claim Amplitude stops experiments by hand.",
    ]) {
      expect(rewriteProblem(instruction)).toContain("an instruction rather than the words");
    }
  });

  it("rejects copy that talks about the page it is meant to be on", () => {
    for (const meta of [
      "PostHog stops experiments by hand, and this page should say so in the matrix row.",
      "The comparison table currently claims Amplitude has no scheduling, which is wrong now.",
      "Amplitude schedules experiment stops, so the paragraph about manual stops is out of date.",
    ]) {
      expect(rewriteProblem(meta)).toContain("describes the edit rather than being it");
    }
  });

  it("rejects the marketing voice the style guide rules out", () => {
    expect(
      rewriteProblem(
        "PostHog gives you a seamless experimentation workflow that unlocks insight across every team.",
      ),
    ).toContain("marketing filler");
  });

  it("keeps words that have an honest use, so real copy is not blocked on a lint", () => {
    // "just" and "clearly" are handbook slips, not evidence the model wrote an
    // instruction, so the prompt owns them and the gate does not.
    expect(
      rewriteProblem(
        "Amplitude schedules an experiment stop, so a test that runs just two weeks ends on its own.",
      ),
    ).toBeNull();
  });
});

describe("repeatsCurrentCopy", () => {
  const ref = (proposedText: string): PostHogRef => ({
    url: "https://posthog.com/compare/amplitude-vs-posthog",
    claim: "Neither tool can schedule an experiment to stop on a date you pick.",
    proposedText,
  });

  it("catches a rewrite that puts back what is already there", () => {
    expect(
      repeatsCurrentCopy(ref("Neither tool can schedule an experiment to stop on a date you pick")),
    ).toBe(true);
  });

  it("leaves a rewrite that actually changes the claim", () => {
    expect(repeatsCurrentCopy(ref(GOOD))).toBe(false);
  });
});

describe("rewriteForAction", () => {
  const action: RecommendedAction = {
    type: "update_pages",
    detail: "On the Amplitude compare page, say Amplitude schedules an experiment stop.",
  };

  const analysis = (refs: PostHogRef[], actions: RecommendedAction[] = [action]): Analysis => ({
    impact: "notable",
    summary: "Amplitude shipped a scheduled experiment stop.",
    keyPoints: [],
    actions,
    posthogRefs: refs,
    openQuestions: [],
  });

  const compareRef: PostHogRef = {
    url: "https://posthog.com/compare/amplitude-vs-posthog",
    claim: "Neither tool can schedule an experiment to stop.",
    proposedText: GOOD,
  };

  it("finds the rewrite for the page the action is fixing", () => {
    expect(rewriteForAction(analysis([compareRef]), action)?.proposedText).toBe(GOOD);
  });

  it("ignores a rewrite attached to a docs page, which nobody edits", () => {
    const docs: PostHogRef = {
      url: "https://posthog.com/docs/experiments/managing-lifecycle",
      claim: "You stop an experiment by clicking complete.",
      proposedText: GOOD,
    };
    expect(rewriteForAction(analysis([docs]), action)).toBeNull();
  });

  it("holds back when two page edits share one list of refs", () => {
    // Refs hang off the analysis, not the action, so with two of them there is
    // no telling whose copy this is. Slack gets the sentence and no preview.
    const two = analysis([compareRef], [action, { ...action, detail: "Another page edit." }]);
    expect(rewriteForAction(two, action)).toBeNull();
    expect(countUpdatePages(two)).toBe(2);
  });

  it("has nothing to show for the other action types", () => {
    const enhance: RecommendedAction = {
      type: "consider_enhancing",
      feature: "Experiments",
      detail: "Add a scheduled end time on experiments.",
    };
    expect(rewriteForAction(analysis([compareRef], [enhance]), enhance)).toBeNull();
  });
});
