import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config.js";
import { MemoryStore } from "../src/db/memory.js";
import {
  isDue,
  planBookkeeping,
  planRefresh,
  refreshDocsCorpus,
  RETIRE_AFTER_MISSING_RUNS,
  splitLlmsFull,
} from "../src/posthog/corpus.js";
import type { Discovery } from "../src/posthog/discover.js";
import type { PageMeta, PostHogPage } from "../src/types.js";
import { page } from "./helpers.js";

const config = {
  httpTimeoutMs: 5_000,
  userAgent: "test-agent",
  posthogMaxPages: 100,
  posthogRefreshDays: 14,
  docsHotRefreshDays: 3,
  docsFetchConcurrency: 2,
  skipPosthogIndex: false,
  docsSitemaps: ["https://posthog.com/sitemap/sitemap-0.xml"],
  docsLlmsTxt: undefined,
  docsLlmsFullTxt: undefined,
  posthogChangelogIndex: undefined,
} as unknown as Config;

const NOW = new Date("2026-02-01T00:00:00Z");

function meta(overrides: Partial<PageMeta> & { url: string }): PageMeta {
  const { text: _text, mentions: _mentions, ...rest } = page({ url: overrides.url, text: "x" });
  return { ...rest, ...overrides };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isDue", () => {
  it("reads a URL nothing has ever read, whatever tier it would land in", () => {
    expect(isDue(meta({ url: "u", contentHash: "", fetchedAt: NOW }), config, NOW)).toBe(true);
  });

  it("keeps a page an analyst read lately close to current", () => {
    const recentlyUsed = meta({
      url: "u",
      fetchedAt: new Date("2026-01-27T00:00:00Z"),
      lastUsedAt: new Date("2026-01-31T00:00:00Z"),
    });
    // Five days old, and in the hot tier because something reasoned against it.
    expect(isDue(recentlyUsed, config, NOW)).toBe(true);
  });

  it("leaves the rest of the corpus on the fortnightly tier", () => {
    const cold = meta({ url: "u", fetchedAt: new Date("2026-01-27T00:00:00Z"), lastUsedAt: null });
    expect(isDue(cold, config, NOW)).toBe(false);
    expect(isDue({ ...cold, fetchedAt: new Date("2026-01-10T00:00:00Z") }, config, NOW)).toBe(true);
  });
});

describe("planRefresh", () => {
  const discoveries: Discovery[] = [
    { url: "https://posthog.com/docs/new", kind: "docs", sources: ["sitemap"] },
    { url: "https://posthog.com/docs/old", kind: "docs", sources: ["sitemap"] },
    { url: "https://posthog.com/docs/older", kind: "docs", sources: ["sitemap"] },
    { url: "https://posthog.com/docs/current", kind: "docs", sources: ["sitemap"] },
  ];
  const held = new Map<string, PageMeta>([
    ["https://posthog.com/docs/old", meta({ url: "x", fetchedAt: new Date("2026-01-10T00:00:00Z") })],
    [
      "https://posthog.com/docs/older",
      meta({ url: "x", fetchedAt: new Date("2026-01-01T00:00:00Z") }),
    ],
    [
      "https://posthog.com/docs/current",
      meta({ url: "x", fetchedAt: new Date("2026-01-31T00:00:00Z") }),
    ],
  ]);

  it("reads a URL the corpus has never held, because a new page is why we looked", () => {
    expect(planRefresh(discoveries, held, config, NOW).fresh).toEqual([
      "https://posthog.com/docs/new",
    ]);
  });

  it("puts the oldest copy first, so a short budget goes on the furthest from the truth", () => {
    expect(planRefresh(discoveries, held, config, NOW).due).toEqual([
      "https://posthog.com/docs/older",
      "https://posthog.com/docs/old",
    ]);
  });

  it("spends the budget on new pages before stale ones, and says what it deferred", () => {
    const plan = planRefresh(discoveries, held, { ...config, posthogMaxPages: 2 }, NOW);
    expect(plan.fresh).toEqual(["https://posthog.com/docs/new"]);
    expect(plan.due).toEqual(["https://posthog.com/docs/older"]);
    expect(plan.deferred).toBe(1);
  });
});

