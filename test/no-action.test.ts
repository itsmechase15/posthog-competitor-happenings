import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_NO_ACTION_LINKS,
  noActionOf,
  noActionTitle,
  renderNoAction,
  shapeNoAction,
  trimNotAGapReason,
  UNSTATED_NO_ACTION_REASON,
  withNoAction,
} from "../src/analysis/noAction.js";
import { parseAnalysis } from "../src/analysis/schema.js";
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
 * The shape a "not a product gap" note has: what the piece is, and that it is
 * not an announcement. The flourish about PostHog's product that used to close
 * it – "nothing here asks anything of PostHog's product", "PostHog's
 * Experiments product has nothing to answer" – says the same thing a second
 * time in a company's voice, so it is cut, and only where a sentence survives
 * the cut.
 */
describe("trimNotAGapReason", () => {
  it("cuts the flourish off the Amplitude SDK note and keeps what the piece is", () => {
    expect(
      trimNotAGapReason(
        "This is a thought-leadership post making the case for installing Amplitude's SDK over warehouse-only ingestion, so no capability shipped and nothing here asks anything of PostHog's product.",
      ),
    ).toBe(
      "This is a thought-leadership post making the case for installing Amplitude's SDK over warehouse-only ingestion, so no capability shipped.",
    );
  });

  it("cuts the product flourish off the Mixpanel event write-up note", () => {
    expect(
      trimNotAGapReason(
        "No capability shipped here – this is an event write-up and thought leadership about experimentation practice, so PostHog's Experiments product has nothing to answer.",
      ),
    ).toBe(
      "No capability shipped here – this is an event write-up and thought leadership about experimentation practice.",
    );
  });

  it("drops a sentence that is nothing but the flourish", () => {
    expect(
      trimNotAGapReason(
        "This is a thought leadership article about SDK versus warehouse ingestion. It's not an announcement of a new feature or product. No impact on current PostHog products.",
      ),
    ).toBe(
      "This is a thought leadership article about SDK versus warehouse ingestion. It's not an announcement of a new feature or product.",
    );
  });

  it("leaves the shape Chase asked for exactly as written", () => {
    const good =
      "This is a thought leadership article about whether to install Amplitude's SDK or send events from a warehouse. It's not an announcement of a new feature or product.";
    expect(trimNotAGapReason(good)).toBe(good);
  });

  it("leaves a sentence alone when the flourish is in the middle of it, rather than rewrite it", () => {
    const middle =
      "Nothing here asks anything of PostHog's product because the post is a recap of their conference talks.";
    expect(trimNotAGapReason(middle)).toBe(middle);
  });

  it("never empties a reason", () => {
    expect(trimNotAGapReason("No impact on current PostHog products.")).toBe(
      "No impact on current PostHog products.",
    );
  });

  it("only shapes the analyst's own not-a-gap, and only when there is something to cut", () => {
    expect(shapeNoAction(covered)).toBe(covered);
    const plain = { kind: "not_a_gap" as const, reason: "This is a customer story.", evidence: [] };
    expect(shapeNoAction(plain)).toBe(plain);
  });

  it("runs on the way in, so the note Slack shows is the trimmed one", () => {
    const parsed = parseAnalysis(
      JSON.stringify({
        impact: "minor",
        summary: "Amplitude argues for installing its SDK over warehouse-only ingestion.",
        actions: [],
        no_action: {
          kind: "not_a_gap",
          reason:
            "This is a thought leadership article about installing Amplitude's SDK versus sending events from a warehouse, so nothing here asks anything of PostHog's product.",
        },
      }),
    );
    expect(parsed.noAction?.reason).toBe(
      "This is a thought leadership article about installing Amplitude's SDK versus sending events from a warehouse.",
    );
    expect(parsed.noActionReason).toBe(parsed.noAction?.reason);
  });
});

/**
 * The platitudes this feature exists to delete, checked by grep.
 *
 * Each of these was true, said nothing, and read like a bug: a reader who saw
 * one could not tell whether PostHog ships the thing, whether the launch was
 * irrelevant, or whether the run had fallen over. A verdict has a kind, a
 * sentence about this launch, and the pages it rests on, so there is nothing
 * left for a generic line to do. The last three are the flourish a not-a-gap
 * note used to close on, which code must never write either.
 */
describe("no generic no-action copy survives in src/", () => {
  const BANNED = [
    "survived the evidence checks",
    "no reason was recorded",
    "did not say why",
    "No impact on current PostHog products.",
    "product has nothing to answer.",
    "asks anything of PostHog's product.",
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
