import { describe, expect, it } from "vitest";
import { isDocsUrl, isMarketingTarget } from "../src/posthog/pages.js";
import { CANONICAL_DOC_URLS, POSTHOG_PRODUCTS } from "../src/posthog/products.js";

describe("isDocsUrl", () => {
  it("knows a docs page from a page that sells one", () => {
    expect(isDocsUrl("https://posthog.com/docs/experiments")).toBe(true);
    expect(isDocsUrl("https://posthog.com/docs")).toBe(true);
    expect(isDocsUrl("https://posthog.com/experiments")).toBe(false);
    expect(isDocsUrl("https://posthog.com/compare/best-amplitude-alternatives")).toBe(false);
  });
});

describe("isMarketingTarget", () => {
  it("allows the pages marketing writes", () => {
    for (const url of [
      "https://posthog.com/compare/best-amplitude-alternatives",
      "https://posthog.com/blog/posthog-vs-mixpanel",
      "https://posthog.com/pricing",
      "https://posthog.com/experiments",
      "https://posthog.com/customers/researchgate",
    ]) {
      expect(isMarketingTarget(url)).toBe(true);
    }
  });

  it("refuses every docs page, which is evidence rather than copy", () => {
    for (const url of CANONICAL_DOC_URLS) {
      expect(isMarketingTarget(url)).toBe(false);
    }
  });

  it("allows every product page the catalog links", () => {
    for (const product of POSTHOG_PRODUCTS) {
      if (!product.url) continue;
      expect(isMarketingTarget(product.url)).toBe(true);
    }
  });

  it("refuses the pages nobody would edit for a competitor launch", () => {
    for (const url of [
      "https://posthog.com/handbook/brand/tone",
      "https://posthog.com/questions/how-do-i-schedule-an-experiment",
      "https://posthog.com/careers",
    ]) {
      expect(isMarketingTarget(url)).toBe(false);
    }
  });

  it("refuses a page PostHog does not own", () => {
    expect(isMarketingTarget("https://mixpanel.com/compare/posthog")).toBe(false);
    expect(isMarketingTarget("not a url")).toBe(false);
  });
});
