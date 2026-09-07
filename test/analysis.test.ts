import { describe, expect, it } from "vitest";
import { diversifyClaims } from "../src/analysis/analyze.js";
import { heuristicAnalysis } from "../src/analysis/fallback.js";
import { buildAnalysisPrompt } from "../src/analysis/prompt.js";
import type { PostHogClaim } from "../src/types.js";
import { extractJsonObject, parseAnalysis, parseStoredAlert } from "../src/analysis/schema.js";
import type { StoredItem } from "../src/types.js";

const valid = {
  impact: "notable",
  summary: "Fixture Co shipped scheduled widget sync.",
  key_points: ["Syncs run on a cron the user picks."],
  action: "update_pages",
  action_detail: "PostHog has no scheduled sync; the compare page still says neither tool does.",
  posthog_refs: [
    {
      url: "https://posthog.com/compare/best-mixpanel-alternatives",
      claim: "Neither tool syncs on a schedule.",
      suggested_edit: "Drop the claim; Mixpanel now schedules syncs.",
    },
  ],
  open_questions: ["Is it available on the free plan?"],
};

describe("extractJsonObject", () => {
  it("pulls JSON out of a fenced block", () => {
    const raw = "Here you go:\n```json\n{\"a\": 1}\n```\nHope that helps.";
    expect(extractJsonObject(raw)).toBe('{"a": 1}');
  });

  it("pulls JSON out of surrounding prose", () => {
    expect(extractJsonObject('Sure. {"a": {"b": 2}} done')).toBe('{"a": {"b": 2}}');
  });

  it("does not stop at a brace inside a string", () => {
    expect(extractJsonObject('{"a": "}"}')).toBe('{"a": "}"}');
  });

  it("throws when there is no object", () => {
    expect(() => extractJsonObject("no json here")).toThrow(/no JSON object/);
  });
});

describe("parseAnalysis", () => {
  it("parses a well-formed response", () => {
    const analysis = parseAnalysis(JSON.stringify(valid));
    expect(analysis.impact).toBe("notable");
    expect(analysis.action).toBe("update_pages");
    expect(analysis.keyPoints).toEqual(["Syncs run on a cron the user picks."]);
    expect(analysis.openQuestions).toEqual(["Is it available on the free plan?"]);
    expect(analysis.posthogRefs[0]?.suggestedEdit).toBe(
      "Drop the claim; Mixpanel now schedules syncs.",
    );
  });

  it("accepts camelCase keys", () => {
    const analysis = parseAnalysis(
      JSON.stringify({
        impact: "minor",
        summary: "s",
        keyPoints: ["k"],
        action: "consider_building",
        actionDetail: "d",
        posthogRefs: [{ url: "u", claim: "c", suggestedEdit: "e" }],
        openQuestions: ["q"],
      }),
    );
    expect(analysis.actionDetail).toBe("d");
    expect(analysis.keyPoints).toEqual(["k"]);
    expect(analysis.openQuestions).toEqual(["q"]);
    expect(analysis.posthogRefs[0]?.suggestedEdit).toBe("e");
  });

  it("reads a legacy severity field as its impact level", () => {
    const legacy = { ...valid, severity: "major" } as Record<string, unknown>;
    delete legacy.impact;
    expect(parseAnalysis(JSON.stringify(legacy)).impact).toBe("major");
    expect(parseAnalysis(JSON.stringify({ ...legacy, severity: "notable" })).impact).toBe("notable");
    expect(parseAnalysis(JSON.stringify({ ...legacy, severity: "minor" })).impact).toBe("minor");
  });

  it("maps a low/medium/high reply back onto the impact scale", () => {
    for (const [token, expected] of [
      ["low", "minor"],
      ["medium", "notable"],
      ["high", "major"],
    ] as const) {
      expect(parseAnalysis(JSON.stringify({ ...valid, impact: token })).impact).toBe(expected);
      expect(
        parseAnalysis(JSON.stringify({ ...valid, impact: undefined, severity: token })).impact,
      ).toBe(expected);
    }
  });

  it("prefers impact when a reply sends both", () => {
    expect(parseAnalysis(JSON.stringify({ ...valid, severity: "minor" })).impact).toBe("notable");
  });

  it("rejects a response with neither impact nor severity", () => {
    const { impact, ...withoutImpact } = valid;
    expect(() => parseAnalysis(JSON.stringify(withoutImpact))).toThrow(/impact/);
  });

  it("defaults the optional lists to empty arrays", () => {
    const { posthog_refs, key_points, open_questions, ...bare } = valid;
    const analysis = parseAnalysis(JSON.stringify(bare));
    expect(analysis.posthogRefs).toEqual([]);
    expect(analysis.keyPoints).toEqual([]);
    expect(analysis.openQuestions).toEqual([]);
  });

  it("rejects an action outside the allowed set", () => {
    expect(() => parseAnalysis(JSON.stringify({ ...valid, action: "do_nothing" }))).toThrow();
  });

  it("rejects a response with no action_detail", () => {
    const { action_detail, ...withoutDetail } = valid;
    expect(() => parseAnalysis(JSON.stringify(withoutDetail))).toThrow(/action_detail/);
  });
});

