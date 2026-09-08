import { describe, expect, it } from "vitest";
import { actionLabel, actionTitleParts } from "../src/labels.js";
import { findPostHogProduct } from "../src/posthog/products.js";

describe("findPostHogProduct", () => {
  it("knows the two products whose pages we have checked", () => {
    expect(findPostHogProduct("Experiments")?.url).toBe("https://posthog.com/experiments");
    expect(findPostHogProduct("Feature flags")?.url).toBe("https://posthog.com/feature-flags");
  });

  it("matches however the model cased or spaced the name", () => {
    for (const written of ["feature flags", "FEATURE FLAGS", " Feature  Flags ", "feature flag"]) {
      expect(findPostHogProduct(written)?.label).toBe("Feature flags");
    }
  });

  it("knows nothing it has not been given a URL for", () => {
    for (const unknown of ["Session replay", "Surveys", "", undefined]) {
      expect(findPostHogProduct(unknown)).toBeUndefined();
    }
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

  it("keeps an unknown feature, with no URL to link it to", () => {
    expect(
      actionTitleParts({ type: "consider_enhancing", feature: "Surveys", detail: "A gap." }),
    ).toEqual({ label: "Consider enhancing", feature: { label: "Surveys", url: undefined } });
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
