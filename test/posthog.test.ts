import { describe, expect, it } from "vitest";
import {
  candidatePriority,
  detectMentions,
  extractClaims,
  isIndexCandidate,
} from "../src/posthog/index.js";
import { extractPage } from "../src/util/html.js";

describe("isIndexCandidate", () => {
  it("accepts marketing and docs pages on posthog.com", () => {
    expect(isIndexCandidate("https://posthog.com/compare/best-mixpanel-alternatives")).toBe(true);
    expect(isIndexCandidate("https://posthog.com/blog/posthog-vs-amplitude")).toBe(true);
    expect(isIndexCandidate("https://posthog.com/docs/migrate/mixpanel")).toBe(true);
  });

  it("rejects community Q&A, which is not editable marketing copy", () => {
    expect(isIndexCandidate("https://posthog.com/questions/posthog-and-mixpanel")).toBe(false);
  });

  it("rejects other hosts", () => {
    expect(isIndexCandidate("https://mixpanel.com/blog/anything")).toBe(false);
  });
});

describe("candidatePriority", () => {
  it("puts named comparison pages ahead of everything else", () => {
    const ranked = [
      "https://posthog.com/blog/some-unrelated-post",
      "https://posthog.com/compare/best-mixpanel-alternatives",
      "https://posthog.com/docs/migrate/amplitude",
      "https://posthog.com/compare/generic",
    ].sort((a, b) => candidatePriority(a) - candidatePriority(b));

    expect(ranked[0]).toBe("https://posthog.com/compare/best-mixpanel-alternatives");
    expect(ranked[1]).toBe("https://posthog.com/docs/migrate/amplitude");
  });
});

describe("detectMentions", () => {
  it("finds competitors case-insensitively", () => {
    expect(detectMentions("Coming from Mixpanel or AMPLITUDE?")).toEqual(["mixpanel", "amplitude"]);
  });

  it("returns nothing when no competitor is named", () => {
    expect(detectMentions("PostHog is an analytics platform.")).toEqual([]);
  });
});

describe("extractPage + extractClaims", () => {
  const html = `<!doctype html><html><head><title>PostHog vs Mixpanel</title></head>
    <body>
      <nav><a href="/pricing">Pricing</a></nav>
      <main>
        <h2>Pricing</h2>
        <p>Mixpanel charges per monthly tracked user, which gets expensive once you instrument every event you care about.</p>
        <p>PostHog bills on events ingested, and the first million every month are free for everyone.</p>
        <ul><li>Short</li><li>Amplitude also charges per monthly tracked user, on a similar curve to the one above.</li></ul>
        <script>var tracking = 1;</script>
      </main>
      <footer><p>Some footer text mentioning Mixpanel for navigation purposes only.</p></footer>
    </body></html>`;

  const page = extractPage(html);

  it("reads the page's own description when it declares one", () => {
    const withMeta = extractPage(
      `<html><head><meta property="og:description" content="How the two compare."></head><body><p>Body copy that is long enough to keep.</p></body></html>`,
    );
    expect(withMeta.description).toBe("How the two compare.");
  });

  it("takes the title and drops chrome", () => {
    expect(page.title).toBe("PostHog vs Mixpanel");
    expect(page.text).not.toContain("Pricing</a>");
    expect(page.text).not.toContain("var tracking");
    expect(page.text).not.toContain("footer text");
  });

  it("tags paragraphs with the nearest heading", () => {
    expect(page.blocks[0]).toMatchObject({ heading: "Pricing" });
  });

  it("keeps only competitor-mentioning paragraphs as claims", () => {
    const claims = extractClaims("https://posthog.com/blog/posthog-vs-mixpanel", page.blocks);
    expect(claims.map((claim) => claim.competitor)).toEqual(["mixpanel", "amplitude"]);
    expect(claims[0]?.heading).toBe("Pricing");
    expect(claims.every((claim) => claim.url.startsWith("https://posthog.com/"))).toBe(true);
  });

  it("skips short list items that are really navigation", () => {
    const claims = extractClaims("https://posthog.com/blog/posthog-vs-mixpanel", page.blocks);
    expect(claims.some((claim) => claim.paragraph === "Short")).toBe(false);
  });
});