describe("planBookkeeping", () => {
  const offered: Discovery[] = [
    { url: "https://posthog.com/docs/still-listed", kind: "docs", sources: ["sitemap", "llms"] },
  ];

  it("resets the streak on a URL a source still offers", () => {
    const held = new Map([
      ["https://posthog.com/docs/still-listed", meta({ url: "x", missingStreak: 1 })],
    ]);
    const plan = planBookkeeping(offered, held, [], NOW);

    expect(plan.seen).toEqual([
      { url: "https://posthog.com/docs/still-listed", sources: ["sitemap", "llms"] },
    ]);
    expect(plan.retired).toEqual([]);
  });

  it("gives a page one run's grace before retiring it", () => {
    // One sitemap that lags a deploy is a bad reason to forget a page.
    const firstMiss = new Map([["https://posthog.com/docs/gone", meta({ url: "x", missingStreak: 0 })]]);
    expect(planBookkeeping(offered, firstMiss, [], NOW).retired).toEqual([]);
    expect(planBookkeeping(offered, firstMiss, [], NOW).missing).toEqual([
      "https://posthog.com/docs/gone",
    ]);
  });

  it("retires a page missing from every source twice running", () => {
    const secondMiss = new Map([
      [
        "https://posthog.com/docs/gone",
        meta({ url: "x", missingStreak: RETIRE_AFTER_MISSING_RUNS - 1 }),
      ],
    ]);
    expect(planBookkeeping(offered, secondMiss, [], NOW).retired).toEqual([
      "https://posthog.com/docs/gone",
    ]);
  });

  it("retires a page that answered 404 without waiting for a second run", () => {
    const plan = planBookkeeping(offered, new Map(), ["https://posthog.com/docs/deleted"], NOW);
    expect(plan.retired).toEqual(["https://posthog.com/docs/deleted"]);
  });
});

describe("splitLlmsFull", () => {
  it("splits on the lines that are a URL and nothing else", () => {
    const sections = splitLlmsFull(`# Experiments
https://posthog.com/docs/experiments
Experiments test a change against a control group.

# Surveys
https://posthog.com/docs/surveys
Surveys collect answers.`);

    expect(sections).toHaveLength(2);
    expect(sections[0]?.url).toBe("https://posthog.com/docs/experiments");
    expect(sections[0]?.title).toBe("Experiments");
    expect(sections[0]?.text).toContain("control group");
  });

  it("yields nothing for a file with no URLs to anchor on, rather than guessing", () => {
    expect(splitLlmsFull("# Just a heading\nand some prose")).toEqual([]);
  });
});

/**
 * The refresh against a stubbed posthog.com.
 *
 * The catalog pins its own URLs into discovery, so a run always reaches more
 * than the sitemap lists. Everything the sitemap does not offer answers 404
 * here, and the assertions are about one named page rather than about the
 * totals, which is the honest way to test a corpus that has a floor.
 */
