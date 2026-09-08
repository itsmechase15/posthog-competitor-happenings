import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCompareIndex,
  extractPostHogClaims,
  fetchCompareClaims,
  mentionsPostHog,
} from "../src/competitor/compare.js";
import { COMPETITORS, type Config, type CompetitorConfig } from "../src/config.js";

const config = {
  httpTimeoutMs: 5_000,
  userAgent: "test-agent",
} as Config;

const competitor: CompetitorConfig = {
  ...COMPETITORS.amplitude,
  comparePages: ["https://fixture.invalid/compare/posthog"],
};

function html(body: string): string {
  return `<html><head><title>Fixture vs PostHog</title></head><body><main>${body}</main></body></html>`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mentionsPostHog", () => {
  it("matches however the page spells it", () => {
    expect(mentionsPostHog("PostHog has no scheduled reports.")).toBe(true);
    expect(mentionsPostHog("post hog is open source")).toBe(true);
    expect(mentionsPostHog("Mixpanel and Amplitude both do this.")).toBe(false);
  });
});

describe("extractPostHogClaims", () => {
  const blocks = [
    { heading: "Reporting", paragraph: "PostHog does not offer scheduled reports for teams." },
    { heading: "Reporting", paragraph: "Our own dashboards refresh on a schedule you pick." },
    { heading: "Pricing", paragraph: "PostHog" },
    { heading: "Pricing", paragraph: "PostHog does not offer scheduled reports for teams." },
  ];

  it("keeps only the paragraphs that talk about PostHog", () => {
    const claims = extractPostHogClaims("https://fixture.invalid/compare/posthog", "amplitude", blocks);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toEqual({
      url: "https://fixture.invalid/compare/posthog",
      competitor: "amplitude",
      paragraph: "PostHog does not offer scheduled reports for teams.",
      heading: "Reporting",
    });
  });

  it("drops the table cells and nav fragments a compare page is full of", () => {
    const claims = extractPostHogClaims("u", "amplitude", [
      { heading: null, paragraph: "PostHog: no" },
    ]);
    expect(claims).toEqual([]);
  });
});

describe("fetchCompareClaims", () => {
  it("reads what the competitor says about PostHog off their own page", async () => {
    const spy = vi.fn().mockResolvedValue(
      new Response(
        html(
          "<h2>Experiments</h2><p>PostHog cannot schedule an experiment to stop on its own.</p>",
        ),
        { status: 200, headers: { "content-type": "text/html" } },
      ),
    );
    vi.stubGlobal("fetch", spy);

    const claims = await fetchCompareClaims(config, competitor);

    expect(claims).toHaveLength(1);
    expect(claims[0]?.paragraph).toBe(
      "PostHog cannot schedule an experiment to stop on its own.",
    );
    expect(claims[0]?.heading).toBe("Experiments");
    expect(spy.mock.calls[0]?.[0]).toBe("https://fixture.invalid/compare/posthog");
  });

  it("costs its claims, not the run, when the page will not load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 404 })),
    );
    await expect(fetchCompareClaims(config, competitor)).resolves.toEqual([]);
  });
});

describe("createCompareIndex", () => {
  it("reads a competitor's pages once, however many of their items we analyze", async () => {
    const spy = vi.fn().mockResolvedValue(
      new Response(html("<p>PostHog has no scheduled experiment stop today.</p>"), {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    vi.stubGlobal("fetch", spy);

    const index = createCompareIndex(config);
    const [first, second] = await Promise.all([
      index.claimsFor("amplitude"),
      index.claimsFor("amplitude"),
    ]);

    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe("https://amplitude.com/compare/posthog");
  });
});
