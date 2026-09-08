import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/db/memory.js";
import type { CandidateItem } from "../src/types.js";

function item(externalId: string): CandidateItem {
  return {
    competitor: "mixpanel",
    source: "changelog",
    externalId,
    title: externalId,
    url: `https://fixture.invalid/${externalId}`,
    publishedAt: null,
    raw: {},
  };
}

describe("MemoryStore", () => {
  it("returns only items it has not seen before", async () => {
    const store = new MemoryStore();
    expect(await store.insertNewItems([item("a"), item("b")])).toHaveLength(2);
    expect(await store.insertNewItems([item("b"), item("c")])).toHaveLength(1);
  });

  it("dedupes within a single batch", async () => {
    const store = new MemoryStore();
    expect(await store.insertNewItems([item("a"), item("a")])).toHaveLength(1);
  });

  it("reports which keys are already known", async () => {
    const store = new MemoryStore();
    await store.insertNewItems([item("a")]);
    const known = await store.findKnownKeys([item("a"), item("b")]);
    expect([...known]).toEqual(["mixpanel|changelog|a"]);
  });

  it("hands back the id of an item it has already stored", async () => {
    const store = new MemoryStore();
    const [stored] = await store.insertNewItems([item("a")]);
    expect(await store.findItemId(item("a"))).toBe(stored!.id);
    expect(await store.findItemId(item("b"))).toBeNull();
  });

  it("counts items per competitor and source", async () => {
    const store = new MemoryStore();
    await store.insertNewItems([item("a"), item("b")]);
    expect(await store.countItems("mixpanel", "changelog")).toBe(2);
    expect(await store.countItems("amplitude", "changelog")).toBe(0);
  });

  it("ranks a page about the competitor above one that only name-drops it", async () => {
    const store = new MemoryStore();
    const claim = (url: string, paragraph: string) => ({
      url,
      competitor: "amplitude" as const,
      paragraph,
      heading: null,
    });

    // A long paragraph on an unrelated comparison page must not outrank the
    // Amplitude pages just for being long.
    await store.replaceClaimsForUrl("https://posthog.com/compare/best-fullstory-alternatives", [
      claim(
        "https://posthog.com/compare/best-fullstory-alternatives",
        "a very long paragraph that merely mentions Amplitude in passing and goes on for a while",
      ),
    ]);
    await store.replaceClaimsForUrl("https://posthog.com/blog/posthog-vs-amplitude", [
      claim("https://posthog.com/blog/posthog-vs-amplitude", "short but on topic"),
    ]);
    await store.replaceClaimsForUrl("https://posthog.com/compare/best-amplitude-alternatives", [
      claim("https://posthog.com/compare/best-amplitude-alternatives", "also short"),
    ]);

    expect((await store.getClaims("amplitude", 5)).map((c) => c.url)).toEqual([
      "https://posthog.com/compare/best-amplitude-alternatives",
      "https://posthog.com/blog/posthog-vs-amplitude",
      "https://posthog.com/compare/best-fullstory-alternatives",
    ]);
  });

  it("ranks comparison-page claims ahead of docs", async () => {
    const store = new MemoryStore();
    await store.replaceClaimsForUrl("https://posthog.com/docs/migrate/mixpanel", [
      {
        url: "https://posthog.com/docs/migrate/mixpanel",
        competitor: "mixpanel",
        paragraph: "docs claim",
        heading: null,
      },
    ]);
    await store.replaceClaimsForUrl("https://posthog.com/compare/best-mixpanel-alternatives", [
      {
        url: "https://posthog.com/compare/best-mixpanel-alternatives",
        competitor: "mixpanel",
        paragraph: "compare claim",
        heading: null,
      },
    ]);

    const claims = await store.getClaims("mixpanel", 5);
    expect(claims.map((claim) => claim.paragraph)).toEqual(["compare claim", "docs claim"]);
  });

  it("replaces claims for a URL rather than appending", async () => {
    const store = new MemoryStore();
    const url = "https://posthog.com/blog/posthog-vs-mixpanel";
    const claim = { url, competitor: "mixpanel" as const, paragraph: "one", heading: null };
    await store.replaceClaimsForUrl(url, [claim]);
    await store.replaceClaimsForUrl(url, [{ ...claim, paragraph: "two" }]);
    expect((await store.getClaims("mixpanel", 5)).map((c) => c.paragraph)).toEqual(["two"]);
  });
});
