import { describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { MemoryStore } from "../src/db/memory.js";
import { createStore } from "../src/db/index.js";
import type { CandidateItem } from "../src/types.js";
import { page } from "./helpers.js";

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

  it("remembers which days the channel heard that nothing shipped", async () => {
    const store = new MemoryStore();
    const at = new Date("2026-09-24T18:00:51Z");

    expect(await store.quietDayNoteSent("2026-09-24")).toBe(false);
    await store.recordQuietDayNote("2026-09-24", at);

    expect(await store.quietDayNoteSent("2026-09-24")).toBe(true);
    expect(await store.quietDayNoteSent("2026-09-25")).toBe(false);
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

describe("MemoryStore as a corpus", () => {
  const url = "https://posthog.com/docs/experiments";

  it("holds a page and hands it back as the live corpus", async () => {
    const store = new MemoryStore();
    await store.savePage(page({ url, text: "Experiments test a change." }));

    expect((await store.loadCorpus()).map((entry) => entry.url)).toEqual([url]);
    expect((await store.listPageMeta())[0]).not.toHaveProperty("text");
  });

  it("loads only the kinds it was asked for", async () => {
    const store = new MemoryStore();
    await store.savePage(page({ url, text: "docs" }));
    await store.savePage(
      page({ url: "https://posthog.com/pricing", kind: "marketing", text: "copy" }),
    );

    expect(await store.loadCorpus(["marketing"])).toHaveLength(1);
  });

  it("keeps the last-used stamp when a page is re-read", async () => {
    // It is what puts a page in the short refresh tier, and a fresh read
    // carries no opinion about when something last reasoned against it.
    const store = new MemoryStore();
    const used = new Date("2026-02-01T00:00:00Z");
    await store.savePage(page({ url, text: "one" }));
    await store.recordCorpusRun({ seen: [], missing: [], retired: [], used: [url], at: used });
    await store.savePage(page({ url, text: "two" }));

    expect((await store.listPageMeta())[0]?.lastUsedAt).toEqual(used);
  });

  it("takes a retired page out of the corpus and puts it back when it returns", async () => {
    const store = new MemoryStore();
    const at = new Date("2026-02-01T00:00:00Z");
    await store.savePage(page({ url, text: "one" }));
    await store.recordCorpusRun({ seen: [], missing: [], retired: [url], used: [], at });

    expect(await store.loadCorpus()).toEqual([]);
    expect(await store.listPageMeta()).toHaveLength(1);

    await store.savePage(page({ url, text: "it is back" }));
    expect(await store.loadCorpus()).toHaveLength(1);
  });

  it("records a check that found nothing changed without touching the body", async () => {
    const store = new MemoryStore();
    await store.savePage(page({ url, text: "the stored body" }));
    const at = new Date("2026-02-01T00:00:00Z");

    await store.touchPage(url, at);

    const [stored] = await store.loadCorpus();
    expect(stored?.text).toBe("the stored body");
    expect(stored?.fetchedAt).toEqual(at);
  });
});

describe("createStore", () => {
  const config = (overrides: Partial<Config>): Config =>
    ({ dryRun: false, databaseUrl: undefined, ...overrides }) as Config;

  // Nothing listens on port 1, so every connection is refused immediately.
  const unreachable = "postgres://postgres@127.0.0.1:1/postgres";

  it("insists on a database for the daily run", () => {
    expect(() => createStore(config({}))).toThrow(/DATABASE_URL is required/);
  });

  it("keeps a force post going when the database cannot be reached", async () => {
    const store = createStore(config({ databaseUrl: unreachable }), {
      allowMemoryFallback: true,
    });
    try {
      // The insert falls back, and everything after it stays on the fallback.
      const [stored] = await store.insertNewItems([item("unreachable")]);
      expect(stored?.id).toBeTruthy();
      expect(await store.findItemId(item("unreachable"))).toBe(stored?.id);
      expect(await store.countItems("mixpanel", "changelog")).toBe(1);
    } finally {
      await store.close();
    }
  });

  it("fails the daily run instead, so tomorrow does not re-alert everything", async () => {
    const store = createStore(config({ databaseUrl: unreachable }));
    try {
      await expect(store.insertNewItems([item("unreachable")])).rejects.toThrow();
    } finally {
      await store.close();
    }
  });
});
