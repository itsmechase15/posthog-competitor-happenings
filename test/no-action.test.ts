import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_NO_ACTION_LINKS,
  noActionOf,
  noActionTitle,
  renderNoAction,
  UNSTATED_NO_ACTION_REASON,
  withNoAction,
} from "../src/analysis/noAction.js";
import { NO_ACTION_KINDS, type Analysis, type NoAction } from "../src/types.js";

const covered: NoAction = {
  kind: "already_covered",
  reason:
    "Amplitude's scheduled experiment stop matches what PostHog feature flags already do, and an experiment runs on a flag.",
  evidence: [
    {
      url: "https://posthog.com/docs/feature-flags/scheduled-flag-changes",
      title: "Scheduled flag changes",
    },
    {
      url: "https://posthog.com/docs/experiments/managing-lifecycle",
      title: "Managing the experiment lifecycle",
    },
  ],
};

const analysis: Analysis = {
  impact: "notable",
  summary: "Amplitude experiments can now be scheduled to stop on their own.",
  keyPoints: [],
  actions: [],
  posthogRefs: [],
  openQuestions: [],
};

describe("noActionTitle", () => {
  it("names which kind of nothing this is, for every kind", () => {
    for (const kind of NO_ACTION_KINDS) {
      const title = noActionTitle(kind);
      expect(title.startsWith("None")).toBe(true);
      expect(title).not.toBe("None");
    }
  });

  it("writes the dash PostHog writes, with a space either side", () => {
    expect(noActionTitle("already_covered")).toBe("None – PostHog already does this");
    expect(noActionTitle("already_covered")).not.toContain("—");
  });
});

describe("renderNoAction", () => {
  it("leads with the title, then the sentence, then the pages", () => {
    expect(renderNoAction(covered, { flavor: "markdown" })).toBe(
      [
        "**None – PostHog already does this**",
        covered.reason,
        "See: [Scheduled flag changes](https://posthog.com/docs/feature-flags/scheduled-flag-changes), [Managing the experiment lifecycle](https://posthog.com/docs/experiments/managing-lifecycle)",
      ].join("\n"),
    );
  });

  it("writes Slack's own link and bold syntax", () => {
    const rendered = renderNoAction(covered, { flavor: "slack" });
    expect(rendered).toContain("*None – PostHog already does this*");
    expect(rendered).toContain(
      "<https://posthog.com/docs/feature-flags/scheduled-flag-changes|Scheduled flag changes>",
    );
  });

  it("escapes what the surface asks it to escape", () => {
    const rendered = renderNoAction(
      { kind: "not_a_gap", reason: "Pricing <news> & nothing else.", evidence: [] },
      { flavor: "slack", escape: (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;") },
    );
    expect(rendered).toContain("Pricing &lt;news> &amp; nothing else.");
  });

  it("falls back to the page's path when the corpus held no title", () => {
    const rendered = renderNoAction(
      {
        kind: "already_covered",
        reason: "PostHog masks inputs by default.",
        evidence: [{ url: "https://posthog.com/docs/session-replay/privacy" }],
      },
      { flavor: "markdown" },
    );
    expect(rendered).toContain("[the privacy page](https://posthog.com/docs/session-replay/privacy)");
  });

  it("caps the pages, so the block stays an alert rather than a reading list", () => {
    const many: NoAction = {
      kind: "already_covered",
      reason: "PostHog ships all of this.",
      evidence: [1, 2, 3, 4, 5].map((index) => ({
        url: `https://posthog.com/docs/page-${index}`,
        title: `Page ${index}`,
      })),
    };
    const rendered = renderNoAction(many, { flavor: "markdown" });
    expect(rendered.match(/posthog\.com/g)).toHaveLength(MAX_NO_ACTION_LINKS);
  });

  it("leaves the See line off a verdict with no pages under it", () => {
    const rendered = renderNoAction(
      { kind: "not_a_gap", reason: "This post is about a new office.", evidence: [] },
      { flavor: "markdown" },
    );
    expect(rendered).not.toContain("See:");
  });

  it("cuts a reason long enough to break a Slack section", () => {
    const rendered = renderNoAction(
      { kind: "unverified", reason: "word ".repeat(400), evidence: [] },
      { flavor: "slack", maxChars: 600 },
    );
    expect(rendered.length).toBeLessThan(700);
  });
});

describe("noActionOf", () => {
  it("reads the verdict when the analysis carries one", () => {
    expect(noActionOf(withNoAction(analysis, covered)).kind).toBe("already_covered");
  });

  it("reads a row stored as one sentence as a verdict nobody confirmed", () => {
    const stored = { ...analysis, noActionReason: "PostHog already schedules experiment stops." };
    expect(noActionOf(stored)).toEqual({
      kind: "unverified",
      reason: "PostHog already schedules experiment stops.",
      evidence: [],
    });
  });

  it("says which part is missing when there is no verdict at all", () => {
    expect(noActionOf(analysis).reason).toBe(UNSTATED_NO_ACTION_REASON);
  });
});

describe("withNoAction", () => {
  it("writes the sentence next to the structure, so the two cannot disagree", () => {
    const written = withNoAction(analysis, covered);
    expect(written.noAction).toEqual(covered);
    expect(written.noActionReason).toBe(covered.reason);
  });
});

/**
 * The platitudes this feature exists to delete, checked by grep.
 *
 * Each of these was true, said nothing, and read like a bug: a reader who saw
 * one could not tell whether PostHog ships the thing, whether the launch was
 * irrelevant, or whether the run had fallen over. A verdict has a kind, a
 * sentence about this launch, and the pages it rests on, so there is nothing
 * left for a generic line to do.
 */
describe("no generic no-action copy survives in src/", () => {
  const BANNED = [
    "survived the evidence checks",
    "no reason was recorded",
    "did not say why",
  ];

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return path.endsWith(".ts") ? [path] : [];
    });
  }

  for (const phrase of BANNED) {
    it(`says nothing anywhere that reads "${phrase}"`, () => {
      const offenders = sourceFiles("src").filter((path) =>
        readFileSync(path, "utf8").includes(phrase),
      );
      expect(offenders).toEqual([]);
    });
  }
});
