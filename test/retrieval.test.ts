import { describe, expect, it } from "vitest";
import { bestExcerpt, buildCorpusIndex, sectionOf, terms } from "../src/posthog/retrieval.js";
import { corpus, page } from "./helpers.js";

describe("terms", () => {
  it("folds a word and its inflections onto one token", () => {
    expect(terms("scheduling")).toEqual(terms("scheduled"));
    expect(terms("cohorts")).toEqual(terms("cohort"));
  });

  it("drops the words every page in this corpus uses", () => {
    expect(terms("PostHog can use this to see the new one")).toEqual([]);
  });
});

describe("sectionOf", () => {
  it("reads a docs section two segments deep, not one", () => {
    // Everything posthog.com publishes is on one host, so a section of "docs"
    // would hold the whole corpus and the per-section cap would mean nothing.
    expect(sectionOf("https://posthog.com/docs/experiments/holdouts")).toBe("docs/experiments");
    expect(sectionOf("https://posthog.com/docs/session-replay")).toBe("docs/session-replay");
  });

  it("reads everything else one segment deep", () => {
    expect(sectionOf("https://posthog.com/compare/mixpanel-vs-posthog")).toBe("compare");
    expect(sectionOf("https://posthog.com/pricing")).toBe("pricing");
  });
});

describe("bestExcerpt", () => {
  const text =
    "Experiments move through draft, running, and complete. You stop an experiment by clicking complete when you have enough data. There is no end date field, so stopping is a manual step. Cohort analysis is unaffected.";

  it("keeps the lead sentence, because it says what the page is", () => {
    expect(bestExcerpt(text, terms("schedule"))).toContain("Experiments move through draft");
  });

  it("keeps the sentences that use the query's words and drops the rest", () => {
    const excerpt = bestExcerpt(text, terms("end date manual stopping"));
    expect(excerpt).toContain("There is no end date field");
    expect(excerpt).not.toContain("Cohort analysis is unaffected");
  });

  it("stays inside its budget", () => {
    expect(bestExcerpt("word ".repeat(2_000), ["word"], 300).length).toBeLessThanOrEqual(300);
  });

  it("returns nothing for a page with no text, rather than throwing", () => {
    expect(bestExcerpt("", ["stop"])).toBe("");
  });
});

describe("buildCorpusIndex", () => {
  const index = corpus(
    {
      url: "https://posthog.com/docs/experiments/managing-lifecycle",
      title: "Managing the experiment lifecycle",
      text: "You stop an experiment by hand. There is no end date field on an experiment, so nobody can schedule a stop.",
    },
    {
      url: "https://posthog.com/docs/feature-flags/scheduled-flag-changes",
      title: "Scheduled flag changes",
      text: "Schedule a feature flag change for a future date, including turning the flag off.",
    },
    {
      url: "https://posthog.com/docs/session-replay/privacy",
      title: "Session replay privacy",
      text: "Mask inputs and text so a recording never captures anything a person typed.",
    },
  );

  it("ranks the page about the query above the pages that are not", () => {
    const [top] = index.search("schedule an experiment stop");
    expect(top?.url).toBe("https://posthog.com/docs/experiments/managing-lifecycle");
  });

  it("finds nothing for a query whose words are in no page", () => {
    expect(index.search("kubernetes helm chart rollout")).toEqual([]);
  });

  it("returns nothing at all for a query that is only stop words", () => {
    expect(index.search("the new one you can use")).toEqual([]);
  });

  it("reports which query words a page actually contains, for explaining a block", () => {
    const [top] = index.search("end date field on an experiment");
    expect(top?.matched).toContain("experiment");
    expect(top?.matched).toContain("field");
  });

  it("hands back a page's stored text so a quote can be checked against it", () => {
    const stored = index.page("https://posthog.com/docs/session-replay/privacy");
    expect(stored?.text).toContain("Mask inputs and text");
    expect(index.page("https://posthog.com/docs/nothing-here")).toBeUndefined();
  });

  it("caps how many hits one section of the docs may contribute", () => {
    const experiments = Array.from({ length: 6 }, (_, n) => ({
      url: `https://posthog.com/docs/experiments/page-${n}`,
      title: "Experiment holdouts",
      text: "Holdouts keep a slice of users out of every experiment so you can measure the whole program.",
    }));
    const crowded = corpus(...experiments, {
      url: "https://posthog.com/docs/feature-flags/holdouts",
      title: "Flag holdouts",
      text: "Holdouts keep a slice of users out of every experiment rollout.",
    });

    const hits = crowded.search("holdouts across every experiment", { limit: 5, perSection: 2 });
    const sections = hits.filter((hit) => hit.section === "docs/experiments");
    expect(sections).toHaveLength(2);
    expect(hits.map((hit) => hit.url)).toContain("https://posthog.com/docs/feature-flags/holdouts");
  });

  it("searches only the kinds it was asked for", () => {
    const mixed = corpus(
      {
        url: "https://posthog.com/docs/surveys",
        text: "Surveys collect answers from people using your product.",
      },
      {
        url: "https://posthog.com/changelog/2026-01-surveys",
        kind: "changelog",
        text: "Surveys now collect answers on mobile.",
      },
    );

    const docsOnly = mixed.search("surveys collect answers", { kinds: ["docs"] });
    expect(docsOnly.map((hit) => hit.url)).toEqual(["https://posthog.com/docs/surveys"]);
  });

  it("ranks a product's overview page above a guide that uses the same words", () => {
    const boosted = buildCorpusIndex([
      page({
        // In the catalog, so it is the page that answers "does PostHog do this at all".
        url: "https://posthog.com/docs/experiments",
        title: "Experiments",
        text: "Experiments test a change against a control group and read the result.",
      }),
      page({
        url: "https://posthog.com/docs/experiments/some-guide",
        title: "Experiments",
        text: "Experiments test a change against a control group and read the result.",
      }),
    ]);

    const [top] = boosted.search("experiments test a change against a control group");
    expect(top?.url).toBe("https://posthog.com/docs/experiments");
  });

  it("holds an empty corpus without falling over", () => {
    const empty = buildCorpusIndex([]);
    expect(empty.size).toBe(0);
    expect(empty.search("anything")).toEqual([]);
    expect(empty.urls()).toEqual([]);
  });

  it("leaves out a page with no body, which nobody could quote", () => {
    expect(corpus({ url: "https://posthog.com/docs/empty", text: "   " }).size).toBe(0);
  });
});
