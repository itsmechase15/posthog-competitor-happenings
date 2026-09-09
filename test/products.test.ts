import { describe, expect, it } from "vitest";
import { actionLabel, actionTitleParts } from "../src/labels.js";
import {
  CANONICAL_DOC_URLS,
  docUrlsForText,
  findPostHogProduct,
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

  it("labels every product once, so an action's feature maps to one thing", () => {
    const labels = POSTHOG_PRODUCTS.map((product) => product.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("gives every product a docs page and a way to be recognised", () => {
    for (const product of POSTHOG_PRODUCTS) {
      expect(product.docs.length).toBeGreaterThan(0);
      expect(product.keywords.length).toBeGreaterThan(0);
    }
  });

  it("only carries a product page URL where posthog.com has one", () => {
    for (const product of POSTHOG_PRODUCTS) {
      if (product.url === undefined) continue;
      expect(product.url).toMatch(/^https:\/\/posthog\.com\/[a-z-]+$/);
      expect(product.url).not.toContain("/docs/");
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

  it("carries every tool named on platform.md", () => {
    const labels = POSTHOG_PRODUCTS.map((product) => product.label);
    for (const tool of [
      "Product analytics",
      "Web analytics",
      "Session replay",
      "Feature flags",
      "Experiments",
      "Error tracking",
      "Surveys",
      "AI observability",
      "Logs",
      "Data warehouse",
      "CDP",
      "Endpoints",
      "Workflows",
      "PostHog AI",
      "Support",
      "Customer analytics",
      "Replay Vision",
    ]) {
      expect(labels).toContain(tool);
    }
  });

  it("still answers to the names those tools used to have", () => {
    expect(findPostHogProduct("LLM analytics")?.label).toBe("AI observability");
    expect(findPostHogProduct("Data pipelines")?.label).toBe("CDP");
    expect(findPostHogProduct("Max AI")?.label).toBe("PostHog AI");
  });

  it("marks the surfaces that sit under the tools rather than beside them", () => {
    expect(findPostHogProduct("Reverse proxy")?.kind).toBe("platform");
    expect(findPostHogProduct("Experiments")?.kind).toBe("product");
  });
});

describe("the reverse proxy, which is the surface #44 got wrong", () => {
  const firstPartyDomains =
    "First-Party Domains: send Mixpanel events through a subdomain you own, so ad blockers and tracking protection stop dropping them. Set a CNAME on your custom domain and Mixpanel handles the TLS certificate.";

  it("puts the proxy docs in front of the model for a first-party-domain launch", () => {
    const urls = docUrlsForText(firstPartyDomains);
    expect(urls).toContain("https://posthog.com/docs/advanced/proxy");
    expect(urls).toContain("https://posthog.com/docs/advanced/proxy/managed-reverse-proxy");
  });

  it("reads the launch as being about the reverse proxy", () => {
    expect(matchProducts(firstPartyDomains)[0]?.label).toBe("Reverse proxy");
  });

  it("resolves the surface however a model names it", () => {
    for (const written of [
      "Reverse proxy",
      "Managed reverse proxy",
      "First-party domains",
      "PostHog managed reverse proxy",
    ]) {
      expect(findProductByName(written)?.label).toBe("Reverse proxy");
    }
  });

  it("maps the proxy docs back to it, so an issue can name the pages", () => {
    expect(productForDocUrl("https://posthog.com/docs/advanced/proxy")?.label).toBe(
      "Reverse proxy",
    );
  });
});

describe("findPostHogProduct", () => {
  it("carries the product page for a product that has one", () => {
    expect(findPostHogProduct("Experiments")?.url).toBe("https://posthog.com/experiments");
    expect(findPostHogProduct("Feature flags")?.url).toBe("https://posthog.com/feature-flags");
    expect(findPostHogProduct("Session replay")?.url).toBe("https://posthog.com/session-replay");
  });

  it("matches however the model cased or spaced the name", () => {
    for (const written of ["feature flags", "FEATURE FLAGS", " Feature  Flags ", "feature flag"]) {
      expect(findPostHogProduct(written)?.label).toBe("Feature flags");
    }
  });

  it("leaves the URL off a product PostHog has no page for", () => {
    const revenue = findPostHogProduct("Revenue analytics");
    expect(revenue?.label).toBe("Revenue analytics");
    expect(revenue?.url).toBeUndefined();
  });

  it("knows nothing about a name that is not a PostHog product", () => {
    for (const unknown of ["Time travel", "", undefined]) {
      expect(findPostHogProduct(unknown)).toBeUndefined();
    }
  });
});

describe("findProductByName", () => {
  it("reads the feature a model named, however it phrased it", () => {
    expect(findProductByName("Experiments")?.label).toBe("Experiments");
    expect(findProductByName("experiments")?.label).toBe("Experiments");
    expect(findProductByName("PostHog Experiments (A/B testing)")?.label).toBe("Experiments");
    expect(findProductByName("Session replay")?.label).toBe("Session replay");
  });

  it("returns nothing for a feature we hold no docs for", () => {
    expect(findProductByName("Time travel")).toBeUndefined();
    expect(findProductByName("")).toBeUndefined();
  });
});

describe("productForDocUrl", () => {
  it("maps a docs page back to the product it documents", () => {
    expect(productForDocUrl("https://posthog.com/docs/experiments/managing-lifecycle")?.label).toBe(
      "Experiments",
    );
    expect(
      productForDocUrl("https://posthog.com/docs/feature-flags/scheduled-flag-changes")?.label,
    ).toBe("Feature flags");
    expect(productForDocUrl("https://posthog.com/blog/anything")).toBeUndefined();
  });
});

describe("matchProducts", () => {
  it("picks the product a competitor signal is actually about", () => {
    const matched = matchProducts(
      "You can now schedule an experiment to stop automatically on a date you pick.",
    );
    expect(matched[0]?.label).toBe("Experiments");
  });

  it("finds nothing rather than guessing when a signal names no product", () => {
    expect(matchProducts("We refreshed our website navigation.")).toEqual([]);
  });

  it("reads a model's own action detail, so a gap claim can be checked", () => {
    const matched = matchProducts(
      "PostHog experiments have no end time, so someone has to stop them by hand.",
    );
    expect(matched.map((product) => product.label)).toContain("Experiments");
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

describe("actionTitleParts", () => {
  it("carries the product URL for a feature it recognizes", () => {
    expect(
      actionTitleParts({ type: "consider_enhancing", feature: "experiments", detail: "A gap." }),
    ).toEqual({
      label: "Consider enhancing",
      feature: { label: "Experiments", url: "https://posthog.com/experiments" },
    });
  });

  it("writes a product with no page of its own in PostHog's casing, unlinked", () => {
    expect(
      actionTitleParts({
        type: "consider_enhancing",
        feature: "revenue analytics",
        detail: "A gap.",
      }),
    ).toEqual({
      label: "Consider enhancing",
      feature: { label: "Revenue analytics", url: undefined },
    });
  });

  it("keeps an unknown feature as the model wrote it, with no URL to link it to", () => {
    expect(
      actionTitleParts({ type: "consider_enhancing", feature: "Time travel", detail: "A gap." }),
    ).toEqual({ label: "Consider enhancing", feature: { label: "Time travel", url: undefined } });
  });

  it("names no feature for the three actions that do not have one", () => {
    expect(actionTitleParts({ type: "update_pages", detail: "Stale." })).toEqual({
      label: "Update pages",
    });
  });
});

describe("actionLabel", () => {
  it("writes the product in PostHog's casing wherever the title is plain text", () => {
    expect(
      actionLabel({ type: "consider_enhancing", feature: "feature flags", detail: "A gap." }),
    ).toBe("Consider enhancing Feature flags");
  });
});
