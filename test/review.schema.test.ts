import { describe, expect, it } from "vitest";
import { mergeRevision, parseReview, parseRevision } from "../src/review/schema.js";
import type { PostHogRef, RecommendedAction } from "../src/types.js";

const productAction: RecommendedAction = {
  type: "consider_enhancing",
  feature: "Experiments",
  detail: "Add a consent-pending mode for web experiments so exposures buffer and flush on grant.",
  gap: "No consent-pending buffer for web experiments.",
  evidenceUrl: "https://posthog.com/docs/tutorials/cookieless-tracking",
  evidenceQuote: "PostHog doesn't capture any events until after consent is either given or denied.",
};

const pageAction: RecommendedAction = {
  type: "update_pages",
  detail: "On the best amplitude alternatives page, say Amplitude now gates on consent.",
};

const refs: PostHogRef[] = [
  {
    url: "https://posthog.com/compare/best-amplitude-alternatives",
    claim: "Both tools require manual consent handling.",
    suggestedEdit: "Note that Amplitude gates its experiment script on consent.",
  },
  {
    url: "https://posthog.com/docs/privacy/data-collection",
    claim: "Integrate your consent management platform with PostHog's opt in and out controls.",
  },
];

const review = parseReview(
  JSON.stringify({
    verdict: "revise",
    reason: "The gap claims more than the quoted page supports.",
    pages_checked: ["https://posthog.com/docs/privacy/data-collection"],
    changes: ["Narrow the gap to what the quote carries."],
  }),
);

describe("parseReview", () => {
  it("reads a verdict, its reason, and the pages behind it", () => {
    expect(review).toEqual({
      verdict: "revise",
      reason: "The gap claims more than the quoted page supports.",
      pagesChecked: ["https://posthog.com/docs/privacy/data-collection"],
      changes: ["Narrow the gap to what the quote carries."],
    });
  });

  it("reads a reply wrapped in prose and a code fence, which is how they arrive", () => {
    const parsed = parseReview(
      'Here is my review:\n```json\n{"verdict": "agree", "reason": "It stands."}\n```\nHope that helps.',
    );
    expect(parsed.verdict).toBe("agree");
    expect(parsed.pagesChecked).toEqual([]);
    expect(parsed.changes).toEqual([]);
  });

  it("punctuates the reason PostHog's way, because it is posted as a comment", () => {
    const parsed = parseReview(
      JSON.stringify({ verdict: "drop", reason: "PostHog ships this\u2014see the docs." }),
    );
    expect(parsed.reason).toBe("PostHog ships this \u2013 see the docs.");
  });

  it("takes an impact and a type correction only when the reviewer sends one", () => {
    const bare = parseReview(JSON.stringify({ verdict: "agree", reason: "Fine." }));
    expect(bare.impact).toBeUndefined();
    expect(bare.actionType).toBeUndefined();

    const corrected = parseReview(
      JSON.stringify({
        verdict: "revise",
        reason: "This is a new capability for them.",
        impact: "high",
        action_type: "consider_building",
      }),
    );
    // Either scale parses, so a reply on low/medium/high still lands.
    expect(corrected.impact).toBe("major");
    expect(corrected.actionType).toBe("consider_building");
  });

  it("refuses a verdict that is not one of the three", () => {
    expect(() => parseReview(JSON.stringify({ verdict: "maybe", reason: "Unsure." }))).toThrow();
  });

  it("refuses a reply with no reason, because the comment has nothing to say", () => {
    expect(() => parseReview(JSON.stringify({ verdict: "drop" }))).toThrow();
  });

  it("drops blank lines out of the lists rather than failing the reply", () => {
    const parsed = parseReview(
      JSON.stringify({
        verdict: "revise",
        reason: "Narrow it.",
        changes: ["Narrow the gap.", "", "   "],
        pages_checked: ["https://posthog.com/docs/experiments", ""],
      }),
    );
    expect(parsed.changes).toEqual(["Narrow the gap."]);
    expect(parsed.pagesChecked).toEqual(["https://posthog.com/docs/experiments"]);
  });
});