describe("refreshDocsCorpus", () => {
  const EXPERIMENTS = "https://posthog.com/docs/experiments";
  const HOLDOUTS = "https://posthog.com/docs/experiments/holdouts";

  const sitemap = `<?xml version="1.0"?><urlset><url><loc>${EXPERIMENTS}</loc></url></urlset>`;

  function stubFetch(handler: (url: string, init: RequestInit | undefined) => Response | null) {
    const spy = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("sitemap")) return Promise.resolve(new Response(sitemap, { status: 200 }));
      const answer = handler(url.replace(/\.md$/, ""), init);
      return Promise.resolve(answer ?? new Response("not here", { status: 404 }));
    });
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  const held = (result: { pages: PostHogPage[] }, url: string) =>
    result.pages.find((entry) => entry.url === url);

  it("reads what the sitemap offers and makes it the corpus", async () => {
    const store = new MemoryStore();
    stubFetch((url) =>
      url === EXPERIMENTS
        ? new Response("---\ntitle: Experiments\n---\n\nExperiments test a change.", {
            status: 200,
            headers: { etag: '"abc"' },
          })
        : null,
    );

    const stored = held(await refreshDocsCorpus(config, store, NOW), EXPERIMENTS);

    expect(stored?.title).toBe("Experiments");
    expect(stored?.text).toContain("Experiments test a change");
    expect(stored?.etag).toBe('"abc"');
    expect(stored?.kind).toBe("docs");
  });

  it("costs a round trip and no body when the server says the page has not moved", async () => {
    const store = new MemoryStore();
    await store.savePage(
      page({
        url: EXPERIMENTS,
        text: "Experiments test a change.",
        etag: '"abc"',
        fetchedAt: new Date("2026-01-01T00:00:00Z"),
      }),
    );

    const conditional: string[] = [];
    stubFetch((url, init) => {
      if (url !== EXPERIMENTS) return null;
      conditional.push(new Headers(init?.headers).get("if-none-match") ?? "");
      return new Response(null, { status: 304 });
    });

    const result = await refreshDocsCorpus(config, store, NOW);

    expect(conditional).toContain('"abc"');
    expect(result.unchangedByEtag).toBeGreaterThanOrEqual(1);
    // The stored body is still the corpus: a 304 means what we hold is current.
    expect(held(result, EXPERIMENTS)?.text).toBe("Experiments test a change.");
  });

  it("separates a page that was looked at from one that moved", async () => {
    const store = new MemoryStore();
    const body = "---\ntitle: Experiments\n---\n\nExperiments test a change.";
    stubFetch((url) => (url === EXPERIMENTS ? new Response(body, { status: 200 }) : null));

    await refreshDocsCorpus(config, store, NOW);
    const later = new Date("2026-03-01T00:00:00Z");
    const stored = held(await refreshDocsCorpus(config, store, later), EXPERIMENTS);

    expect(stored?.fetchedAt).toEqual(later);
    // Read again, but not changed, so "changed lately" still means something.
    expect(stored?.changedAt).toEqual(NOW);
  });

  it("records a page that really did move", async () => {
    const store = new MemoryStore();
    let body = "---\ntitle: Experiments\n---\n\nExperiments test a change.";
    stubFetch((url) => (url === EXPERIMENTS ? new Response(body, { status: 200 }) : null));

    await refreshDocsCorpus(config, store, NOW);
    body = "---\ntitle: Experiments\n---\n\nExperiments now stop on a schedule.";
    const later = new Date("2026-03-01T00:00:00Z");
    const stored = held(await refreshDocsCorpus(config, store, later), EXPERIMENTS);

    expect(stored?.changedAt).toEqual(later);
    expect(stored?.text).toContain("stop on a schedule");
  });

  it("drops a page that answers 404 out of the corpus", async () => {
    const store = new MemoryStore();
    await store.savePage(page({ url: EXPERIMENTS, text: "old copy" }));
    stubFetch(() => null);

    const result = await refreshDocsCorpus(
      { ...config, posthogRefreshDays: 0, docsHotRefreshDays: 0 },
      store,
      NOW,
    );

    expect(result.gone).toBeGreaterThanOrEqual(1);
    expect(held(result, EXPERIMENTS)).toBeUndefined();
  });

  it("reasons against what is stored when the refresh is switched off", async () => {
    const store = new MemoryStore();
    await store.savePage(page({ url: EXPERIMENTS, text: "stored" }));
    const spy = stubFetch(() => null);

    const result = await refreshDocsCorpus({ ...config, skipPosthogIndex: true }, store, NOW);

    expect(spy).not.toHaveBeenCalled();
    expect(result.pages).toHaveLength(1);
    expect(result.notes[0]).toContain("refresh skipped");
  });

  it("reaches a page only another page links to", async () => {
    const store = new MemoryStore();
    stubFetch((url) => {
      if (url === HOLDOUTS) {
        return new Response("---\ntitle: Holdouts\n---\n\nHoldouts keep users out.", {
          status: 200,
        });
      }
      if (url === EXPERIMENTS) {
        return new Response(
          "---\ntitle: Experiments\n---\n\nSee [holdouts](/docs/experiments/holdouts) for more.",
          { status: 200 },
        );
      }
      return null;
    });

    // The sitemap never lists holdouts and the catalog does not pin it, so the
    // only way in is the link on the page that was read.
    expect(held(await refreshDocsCorpus(config, store, NOW), HOLDOUTS)).toBeDefined();
  });

  it("keeps the run when the sitemap cannot be read at all", async () => {
    const store = new MemoryStore();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("nope", { status: 404 }))),
    );

    const result = await refreshDocsCorpus(config, store, NOW);

    expect(result.pages).toEqual([]);
    expect(result.notes.some((note) => note.includes("unreadable"))).toBe(true);
  });
});