describe("parseStoredAlert", () => {
  it("reads back the image and issue stored with an analysis", () => {
    const stored = parseStoredAlert({
      ...valid,
      image: { url: "https://cdn.invalid/a.png", altText: "alt", origin: "page" },
      issue: { url: "https://github.com/o/r/issues/3", number: 3 },
    });
    expect(stored.image?.url).toBe("https://cdn.invalid/a.png");
    expect(stored.issue?.number).toBe(3);
    expect(stored.analysis.impact).toBe("notable");
  });

  it("reads a phase 1 row that has neither", () => {
    const stored = parseStoredAlert({ ...valid, impact: undefined, severity: "minor" });
    expect(stored.image).toBeNull();
    expect(stored.issue).toBeNull();
    expect(stored.analysis.impact).toBe("minor");
  });

  it("reads a row stored on the low/medium/high scale", () => {
    expect(parseStoredAlert({ ...valid, impact: "high" }).analysis.impact).toBe("major");
  });
});

const item: StoredItem = {
  id: "1",
  competitor: "mixpanel",
  source: "changelog",
  externalId: "x",
  title: "Widget Sync",
  url: "https://fixture.invalid/changelogs#1",
  publishedAt: new Date("2026-01-15T00:00:00Z"),
  raw: { body: "Introducing Widget Sync. It copies widgets on a schedule." },
};

describe("heuristicAnalysis", () => {
  it("cites an indexed page and asks for a check when one exists", () => {
    const analysis = heuristicAnalysis(item, [
      {
        url: "https://posthog.com/compare/best-mixpanel-alternatives",
        competitor: "mixpanel",
        paragraph: "PostHog and Mixpanel both offer product analytics.",
        heading: null,
      },
    ]);
    expect(analysis.action).toBe("update_pages");
    expect(analysis.posthogRefs).toHaveLength(1);
    expect(analysis.actionDetail).toContain("No model analysis ran");
  });

  it("falls back to consider_enhancing when nothing is indexed", () => {
    expect(heuristicAnalysis(item, []).action).toBe("consider_enhancing");
  });

  it("restates the source rather than inventing an assessment", () => {
    const analysis = heuristicAnalysis(item, []);
    expect(analysis.summary).toContain("Introducing Widget Sync");
    expect(analysis.impact).toBe("notable");
  });

  it("keeps the summary to one sentence and puts the rest in key points", () => {
    const analysis = heuristicAnalysis(item, []);
    expect(analysis.summary).toBe("Mixpanel: Introducing Widget Sync.");
    expect(analysis.keyPoints).toEqual(["It copies widgets on a schedule."]);
  });

  it("drops a leading changelog label so Slack does not read 'Description:'", () => {
    const analysis = heuristicAnalysis(
      { ...item, raw: { body: "Description: You can now schedule when an experiment stops." } },
      [],
    );
    expect(analysis.summary).toBe(
      "Mixpanel: You can now schedule when an experiment stops.",
    );
  });

  it("prefers the page's own description over its first paragraph", () => {
    const analysis = heuristicAnalysis(
      { ...item, raw: { ...item.raw, description: "A one-line summary of the post." } },
      [],
    );
    expect(analysis.summary).toBe("Mixpanel: A one-line summary of the post.");
  });

  it("cites at most one claim per page", () => {
    const claim = (url: string, paragraph: string): PostHogClaim => ({
      url,
      competitor: "mixpanel",
      paragraph,
      heading: null,
    });
    const analysis = heuristicAnalysis(item, [
      claim("https://posthog.com/compare/a", "first"),
      claim("https://posthog.com/compare/a", "second"),
      claim("https://posthog.com/docs/b", "third"),
    ]);
    expect(analysis.posthogRefs.map((ref) => ref.url)).toEqual([
      "https://posthog.com/compare/a",
      "https://posthog.com/docs/b",
    ]);
  });
});

describe("diversifyClaims", () => {
  const claims: PostHogClaim[] = [
    { url: "a", competitor: "mixpanel", paragraph: "1", heading: null },
    { url: "a", competitor: "mixpanel", paragraph: "2", heading: null },
    { url: "a", competitor: "mixpanel", paragraph: "3", heading: null },
    { url: "b", competitor: "mixpanel", paragraph: "4", heading: null },
  ];

  it("stops one page from crowding out the rest", () => {
    expect(diversifyClaims(claims, 4).map((claim) => claim.paragraph)).toEqual(["1", "2", "4"]);
  });

  it("respects the overall limit", () => {
    expect(diversifyClaims(claims, 2)).toHaveLength(2);
  });
});

describe("buildAnalysisPrompt", () => {
  const withRefs = buildAnalysisPrompt(item, [
    {
      url: "https://posthog.com/compare/best-mixpanel-alternatives",
      competitor: "mixpanel",
      paragraph: "PostHog and Mixpanel both offer product analytics.",
      heading: "Overview",
    },
  ]);

  it("gives the model only the claims it may cite", () => {
    expect(withRefs).toContain("https://posthog.com/compare/best-mixpanel-alternatives");
    expect(withRefs).toContain('section "Overview"');
    expect(withRefs).toContain("Only cite URLs given to you");
  });

  it("says so when nothing is indexed, rather than leaving a blank section", () => {
    expect(buildAnalysisPrompt(item, [])).toContain("no indexed PostHog.com pages mention");
  });

  it("asks for the four allowed actions and nothing else", () => {
    for (const action of [
      "update_pages",
      "new_compare_page",
      "consider_building",
      "consider_enhancing",
    ]) {
      expect(withRefs).toContain(action);
    }
  });

  it("asks for the fields the new Slack layout needs, in impact terms", () => {
    for (const field of ["impact", "key_points", "open_questions", "one sentence"]) {
      expect(withRefs).toContain(field);
    }
    expect(withRefs).not.toContain("severity");
  });

  it("asks for the minor/notable/major scale, not low/medium/high", () => {
    expect(withRefs).toContain('"minor" | "notable" | "major"');
    expect(withRefs).not.toContain('"low" | "medium" | "high"');
  });
});
