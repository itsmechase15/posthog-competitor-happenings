import { describe, expect, it } from "vitest";
import { asQuestion, asQuestions, isQuestion } from "../src/analysis/questions.js";

/**
 * The section is called "Open questions", so every line in it asks something.
 * The cases here are the shapes a model actually reaches for when it means to
 * ask and writes a note instead.
 */
describe("asQuestion", () => {
  it("leaves a question alone", () => {
    const asked = "Is Headless generally available on every Mixpanel plan, or gated to Enterprise?";
    expect(asQuestion(asked)).toBe(asked);
  });

  it("turns a whether-note into the question it was standing in for", () => {
    expect(asQuestion("Whether Headless is generally available on every Mixpanel plan.")).toBe(
      "Is Headless generally available on every Mixpanel plan?",
    );
    expect(asQuestion("Whether the compare page can carry this.")).toBe(
      "Can the compare page carry this?",
    );
  });

  it("asks about a clause with no verb to move, rather than inventing one", () => {
    expect(
      asQuestion("Whether PostHog users writing agent code want a typed Python client"),
    ).toBe("Do we know whether PostHog users writing agent code want a typed Python client?");
  });

  it("reads the hedge in front of a whether-note as part of it", () => {
    expect(asQuestion("It is unclear whether the SDK is available on Python 3.9.")).toBe(
      "Is the SDK available on Python 3.9?",
    );
  });

  it("turns a plain statement into a question about itself", () => {
    expect(asQuestion("The compare page is stale on this.")).toBe(
      "Is the compare page stale on this?",
    );
    expect(asQuestion("PostHog docs do not cover agent SDKs.")).toBe(
      "Do PostHog docs not cover agent SDKs?",
    );
  });

  it("asks about a statement it cannot invert, rather than shipping it as a statement", () => {
    expect(asQuestion("No PostHog docs page confirmed the gap.")).toBe(
      "Can someone check: no PostHog docs page confirmed the gap?",
    );
  });

  it("leaves a subordinate clause's verb where it is", () => {
    // Inverting on "is" here would ask about a sentence nobody wrote.
    expect(asQuestion("Whether the page that is linked covers this")).toBe(
      "Do we know whether the page that is linked covers this?",
    );
  });

  it("asks about a noun phrase, and punctuates a question that only lost its mark", () => {
    expect(asQuestion("What Mixpanel charges for Headless")).toBe(
      "Do we know what Mixpanel charges for Headless?",
    );
    expect(asQuestion("What does Mixpanel charge for Headless")).toBe(
      "What does Mixpanel charge for Headless?",
    );
  });

  it("keeps the context a question came with, after the question", () => {
    const withContext =
      "Does this change anything the best amplitude alternatives page says? Nobody has checked: https://posthog.com/compare/x.";
    expect(asQuestion(withContext)).toBe(withContext);
  });

  it("puts a buried question in front of its own context", () => {
    expect(
      asQuestion("The docs are quiet on this. Does PostHog ship it under another name?"),
    ).toBe("Does PostHog ship it under another name? The docs are quiet on this.");
  });

  it("drops a fragment that is asking nothing", () => {
    expect(asQuestion("q")).toBeNull();
    expect(asQuestion("   ")).toBeNull();
  });
});

describe("asQuestions", () => {
  it("shapes every entry and keeps each one once", () => {
    const questions = asQuestions([
      "Whether Headless is generally available.",
      "Whether Headless is generally available.",
      "Is Headless priced per seat?",
      "",
    ]);
    expect(questions).toEqual([
      "Is Headless generally available?",
      "Is Headless priced per seat?",
    ]);
    for (const question of questions) expect(isQuestion(question)).toBe(true);
  });
});
