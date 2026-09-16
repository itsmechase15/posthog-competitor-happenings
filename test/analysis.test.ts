import { describe, expect, it } from "vitest";
import { diversifyClaims } from "../src/analysis/analyze.js";
import { heuristicAnalysis } from "../src/analysis/fallback.js";
import { buildAnalysisPrompt } from "../src/analysis/prompt.js";
import { MAX_ACTION_CHARS } from "../src/slack/message.js";
import type { PostHogClaim } from "../src/types.js";
import { extractJsonObject, parseAnalysis, parseStoredAlert } from "../src/analysis/schema.js";
import type { StoredItem } from "../src/types.js";

const valid = {
  impact: "notable",
  summary: "Fixture Co shipped scheduled widget sync.",
  key_points: ["Syncs run on a cron the user picks."],
  actions: [
    {
      type: "update_pages",
      detail: "PostHog has no scheduled sync; the compare page still says neither tool does.",
    },
    {
      type: "consider_enhancing",
      feature: "Data pipelines",
      detail: "PostHog pipelines run on ingest, not on a schedule the user picks.",
    },
  ],
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
    expect(analysis.actions.map((action) => action.type)).toEqual([
      "update_pages",
      "consider_enhancing",
    ]);
    expect(analysis.actions[1]?.feature).toBe("Data pipelines");
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
        actions: [{ action: "consider_enhancing", actionDetail: "d", posthogFeature: "Surveys" }],
        posthogRefs: [{ url: "u", claim: "c", suggestedEdit: "e" }],
        openQuestions: ["q"],
      }),
    );
    expect(analysis.actions).toEqual([
      { type: "consider_enhancing", detail: "d", feature: "Surveys" },
    ]);
    expect(analysis.keyPoints).toEqual(["k"]);
    expect(analysis.openQuestions).toEqual(["q"]);
    expect(analysis.posthogRefs[0]?.suggestedEdit).toBe("e");
  });

  it("keeps the small teams a reply names, in either casing", () => {
    const snake = parseAnalysis(
      JSON.stringify({
        ...valid,
        actions: [
          { type: "consider_enhancing", detail: "d", feature: "Experiments", teams: ["Experiments"] },
        ],
      }),
    );
    expect(snake.actions[0]?.teams).toEqual(["Experiments"]);

    const camel = parseAnalysis(
      JSON.stringify({
        impact: "minor",
        summary: "s",
        actions: [{ action: "consider_building", actionDetail: "d", posthogTeams: ["Ingestion", ""] }],
      }),
    );
    expect(camel.actions[0]?.teams).toEqual(["Ingestion"]);
  });

  it("leaves teams off when a reply names none", () => {
    const analysis = parseAnalysis(
      JSON.stringify({ impact: "minor", summary: "s", actions: [{ type: "update_pages", detail: "d", teams: [] }] }),
    );
    expect(analysis.actions[0]).not.toHaveProperty("teams");
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

  it("reads an empty feature as no feature, instead of losing the whole analysis", () => {
    // What a real reply did: the right answer for update_pages is no feature,
    // and the model wrote "feature": "" rather than leaving the key out.
    const analysis = parseAnalysis(
      JSON.stringify({
        ...valid,
        actions: [
          { type: "update_pages", detail: "The compare page is stale.", feature: "" },
          { type: "consider_enhancing", detail: "A real gap.", feature: "Experiments" },
        ],
      }),
    );
    expect(analysis.actions).toEqual([
      { type: "update_pages", detail: "The compare page is stale." },
      { type: "consider_enhancing", detail: "A real gap.", feature: "Experiments" },
    ]);
  });

  it("drops an action whose detail came back empty, and keeps the rest", () => {
    const analysis = parseAnalysis(
      JSON.stringify({
        ...valid,
        actions: [
          { type: "update_pages", detail: "   " },
          { type: "consider_building", detail: "A real gap." },
        ],
      }),
    );
    expect(analysis.actions).toEqual([{ type: "consider_building", detail: "A real gap." }]);
  });

  it("drops blank key points and open questions rather than failing on them", () => {
    const analysis = parseAnalysis(
      JSON.stringify({ ...valid, key_points: ["A point.", "", "  "], open_questions: [""] }),
    );
    expect(analysis.keyPoints).toEqual(["A point."]);
    expect(analysis.openQuestions).toEqual([]);
  });

  it("drops a citation with no page or no claim, and keeps the usable ones", () => {
    const analysis = parseAnalysis(
      JSON.stringify({
        ...valid,
        posthog_refs: [
          { url: "", claim: "Nowhere to read this." },
          { url: "https://posthog.com/docs/experiments", claim: "" },
          { url: "https://posthog.com/docs/experiments", claim: "Experiments stop by hand." },
        ],
      }),
    );
    expect(analysis.posthogRefs).toEqual([
      { url: "https://posthog.com/docs/experiments", claim: "Experiments stop by hand." },
    ]);
  });

  it("reads an empty suggested edit as none", () => {
    const analysis = parseAnalysis(
      JSON.stringify({
        ...valid,
        posthog_refs: [{ url: "u", claim: "c", suggested_edit: "" }],
      }),
    );
    expect(analysis.posthogRefs[0]?.suggestedEdit).toBeUndefined();
  });

  it("rejects an action outside the allowed set", () => {
    expect(() =>
      parseAnalysis(JSON.stringify({ ...valid, actions: [{ type: "do_nothing", detail: "d" }] })),
    ).toThrow();
  });

  it("rejects a reply that never answered the actions field at all", () => {
    // An empty list is an answer. No list is a reply that stopped early, and
    // reading it as "nothing to do" would hide a broken analysis.
    const { actions, ...withoutActions } = valid;
    expect(() => parseAnalysis(JSON.stringify(withoutActions))).toThrow(/actions list/);
  });

  it("reads an entry with no detail as no entry, rather than failing the whole reply", () => {
    const { actions, ...withoutActions } = valid;
    const analysis = parseAnalysis(
      JSON.stringify({ ...withoutActions, actions: [{ type: "update_pages" }] }),
    );
    expect(analysis.actions).toEqual([]);
  });

  it("reads zero actions as an answer, with the reason it gave", () => {
    const analysis = parseAnalysis(
      JSON.stringify({
        ...valid,
        actions: [],
        no_action_reason: "PostHog already ships this, so there is nothing to do.",
      }),
    );

    expect(analysis.actions).toEqual([]);
    expect(analysis.noActionReason).toBe("PostHog already ships this, so there is nothing to do.");
  });

  it("says so when an analysis recommends nothing and does not say why", () => {
    const analysis = parseAnalysis(JSON.stringify({ ...valid, actions: [] }));
    expect(analysis.noActionReason).toContain("did not say why");
  });

  it("keeps a product action's gap, page, and quote", () => {
    const analysis = parseAnalysis(
      JSON.stringify({
        ...valid,
        actions: [
          {
            type: "consider_enhancing",
            detail: "Add a scheduled end time on experiments.",
            feature: "Experiments",
            gap: "no end date field on an experiment",
            evidence_url: "https://posthog.com/docs/experiments/managing-lifecycle",
            evidence_quote: "There is no end date field",
          },
        ],
      }),
    );

    expect(analysis.actions[0]?.gap).toBe("no end date field on an experiment");
    expect(analysis.actions[0]?.evidenceUrl).toBe(
      "https://posthog.com/docs/experiments/managing-lifecycle",
    );
    expect(analysis.actions[0]?.evidenceQuote).toBe("There is no end date field");
  });

  it("leaves a quote's punctuation alone, because it is matched character by character", () => {
    const analysis = parseAnalysis(
      JSON.stringify({
        ...valid,
        actions: [
          {
            type: "consider_building",
            detail: "Build it.",
            gap: "a gap",
            evidence_url: "https://posthog.com/docs/x",
            evidence_quote: "PostHog\u2014unlike others\u2014does not",
          },
        ],
      }),
    );

    // Every other string is punctuated PostHog's way; this one is not, because
    // rewriting the dash would fail the check against the stored page.
    expect(analysis.actions[0]?.evidenceQuote).toContain("\u2014");
    expect(analysis.summary).not.toContain("\u2014");
  });

  it("caps the list at what Slack can render", () => {
    const analysis = parseAnalysis(
      JSON.stringify({
        ...valid,
        actions: Array.from({ length: 4 }, () => ({ type: "update_pages", detail: "Do it." })),
      }),
    );
    expect(analysis.actions).toHaveLength(3);
  });

  it("reads a single-action reply as a list of one", () => {
    const { actions, ...single } = valid;
    const analysis = parseAnalysis(
      JSON.stringify({ ...single, action: "consider_building", action_detail: "d" }),
    );
    expect(analysis.actions).toEqual([{ type: "consider_building", detail: "d" }]);
  });

  it("keeps only the actions that say what to do and why", () => {
    const analysis = parseAnalysis(
      JSON.stringify({
        ...valid,
        actions: [{ type: "update_pages" }, { type: "consider_building", detail: "d" }],
      }),
    );
    expect(analysis.actions).toEqual([{ type: "consider_building", detail: "d" }]);
  });

  it("rewrites em dashes and curly quotes the model reached for", () => {
    const analysis = parseAnalysis(
      JSON.stringify({
        ...valid,
        summary: "Fixture Co ships sync\u2014on a schedule.",
        key_points: ["It\u2019s a cron, not a webhook."],
        actions: [{ type: "update_pages", detail: "The page is stale\u2014fix the claim." }],
      }),
    );
    expect(analysis.summary).toBe("Fixture Co ships sync \u2013 on a schedule.");
    expect(analysis.keyPoints).toEqual(["It's a cron, not a webhook."]);
    expect(analysis.actions[0]?.detail).toBe("The page is stale \u2013 fix the claim.");
    expect(JSON.stringify(analysis)).not.toContain("\u2014");
  });
});

