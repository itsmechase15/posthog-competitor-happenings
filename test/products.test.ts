import { describe, expect, it } from "vitest";
import {
  CANONICAL_DOC_URLS,
  docUrlsForText,
  findProductByName,
  matchProducts,
  POSTHOG_PRODUCTS,
  productForDocUrl,
} from "../src/posthog/products.js";

describe("POSTHOG_PRODUCTS", () => {
  it("only lists docs pages on posthog.com, which is what gets cited", () => {
    for (const url of CANONICAL_DOC_URLS) {
      expect(url).toMatch(/^https:\/\/posthog\.com\/docs\//);
    }
  });

  it("names every product once, so an action's feature maps to one thing", () => {
    const names = POSTHOG_PRODUCTS.map((product) => product.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every product a docs page and a way to be recognised", () => {
    for (const product of POSTHOG_PRODUCTS) {
      expect(product.docs.length).toBeGreaterThan(0);
      expect(product.keywords.length).toBeGreaterThan(0);
    }
  });

  it("stays a bounded list rather than a crawl of posthog.com", () => {
    expect(CANONICAL_DOC_URLS.length).toBeLessThanOrEqual(40);
    expect(new Set(CANONICAL_DOC_URLS).size).toBe(CANONICAL_DOC_URLS.length);
  });

  it("covers the two pages the Amplitude scheduling case turns on", () => {
    expect(CANONICAL_DOC_URLS).toContain(
      "https://posthog.com/docs/feature-flags/scheduled-flag-changes",
    );
    expect(CANONICAL_DOC_URLS).toContain("https://posthog.com/docs/experiments/managing-lifecycle");
  });
});

describe("findProductByName", () => {
  it("reads the feature a model named, however it phrased it", () => {
    expect(findProductByName("Experiments")?.name).toBe("Experiments");
    expect(findProductByName("experiments")?.name).toBe("Experiments");
    expect(findProductByName("PostHog Experiments (A/B testing)")?.name).toBe("Experiments");
    expect(findProductByName("Session replay")?.name).toBe("Session replay");
  });

  it("returns nothing for a feature we hold no docs for", () => {
    expect(findProductByName("Time travel")).toBeUndefined();
    expect(findProductByName("")).toBeUndefined();
  });
});

describe("productForDocUrl", () => {
  it("maps a docs page back to the product it documents", () => {
    expect(productForDocUrl("https://posthog.com/docs/experiments/managing-lifecycle")?.name).toBe(
      "Experiments",
    );
    expect(
      productForDocUrl("https://posthog.com/docs/feature-flags/scheduled-flag-changes")?.name,
    ).toBe("Feature flags");
    expect(productForDocUrl("https://posthog.com/blog/anything")).toBeUndefined();
  });
});

describe("matchProducts", () => {
  it("picks the product a competitor signal is actually about", () => {
    const matched = matchProducts(
      "You can now schedule an experiment to stop automatically on a date you pick.",
    );
    expect(matched[0]?.name).toBe("Experiments");
  });

  it("finds nothing rather than guessing when a signal names no product", () => {
    expect(matchProducts("We refreshed our website navigation.")).toEqual([]);
  });

  it("reads a model's own action detail, so a gap claim can be checked", () => {
    const matched = matchProducts(
      "PostHog experiments have no end time, so someone has to stop them by hand.",
    );
    expect(matched.map((product) => product.name)).toContain("Experiments");
  });
});

describe("docUrlsForText", () => {
  const text = "Amplitude now lets you schedule when an experiment stops.";

  it("includes the docs for the named product", () => {
    expect(docUrlsForText(text)).toContain("https://posthog.com/docs/experiments");
  });

  it("stays bounded so one signal cannot fill the prompt", () => {
    const urls = docUrlsForText(text, { maxUrls: 4 });
    expect(urls).toHaveLength(4);
    expect(new Set(urls).size).toBe(4);
  });

  it("gives every matched product an overview page before any gets a second", () => {
    const urls = docUrlsForText(
      "A new experiment variant view, feature flag rollout percentages, and a session replay filter.",
      { maxProducts: 3, maxUrls: 3 },
    );
    expect([...urls].sort()).toEqual([
      "https://posthog.com/docs/experiments",
      "https://posthog.com/docs/feature-flags",
      "https://posthog.com/docs/session-replay",
    ]);
  });

  it("goes deeper into one product's docs when only it matches", () => {
    expect(
      docUrlsForText("A new experiment variant view", { maxUrls: 3, maxCapabilityUrls: 0 }),
    ).toEqual([
      "https://posthog.com/docs/experiments",
      "https://posthog.com/docs/experiments/managing-lifecycle",
      "https://posthog.com/docs/experiments/holdouts",
    ]);
  });

  it("leads with the pages that show where PostHog already schedules things", () => {
    // The Amplitude case: "schedule" reads as an Experiments signal, but the
    // page that keeps the recommendation honest belongs to Feature flags.
    expect(docUrlsForText("Schedule an experiment to stop on a date you pick").slice(0, 2)).toEqual(
      [
        "https://posthog.com/docs/feature-flags/scheduled-flag-changes",
        "https://posthog.com/docs/experiments/managing-lifecycle",
      ],
    );
  });

  it("returns nothing when no product matches, rather than a default page", () => {
    expect(docUrlsForText("We redesigned our pricing page footer.")).toEqual([]);
  });
});
