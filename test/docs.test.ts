import { describe, expect, it } from "vitest";
import { contextForSignal, signalText, topUpDocsForActions } from "../src/posthog/docs.js";
import type { StoredItem } from "../src/types.js";
import { corpus, EMPTY_CORPUS } from "./helpers.js";

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

const index = corpus(
  {
    url: "https://posthog.com/docs/experiments/managing-lifecycle",
    title: "Managing the experiment lifecycle",
    text: "You stop an experiment by clicking complete. There is no end date field, so stopping is a manual step.",
  },
  {
    url: "https://posthog.com/docs/feature-flags/scheduled-flag-changes",
    title: "Scheduled flag changes",
    text: "Schedule a feature flag change for a future date, including turning the flag off.",
  },
  {
    url: "https://posthog.com/docs/session-replay",
    title: "Session replay",
    text: "Watch what a person did in your product, with masking on by default.",
  },
  {
    url: "https://posthog.com/docs/advanced/proxy",
    title: "Deploy a reverse proxy",
    text: "A reverse proxy routes events through your own domain, which ad blockers have not cataloged. PostHog's managed reverse proxy handles the certificate for you.",
  },
  {
    url: "https://posthog.com/changelog/2026-01",
    title: "January changelog",
    kind: "changelog",
    text: "Experiments gained an end date field this month.",
  },
);

describe("signalText", () => {
  it("is everything the signal itself says, which is what retrieval is queried with", () => {
    expect(signalText(item)).toContain("Schedule experiment stop");
    expect(signalText(item)).toContain("pick a date and time");
  });
});

describe("contextForSignal", () => {
  it("pre-loads the pages the launch's own words rank highest", () => {
    const urls = contextForSignal(index, item).map((doc) => doc.url);
    expect(urls).toContain("https://posthog.com/docs/experiments/managing-lifecycle");
    expect(urls).not.toContain("https://posthog.com/docs/session-replay");
  });

  it("gives both sides of the scheduling case, not just the one that agrees", () => {
    // Flags schedule changes and experiments do not, so "PostHog cannot
    // schedule anything" is wrong and the real gap is narrower.
    const urls = contextForSignal(index, item).map((doc) => doc.url);
    expect(urls).toContain("https://posthog.com/docs/feature-flags/scheduled-flag-changes");
  });

  it("carries what each page is evidence of, because the kinds are not equivalent", () => {
    const docs = contextForSignal(index, {
      title: "Experiments end date",
      raw: { body: "an end date field on an experiment" },
    });
    const changelog = docs.find((doc) => doc.url.includes("/changelog/"));
    expect(changelog?.kind).toBe("changelog");
  });

  it("stays inside the budget it was given", () => {
    expect(contextForSignal(index, item, { limit: 2 })).toHaveLength(2);
  });

  it("returns nothing against an empty corpus, rather than throwing", () => {
    expect(contextForSignal(EMPTY_CORPUS, item)).toEqual([]);
  });

  it("returns nothing for a signal whose words are in no page", () => {
    expect(contextForSignal(index, { title: "We redesigned our website footer", raw: {} })).toEqual(
      [],
    );
  });
});

describe("topUpDocsForActions", () => {
  const enhanceProxy = {
    type: "consider_enhancing" as const,
    feature: "Managed reverse proxy",
    detail: "Offer a managed proxy on a domain the customer owns.",
  };

  it("adds the docs for a product the verdict named but the signal never matched", () => {
    // The action checked against no page at all is the one that ships
    // "PostHog has no X" when PostHog has X.
    const docs = topUpDocsForActions(index, item, [enhanceProxy], []);

    expect(docs.map((doc) => doc.url)).toEqual(["https://posthog.com/docs/advanced/proxy"]);
    // The lead sentence always survives, because it says what the product is.
    expect(docs[0]?.excerpt).toContain("A reverse proxy routes events through your own domain");
  });

  it("looks nothing up for a product whose docs are already in context", () => {
    const inContext = [
      {
        url: "https://posthog.com/docs/experiments/managing-lifecycle",
        title: "Managing the experiment lifecycle",
        excerpt: "You stop an experiment by hand.",
      },
    ];

    const docs = topUpDocsForActions(
      index,
      item,
      [{ type: "consider_enhancing", feature: "Experiments", detail: "Add an end time." }],
      inContext,
    );

    expect(docs).toEqual(inContext);
  });

  it("adds nothing for a product the corpus does not hold", () => {
    expect(topUpDocsForActions(EMPTY_CORPUS, item, [enhanceProxy], [])).toEqual([]);
  });
});