describe("parseStoredAlert", () => {
  it("reads back the image and the issue opened for each action", () => {
    const stored = parseStoredAlert({
      ...valid,
      image: { url: "https://cdn.invalid/a.png", altText: "alt", origin: "page" },
      issues: [
        { type: "update_pages", issue: { url: "https://github.com/o/r/issues/3", number: 3 } },
        {
          type: "consider_enhancing",
          feature: "Data pipelines",
          issue: { url: "https://github.com/o/r/issues/4", number: 4 },
        },
      ],
    });
    expect(stored.image?.url).toBe("https://cdn.invalid/a.png");
    expect(stored.issues.map((entry) => entry.issue?.number)).toEqual([3, 4]);
    expect(stored.issues.map((entry) => entry.action.type)).toEqual([
      "update_pages",
      "consider_enhancing",
    ]);
    expect(stored.analysis.impact).toBe("notable");
  });

  it("reads a phase 1 row that has neither", () => {
    const stored = parseStoredAlert({ ...valid, impact: undefined, severity: "minor" });
    expect(stored.image).toBeNull();
    expect(stored.issues.map((entry) => entry.issue)).toEqual([null, null]);
    expect(stored.analysis.impact).toBe("minor");
  });

  it("puts a row's single stored issue on the first action, where it came from", () => {
    const stored = parseStoredAlert({
      ...valid,
      issue: { url: "https://github.com/o/r/issues/5", number: 5 },
    });
    expect(stored.issues.map((entry) => entry.issue?.number ?? null)).toEqual([5, null]);
  });

  it("pairs an action with no stored issue with null, rather than shifting the rest", () => {
    const stored = parseStoredAlert({
      ...valid,
      issues: [
        { type: "update_pages", issue: null },
        {
          type: "consider_enhancing",
          issue: { url: "https://github.com/o/r/issues/6", number: 6 },
        },
      ],
    });
    expect(stored.issues.map((entry) => entry.issue?.number ?? null)).toEqual([null, 6]);
  });

  it("reads a row stored on the low/medium/high scale", () => {
    expect(parseStoredAlert({ ...valid, impact: "high" }).analysis.impact).toBe("major");
  });

  it("reads back an alert the relevance guard left with no action", () => {
    const stored = parseStoredAlert({ ...valid, actions: [], issues: [] });
    expect(stored.analysis.actions).toEqual([]);
    expect(stored.issues).toEqual([]);
  });

  it("reads a stored alert that recommends nothing, which is now a normal row", () => {
    const stored = parseStoredAlert({ ...valid, actions: [], no_action_reason: "Nothing to do." });
    expect(stored.analysis.actions).toEqual([]);
    expect(stored.issues).toEqual([]);
  });

  /**
   * The stored verdict is what stops a retry reviewing an action twice, so it
   * has to survive the round trip through the row.
   */
  it("reads back the review each action got", () => {
    const stored = parseStoredAlert({
      ...valid,
      issues: [
        {
          type: "update_pages",
          issue: { url: "https://github.com/o/r/issues/3", number: 3 },
          review: {
            verdict: "revise",
            model: "claude-fable-5-1",
            at: "2026-01-16T09:00:00.000Z",
            reason: "The quote does not carry the gap.",
            applied: false,
          },
        },
        {
          type: "consider_enhancing",
          issue: { url: "https://github.com/o/r/issues/4", number: 4 },
        },
      ],
    });

    expect(stored.issues[0]?.review).toEqual({
      verdict: "revise",
      model: "claude-fable-5-1",
      at: new Date("2026-01-16T09:00:00.000Z"),
      reason: "The quote does not carry the gap.",
      applied: false,
    });
    // Absent, not null: an action nobody reviewed is one a later run may review.
    expect(stored.issues[1]?.review).toBeUndefined();
  });

  it("reads a review the in-memory store never serialized to JSON", () => {
    const at = new Date("2026-01-16T09:00:00.000Z");
    const stored = parseStoredAlert({
      ...valid,
      issues: [
        { type: "update_pages", issue: null, review: { verdict: "agree", model: "m", at, reason: "r" } },
      ],
    });
    expect(stored.issues[0]?.review?.at).toEqual(at);
  });

  it("refuses a stored verdict that is not one of the three", () => {
    expect(() =>
      parseStoredAlert({
        ...valid,
        issues: [
          {
            type: "update_pages",
            review: { verdict: "maybe", model: "m", at: "2026-01-16T09:00:00.000Z", reason: "r" },
          },
        ],
      }),
    ).toThrow();
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
  const indexedClaim = {
    url: "https://posthog.com/compare/best-mixpanel-alternatives",
    competitor: "mixpanel" as const,
    paragraph: "PostHog and Mixpanel both offer product analytics.",
    heading: null,
  };

  it("recommends nothing, because it knows no PostHog product facts", () => {
    // It cannot establish a gap, and a page is only worth editing when
    // something on it is wrong, which nothing here has established either.
    for (const claims of [[], [indexedClaim]]) {
      expect(heuristicAnalysis(item, claims).actions).toEqual([]);
    }
  });

  it("says plainly that nobody assessed this", () => {
    expect(heuristicAnalysis(item, []).noActionReason).toContain("No model analysis ran");
  });

  it("cites the indexed page and asks whether it is now wrong, as a question", () => {
    const analysis = heuristicAnalysis(item, [indexedClaim]);

    expect(analysis.posthogRefs.map((ref) => ref.url)).toEqual([indexedClaim.url]);
    expect(analysis.openQuestions[0]).toContain("Nobody has checked");
    expect(analysis.openQuestions[0]).toContain(indexedClaim.url);
  });

  it("names the closest docs page without assessing the gap itself", () => {
    const analysis = heuristicAnalysis(
      item,
      [],
      [
        {
          url: "https://posthog.com/docs/experiments/managing-lifecycle",
          title: "Managing the experiment lifecycle",
          excerpt: "You stop an experiment by hand. There is no end date field.",
        },
      ],
    );

    expect(analysis.posthogRefs.map((ref) => ref.url)).toEqual([
      "https://posthog.com/docs/experiments/managing-lifecycle",
    ]);
    expect(analysis.openQuestions.join(" ")).toContain("What does PostHog already ship here?");
    expect(analysis.actions).toEqual([]);
  });

  it("points an unassessed Mixpanel launch at Mixpanel, not at the other competitor", () => {
    expect(heuristicAnalysis(item, []).openQuestions[0]).toContain("mixpanel");
  });

  it("restates the source rather than inventing an assessment", () => {
    const analysis = heuristicAnalysis(item, []);
    expect(analysis.summary).toContain("Introducing Widget Sync");
  });

  it("rates a post on what it shipped, the way the rules do", () => {
    for (const [body, expected] of [
      ["Introducing Widget Sync. It copies widgets on a schedule.", "major"],
      ["You can now schedule when an existing report stops sending.", "notable"],
      ["We moved into a new office and hired a head of design.", "minor"],
    ] as const) {
      expect(heuristicAnalysis({ ...item, raw: { body } }, []).impact).toBe(expected);
    }
  });

  it("reads a new feature as major even when the post also enhances something", () => {
    const analysis = heuristicAnalysis(
      {
        ...item,
        raw: { body: "Introducing Widget Sync, and dashboards are now faster too." },
      },
      [],
    );
    expect(analysis.impact).toBe("major");
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
  const claim = {
    url: "https://posthog.com/compare/best-mixpanel-alternatives",
    competitor: "mixpanel" as const,
    paragraph: "PostHog and Mixpanel both offer product analytics.",
    heading: "Overview",
  };
  const withRefs = buildAnalysisPrompt(item, { claims: [claim] });

  it("gives the model only the claims it may cite", () => {
    expect(withRefs).toContain("https://posthog.com/compare/best-mixpanel-alternatives");
    expect(withRefs).toContain('section "Overview"');
    expect(withRefs).toContain("Only cite URLs that exist in it");
  });

  it("says so when nothing is indexed, rather than leaving a blank section", () => {
    expect(buildAnalysisPrompt(item, { claims: [] })).toContain(
      "no indexed PostHog.com pages mention",
    );
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

  it("asks for several actions, each naming the feature to enhance", () => {
    expect(withRefs).toContain('"actions"');
    expect(withRefs).toContain("Name the PostHog feature to enhance");
    expect(withRefs).toContain("Consider enhancing Experiments");
  });

  it("lists PostHog's small teams and what each one owns", () => {
    expect(withRefs).toContain("## PostHog small teams, from https://posthog.com/teams");
    expect(withRefs).toContain("- Experiments \u2013 owns Experiments");
    expect(withRefs).toContain("- Ingestion \u2013 owns Ingestion, Reverse proxy");
    // A team that owns nothing routing cares about still has to be listed, so
    // the model can name it rather than reaching for a department.
    expect(withRefs).toContain("- Growth");
  });

  it("asks for teams from that list, and refuses a department", () => {
    expect(withRefs).toContain('"teams" is 1 to 3 PostHog small teams');
    expect(withRefs).toContain('"Product", "Engineering", "Platform", and "Core" are not teams');
    expect(withRefs).toContain("an experiments gap is for Experiments");
  });

  it("asks for an action detail that opens with one short sentence", () => {
    expect(withRefs).toContain(`one short sentence, under ${MAX_ACTION_CHARS} characters`);
    expect(withRefs).toContain("Slack shows that sentence and nothing else");
  });

  it("shows the good and bad shape of that sentence, per action type", () => {
    expect(withRefs).toContain("leads with the work, not with what PostHog lacks");
    // Product actions ask for the change first, then the gap behind it.
    expect(withRefs).toContain(
      'Good: "Add a scheduled end time on experiments so a test can stop on its own',
    );
    expect(withRefs).toContain(
      'Bad: "PostHog schedules flag changes, but an experiment still has to be stopped by hand."',
    );
    // Page actions name the page and what it should say.
    expect(withRefs).toContain('Good: "On the PostHog vs Amplitude experiments compare, say');
    expect(withRefs).toContain('Bad: "The compare page is out of date."');
    expect(withRefs).toContain("name that page in the opening sentence");
  });

  it("states the PostHog writing rules, with both handbook pages", () => {
    expect(withRefs).toContain("https://posthog.com/handbook/wizard-and-docs/docs-style-guide");
    expect(withRefs).toContain("https://posthog.com/handbook/brand/tone");
    expect(withRefs).toContain("en dash with a space either side");
    expect(withRefs).toContain("Never use an em dash");
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

  describe("how impact is rated", () => {
    it("rates on what the post shipped, and says so first", () => {
      expect(withRefs).toContain('"impact" is a label only, and one question decides it: what did this post ship?');
    });

    it("gives each level its rule", () => {
      expect(withRefs).toContain("major: a brand-new feature, one the competitor did not have before");
      expect(withRefs).toContain("notable: an enhancement of a feature they already had");
      expect(withRefs).toContain(
        "minor: a published post with nothing about a new feature or an enhancement in it",
      );
    });

    it("rates a mixed post on the strongest thing it ships", () => {
      expect(withRefs).toContain("Rate the post on the strongest thing it ships");
      expect(withRefs).toContain("Fluff never pulls the label down");
    });

    it("shuts out the old heuristics", () => {
      expect(withRefs).toContain("Nothing else moves it");
      expect(withRefs).toContain("not whether PostHog has a gap here");
      expect(withRefs).not.toContain("strategic move that changes the comparison");
      expect(withRefs).not.toContain("cosmetic or incremental");
    });

    it("works both edge cases the rules turn on", () => {
      expect(withRefs).toContain("A scheduled end time on experiments they already ship is notable");
      expect(withRefs).toContain("the customer's own domain, which they never offered, is major");
    });

    it("never asks for a lower impact when the docs settle nothing", () => {
      expect(withRefs).not.toContain("keep impact lower");
      expect(withRefs).not.toContain("keep impact minor");
      expect(withRefs).toContain(
        "impact is about what the competitor shipped, not about what you could check on PostHog's side",
      );
    });
  });

  describe("checking the docs before recommending", () => {
    const docs = [
      {
        url: "https://posthog.com/docs/feature-flags/scheduled-flag-changes",
        title: "Scheduled flag changes",
        excerpt: "You can set a date for a feature flag to change or turn off.",
      },
      {
        url: "https://posthog.com/docs/experiments/managing-lifecycle",
        title: "Managing the experiment lifecycle",
        excerpt: "You stop an experiment by hand. There is no end date field.",
      },
    ];
    const withDocs = buildAnalysisPrompt(item, { claims: [claim], docs });

    it("puts the docs pages in front of the model, with their text", () => {
      expect(withDocs).toContain("https://posthog.com/docs/feature-flags/scheduled-flag-changes");
      expect(withDocs).toContain("Scheduled flag changes");
      expect(withDocs).toContain("There is no end date field");
    });

    it("asks a gap claim to carry the page it was read off and a quote from it", () => {
      expect(withDocs).toContain('"gap" is one line saying what PostHog does not do today');
      expect(withDocs).toContain('"evidence_url" is the PostHog docs page you read the gap off');
      expect(withDocs).toContain("words copied from that page, exactly as they appear on it");
    });

    it("says the quote is checked, so a paraphrase is not worth writing", () => {
      expect(withDocs).toContain("the quote is matched against the stored page");
    });

    it("warns that a gap on a page nobody opened is dropped", () => {
      expect(withDocs).toContain("An action is dropped when the corpus holds a page about the gap");
    });

    it("says a compare page is not evidence about the product", () => {
      expect(withDocs).toContain("marketing copy");
      expect(withDocs).toContain("Not evidence of what the product does");
    });

    it("works the scheduling example, so adjacent capability is not read as a gap", () => {
      expect(withDocs).toContain("https://posthog.com/docs/experiments/managing-lifecycle");
      expect(withDocs).toContain("PostHog cannot schedule anything\" is wrong");
    });

    it("reserves consider_building for an area no docs page covers", () => {
      expect(withDocs).toContain(
        "consider_building is only for a capability with no PostHog product behind it",
      );
    });

    it("asks for an open question when the gap cannot be evidenced, not a page edit", () => {
      expect(withDocs).toContain("A gap you cannot evidence is an open question");
      expect(withDocs).toContain("open_questions");
      expect(withDocs).toContain("update_pages is not the safe fallback for an unverified gap");
    });

    it("rules out the things that look like gaps and are not", () => {
      expect(withDocs).toContain("What is not a gap");
      expect(withDocs).toContain("not a capability PostHog is missing");
      expect(withDocs).toContain('"Document this" is not one of the action types');
      expect(withDocs).toContain("A capability PostHog has under a different name");
    });

    it("says to check the corpus before asking for a compare page that exists", () => {
      expect(withDocs).toContain("A compare page PostHog already publishes");
    });

    it("says plainly when nothing was pre-loaded, rather than leaving a gap open", () => {
      expect(withRefs).toContain("nothing was pre-loaded");
      expect(withRefs).toContain("instead of guessing");
    });
  });

  describe("the docs workspace", () => {
    const workspace = buildAnalysisPrompt(item, {
      claims: [claim],
      toc: "# PostHog docs workspace\n\n## docs/experiments (1)\n- Managing the experiment lifecycle `pages/docs-experiments/managing-lifecycle.md`",
    });

    it("tells the analyst it has files to search, and which tools it has", () => {
      expect(workspace).toContain("as files you can search");
      expect(workspace).toContain("read a file, grep the text, glob for paths, list a directory");
    });

    it("lists every page when the corpus is small enough to list", () => {
      expect(workspace).toContain("Every page in the corpus");
      expect(workspace).toContain("Managing the experiment lifecycle");
    });

    it("falls back to the section outline when the full list will not fit", () => {
      // PostHog publishes a few thousand pages, so this is the normal path.
      const big = buildAnalysisPrompt(item, {
        claims: [claim],
        toc: "x".repeat(200_000),
        outline: "- `docs/experiments` 40 pages in `pages/docs-experiments/`",
      });

      expect(big).not.toContain("x".repeat(1_000));
      expect(big).toContain("The corpus, by section");
      expect(big).toContain("docs/experiments` 40 pages");
    });

    it("says what each kind of page is evidence of", () => {
      expect(workspace).toContain("product documentation: what PostHog ships today");
      expect(workspace).toContain("shipped, may be undocumented");
    });

    it("warns that a quiet docs page is not a gap when the changelog says otherwise", () => {
      expect(workspace).toContain("do not call it a gap because the docs are quiet");
    });

    it("tells it to hold back when there is no workspace at all", () => {
      expect(withRefs).toContain("You have no searchable copy of PostHog's docs this run");
      expect(withRefs).toContain("the honest answer is an open question and no action");
    });
  });

  describe("recommending nothing", () => {
    it("says zero actions is a normal answer and asks for the reason", () => {
      expect(withRefs).toContain('"actions" is 0 to 3 things PostHog should do');
      expect(withRefs).toContain("Zero is a normal answer and often the right one");
      expect(withRefs).toContain('one sentence in "no_action_reason" saying why');
      expect(withRefs).toContain('"no_action_reason"');
    });
  });

  describe("when update_pages is allowed", () => {
    it("states the three reasons a PostHog page is worth editing", () => {
      expect(withRefs).toContain("When update_pages is allowed");
      expect(withRefs).toContain("wrong or misleading because of this launch");
      expect(withRefs).toContain("claims a parity or an advantage this launch breaks");
      expect(withRefs).toContain("understates it or reads as if PostHog does not have it");
      expect(withRefs).toContain(
        "comparison page claims PostHog does not do something PostHog does do",
      );
    });

    it("rules out the vague reasons", () => {
      expect(withRefs).toContain("Do not recommend update_pages because customers might ask");
      expect(withRefs).toContain("because a feature matrix has no row for it");
      expect(withRefs).toContain('because a page "could be stronger"');
      expect(withRefs).toContain("leave update_pages out and let the other actions carry the alert");
    });

    it("makes the action name the page it is fixing", () => {
      expect(withRefs).toContain('Point at the specific page and the specific line in "posthog_refs"');
    });

    it("covers marketing, product marketing, and compare pages", () => {
      expect(withRefs).toContain("marketing, product marketing, or compare page");
    });

    it("ties the page edit to the launch in the signal, not the page it sits on", () => {
      expect(withRefs).toContain(
        "Every update_pages action has to be about the competitor product update in this signal",
      );
      expect(withRefs).toContain("not a licence to fix the rest of the page it touches");
      expect(withRefs).toContain("basic A/B testing in November 2025");
      expect(withRefs).toContain("same page, different topic");
    });

    it("says a small launch can need no page edit at all", () => {
      expect(withRefs).toContain("Small launches often need no page edit at all");
      expect(withRefs).toContain("Silence about a small lifecycle control is fine");
    });

    it("stops a notable impact from buying a page edit", () => {
      expect(withRefs).toContain(
        "A notable or major impact is not a reason for update_pages",
      );
    });
  });

  describe("what the competitor says about PostHog", () => {
    const compareClaims = [
      {
        url: "https://mixpanel.com/compare/posthog",
        competitor: "mixpanel" as const,
        paragraph: "PostHog does not offer scheduled reports for your whole team.",
        heading: "Reporting",
      },
    ];
    const withCompare = buildAnalysisPrompt(item, { claims: [claim], compareClaims });

    it("puts their comparison page in context, quoted and cited", () => {
      expect(withCompare).toContain("What Mixpanel says about PostHog on their own comparison pages");
      expect(withCompare).toContain("https://mixpanel.com/compare/posthog");
      expect(withCompare).toContain("PostHog does not offer scheduled reports");
      expect(withCompare).toContain('section "Reporting"');
    });

    it("ties their claim to the third reason for update_pages", () => {
      expect(withCompare).toContain("reason 3 for update_pages applies");
      expect(withCompare).toContain("Never treat this as evidence about PostHog's product");
    });

    it("says so when their page is not in context, rather than inviting a guess", () => {
      expect(withRefs).toContain("no Mixpanel comparison page about PostHog is in context");
      expect(withRefs).toContain("do not assume what they claim about PostHog");
    });
  });
});