describe("parseRevision", () => {
  it("reads only the fields the writer changed", () => {
    const parsed = parseRevision(
      JSON.stringify({
        gap: "Capture waits for a consent decision, so pending-window exposures are lost.",
        evidence_url: "https://posthog.com/docs/privacy/data-collection",
        evidence_quote: "integrate it with PostHog's opt in and out controls",
      }),
    );
    expect(parsed).toEqual({
      gap: "Capture waits for a consent decision, so pending-window exposures are lost.",
      evidenceUrl: "https://posthog.com/docs/privacy/data-collection",
      evidenceQuote: "integrate it with PostHog's opt in and out controls",
      pageEdits: [],
    });
  });

  it("reads the copy for a page under whichever key the writer used", () => {
    const copy = "Amplitude schedules an experiment stop. PostHog experiments stop by hand.";
    for (const key of ["proposed_text", "proposedText", "replacement_text"]) {
      const parsed = parseRevision(
        JSON.stringify({ page_edits: [{ url: "https://posthog.com/pricing", [key]: copy }] }),
      );
      expect(parsed.pageEdits, key).toEqual([
        { url: "https://posthog.com/pricing", proposedText: copy },
      ]);
    }
  });

  it("reads page edits sent under the older suggested_edits key", () => {
    const parsed = parseRevision(
      JSON.stringify({
        suggested_edits: [
          { url: "https://posthog.com/pricing", suggested_edit: "Name the schedule." },
        ],
      }),
    );
    expect(parsed.pageEdits).toEqual([
      { url: "https://posthog.com/pricing", suggestedEdit: "Name the schedule." },
    ]);
  });

  it("drops a page edit carrying neither the copy nor a reason", () => {
    expect(
      parseRevision(JSON.stringify({ page_edits: [{ url: "https://posthog.com/pricing" }] }))
        .pageEdits,
    ).toEqual([]);
  });

  it("punctuates the page copy PostHog's way, because it is destined for posthog.com", () => {
    const parsed = parseRevision(
      JSON.stringify({
        page_edits: [
          {
            url: "https://posthog.com/pricing",
            proposed_text: "Amplitude schedules a stop\u2014PostHog stops by hand.",
          },
        ],
      }),
    );
    expect(parsed.pageEdits[0]?.proposedText).toBe(
      "Amplitude schedules a stop \u2013 PostHog stops by hand.",
    );
  });

  it("leaves a quote exactly as the page has it, dashes and all", () => {
    const quote = "Session replay and surveys\u2014both are disabled without consent.";
    const parsed = parseRevision(JSON.stringify({ evidence_quote: quote }));
    // Everything else is punctuated PostHog's way. A quote is checked character
    // by character against the stored page, so correcting it would fail.
    expect(parsed.evidenceQuote).toBe(quote);
    expect(parseRevision(JSON.stringify({ gap: quote })).gap).toContain(" \u2013 ");
  });

  it("reads a blank field as one the writer left alone", () => {
    const parsed = parseRevision(JSON.stringify({ detail: "", gap: "  ", feature: "Experiments" }));
    expect(parsed.detail).toBeUndefined();
    expect(parsed.gap).toBeUndefined();
    expect(parsed.feature).toBe("Experiments");
  });
});

describe("mergeRevision", () => {
  const merge = (raw: object, action = productAction, decision = review) =>
    mergeRevision(action, refs, parseRevision(JSON.stringify(raw)), decision, "notable");

  it("takes the detail, gap, evidence, and quote the writer sent", () => {
    const merged = merge({
      detail: "Buffer web experiment exposures while consent is pending.",
      gap: "Capture waits for a consent decision.",
      evidence_url: "https://posthog.com/docs/privacy/data-collection",
      evidence_quote: "opt in and out controls",
    });

    expect(merged.action).toMatchObject({
      type: "consider_enhancing",
      feature: "Experiments",
      detail: "Buffer web experiment exposures while consent is pending.",
      gap: "Capture waits for a consent decision.",
      evidenceUrl: "https://posthog.com/docs/privacy/data-collection",
      evidenceQuote: "opt in and out controls",
    });
    expect(merged.notes).toEqual([]);
  });

  it("swaps the two product actions for each other", () => {
    expect(merge({ type: "consider_building" }).action.type).toBe("consider_building");
    expect(
      merge({ type: "consider_enhancing" }, { ...productAction, type: "consider_building" }).action
        .type,
    ).toBe("consider_enhancing");
  });

  it("refuses to turn a product action into page work, which is a different recommendation", () => {
    for (const type of ["update_pages", "new_compare_page"] as const) {
      const merged = merge({ type });
      expect(merged.action.type).toBe("consider_enhancing");
      expect(merged.notes.join(" ")).toContain(`refused a type change from consider_enhancing to ${type}`);
    }
  });

  it("refuses to turn page work into a product action, either", () => {
    const merged = merge({ type: "consider_building" }, pageAction);
    expect(merged.action.type).toBe("update_pages");
    expect(merged.notes.join(" ")).toContain("only consider_building and consider_enhancing may swap");
  });

  it("names the feature the way PostHog does, whatever casing the writer used", () => {
    expect(merge({ feature: "session replay" }).action.feature).toBe("Session replay");
  });

  it("keeps the old feature when the catalog has never heard of the new one", () => {
    const merged = merge({ feature: "Time travel" });
    expect(merged.action.feature).toBe("Experiments");
    expect(merged.notes.join(" ")).toContain('the catalog has no product called "Time travel"');
  });

  it("moves impact only on the reviewer's word", () => {
    expect(merge({ impact: "major" }).impact).toBe("notable");
    expect(merge({ impact: "major" }).notes.join(" ")).toContain(
      "the reviewer did not say it was wrong",
    );

    const asked = { ...review, impact: "major" as const };
    expect(merge({}, productAction, asked).impact).toBe("major");
  });

  it("replaces a suggested edit on a page marketing writes", () => {
    const merged = merge({
      suggested_edits: [
        {
          url: "https://posthog.com/compare/best-amplitude-alternatives",
          suggested_edit: "Say Amplitude now buffers exposures until a visitor consents.",
        },
      ],
    });

    expect(merged.refs[0]?.suggestedEdit).toBe(
      "Say Amplitude now buffers exposures until a visitor consents.",
    );
    // The other ref is untouched, and it never had an edit to begin with.
    expect(merged.refs[1]?.suggestedEdit).toBeUndefined();
    expect(merged.notes).toEqual([]);
  });

  it("replaces the copy for a page it may edit, which is what a page revise is", () => {
    const copy =
      "Amplitude buffers experiment exposures while consent is pending and flushes them on grant. PostHog captures nothing until a visitor decides.";
    const merged = merge({
      page_edits: [{ url: "https://posthog.com/compare/best-amplitude-alternatives", proposed_text: copy }],
    });

    expect(merged.refs[0]?.proposedText).toBe(copy);
    // The one-line reason it was filed with survives a rewrite that only changed
    // the copy, so the issue still says why.
    expect(merged.refs[0]?.suggestedEdit).toBe(refs[0]?.suggestedEdit);
    expect(merged.notes).toEqual([]);
  });

  it("takes copy that reads as an instruction, and leaves the gate to refuse it", () => {
    // One judge of what counts as copy: `isExactRewrite`, through the gate. This
    // merge only decides which page may be touched.
    const merged = merge({
      page_edits: [
        {
          url: "https://posthog.com/compare/best-amplitude-alternatives",
          proposed_text: "Mention that Amplitude now gates on consent.",
        },
      ],
    });
    expect(merged.refs[0]?.proposedText).toBe("Mention that Amplitude now gates on consent.");
    expect(merged.notes).toEqual([]);
  });

  it("refuses an edit aimed at a docs page, which is evidence rather than a target", () => {
    const merged = merge({
      page_edits: [
        {
          url: "https://posthog.com/docs/privacy/data-collection",
          proposed_text:
            "PostHog captures nothing until a visitor gives or denies consent, so pending-window exposures are lost.",
          suggested_edit: "Mention experiment exposures.",
        },
      ],
    });
    const docs = merged.refs.find((ref) => ref.url.includes("/docs/"));
    expect(docs?.proposedText).toBeUndefined();
    expect(docs?.suggestedEdit).toBeUndefined();
    expect(merged.notes.join(" ")).toContain("not a page marketing writes");
  });

  it("refuses an edit for a page this analysis never cited", () => {
    const merged = merge({
      page_edits: [
        { url: "https://posthog.com/pricing", suggested_edit: "Add a consent row." },
      ],
    });
    expect(merged.refs).toHaveLength(2);
    expect(merged.notes.join(" ")).toContain("which this analysis never cited");
  });

  it("leaves everything alone when the writer sent an empty object", () => {
    const merged = merge({});
    expect(merged.action).toEqual(productAction);
    expect(merged.refs).toEqual(refs);
    expect(merged.impact).toBe("notable");
    expect(merged.notes).toEqual([]);
  });
});
