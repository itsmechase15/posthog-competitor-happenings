import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isUnreachable, PostgresStore, sslConfigFor, unreachableHint } from "../src/db/pg.js";
import type { CandidateItem, CompetitorId, PageKind, PostHogPage } from "../src/types.js";

/**
 * Runs the real SQL against an embedded Postgres over the wire protocol, so
 * the queries and the committed migration are checked together rather than
 * only being exercised against a hand-written fake.
 */
const PORT = 55_432;
/**
 * Every migration, in order, so this suite runs against the schema a real
 * database would have. 003 is applied on top of 001 rather than folded into
 * it, which is also how it reaches production.
 */
const migrations = ["001_init.sql", "003_docs_corpus.sql"].map((name) =>
  readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), "utf8"),
);

let db: PGlite;
let server: PGLiteSocketServer;
let store: PostgresStore;

beforeAll(async () => {
  db = await PGlite.create();
  for (const migration of migrations) await db.exec(migration);
  server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1" });
  await server.start();
  store = new PostgresStore(`postgres://postgres@127.0.0.1:${PORT}/postgres`);
}, 60_000);

afterAll(async () => {
  await store?.close();
  await server?.stop();
  await db?.close();
});

/** A corpus row with the bookkeeping columns filled in, so a case says only its point. */
function corpusPage(
  overrides: Partial<PostHogPage> & { url: string; text: string },
): PostHogPage {
  const fetchedAt = overrides.fetchedAt ?? new Date("2026-01-01T00:00:00Z");
  return {
    title: "",
    mentions: [] as CompetitorId[],
    kind: "docs" as PageKind,
    contentHash: "hash",
    changedAt: fetchedAt,
    discoveredFrom: ["sitemap"],
    etag: null,
    lastModified: null,
    missingStreak: 0,
    lastUsedAt: null,
    retiredAt: null,
    ...overrides,
    fetchedAt,
  };
}

function item(externalId: string, overrides: Partial<CandidateItem> = {}): CandidateItem {
  return {
    competitor: "mixpanel",
    source: "changelog",
    externalId,
    title: `Release ${externalId}`,
    url: `https://fixture.invalid/${externalId}`,
    publishedAt: new Date("2026-01-15T00:00:00Z"),
    raw: { body: "fixture body" },
    ...overrides,
  };
}

describe("sslConfigFor", () => {
  it("turns TLS off for local databases, however the host is spelled", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      expect(sslConfigFor(`postgres://postgres@${host}:5432/postgres`)).toBe(false);
    }
  });

  it("turns TLS off when the connection string disables it", () => {
    expect(sslConfigFor("postgres://user@db.example.com/postgres?sslmode=disable")).toBe(false);
  });

  it("relaxes verification for hosted databases by default", () => {
    expect(sslConfigFor("postgres://user@db.supabase.co:5432/postgres")).toEqual({
      rejectUnauthorized: false,
    });
  });

  it("verifies the chain when asked to", () => {
    expect(sslConfigFor("postgres://user@db.supabase.co:5432/postgres", true)).toBe(true);
  });
});

describe("isUnreachable", () => {
  function withCode(code: string): Error {
    return Object.assign(new Error(code), { code });
  }

  it("recognises a socket that never opened", () => {
    for (const code of ["ENETUNREACH", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT"]) {
      expect(isUnreachable(withCode(code))).toBe(true);
    }
  });

  it("recognises a failed TLS handshake", () => {
    expect(isUnreachable(withCode("SELF_SIGNED_CERT_IN_CHAIN"))).toBe(true);
    expect(isUnreachable(new Error("The server does not support SSL connections"))).toBe(true);
  });

  it("looks inside the pair of errors a dual-stack attempt reports", () => {
    const both = new AggregateError(
      [withCode("ENETUNREACH"), withCode("ECONNREFUSED")],
      "connect failed",
    );
    expect(isUnreachable(both)).toBe(true);
  });

  it("leaves a query Postgres understood alone", () => {
    // Undefined table and wrong password are bugs, not reachability.
    expect(isUnreachable(withCode("42P01"))).toBe(false);
    expect(isUnreachable(withCode("28P01"))).toBe(false);
  });
});

describe("unreachableHint", () => {
  it("names the pooler for a Supabase direct connection", () => {
    const hint = unreachableHint("postgres://postgres:pw@db.abcdefghij.supabase.co:5432/postgres");
    expect(hint).toMatch(/pooler\.supabase\.com/);
    // The host belongs to the secret; the hint must not repeat any of it.
    expect(hint).not.toMatch(/abcdefghij|pw/);
  });

  it("has nothing to add about any other host", () => {
    expect(unreachableHint("postgres://user@db.example.com:5432/postgres")).toBeNull();
    expect(unreachableHint("host=localhost port=5432")).toBeNull();
  });
});

describe("PostgresStore", () => {
  it("inserts new items and ignores duplicates", async () => {
    expect(await store.insertNewItems([item("a"), item("b")])).toHaveLength(2);
    expect(await store.insertNewItems([item("b"), item("c")])).toHaveLength(1);
  });

  it("scopes the unique constraint to competitor and source", async () => {
    const inserted = await store.insertNewItems([
      item("a", { competitor: "amplitude" }),
      item("a", { source: "blog" }),
    ]);
    expect(inserted).toHaveLength(2);
  });

  it("reports which keys it already has", async () => {
    const known = await store.findKnownKeys([item("a"), item("does-not-exist")]);
    expect([...known]).toEqual(["mixpanel|changelog|a"]);
  });

  it("counts items per competitor and source", async () => {
    expect(await store.countItems("mixpanel", "changelog")).toBe(3);
    expect(await store.countItems("mixpanel", "newsletter")).toBe(0);
  });

  it("hands back the id of an item it has already stored", async () => {
    const [stored] = await store.insertNewItems([item("id-lookup")]);
    expect(await store.findItemId(item("id-lookup"))).toBe(stored!.id);
    expect(await store.findItemId(item("never-stored"))).toBeNull();
  });

  it("records an analysis and stamps the Slack post", async () => {
    const [stored] = await store.insertNewItems([item("analysis-target")]);
    const analysisId = await store.recordAnalysis({
      itemId: stored!.id,
      model: "claude-opus-5",
      analysis: {
        impact: "notable",
        summary: "s",
        keyPoints: ["k"],
        actions: [{ type: "update_pages", detail: "d" }],
        posthogRefs: [{ url: "https://posthog.com/compare/x", claim: "c", suggestedEdit: "e" }],
        openQuestions: [],
      },
      image: { url: "https://cdn.invalid/a.png", altText: "alt", origin: "page" },
      issues: [
        {
          action: { type: "update_pages", detail: "d" },
          issue: { url: "https://github.com/o/r/issues/1", number: 1 },
        },
      ],
    });

    // Until it is stamped, the next run must see it as still owing a message.
    const pending = await store.getUnpostedAnalyses(new Date("2020-01-01T00:00:00Z"), 10);
    expect(pending.map((row) => row.analysisId)).toContain(analysisId);

    const postedAt = new Date("2026-01-16T15:00:00Z");
    await store.markSlackPosted(analysisId, postedAt);

    const afterPosting = await store.getUnpostedAnalyses(new Date("2020-01-01T00:00:00Z"), 10);
    expect(afterPosting.map((row) => row.analysisId)).not.toContain(analysisId);

    const rows = await db.query<{
      severity: string;
      slack_posted_at: string | Date;
      analysis: {
        actions: Array<{ type: string }>;
        impact: string;
        image: { url: string };
        issues: Array<{ type: string; issue: { number: number } | null }>;
      };
    }>("select severity, slack_posted_at, analysis from analyses where id::text = $1", [
      analysisId,
    ]);
    const row = rows.rows[0];
    expect(row?.analysis.impact).toBe("notable");
    expect(row?.analysis.actions).toEqual([{ type: "update_pages", detail: "d" }]);
    expect(row?.analysis.image.url).toBe("https://cdn.invalid/a.png");
    // One stored entry per action, so a retry links what this run opened.
    expect(row?.analysis.issues).toEqual([
      { type: "update_pages", issue: { url: "https://github.com/o/r/issues/1", number: 1 } },
    ]);
    // The legacy column keeps the impact token so no migration is needed.
    expect(row?.severity).toBe("notable");
    expect(new Date(row!.slack_posted_at).toISOString()).toBe(postedAt.toISOString());
  });

  it("rebuilds the full item and analysis for a retry", async () => {
    const [stored] = await store.insertNewItems([
      item("retry-target", { source: "blog", raw: { body: "fixture body", description: "d" } }),
    ]);
    await store.recordAnalysis({
      itemId: stored!.id,
      model: "claude-opus-5",
      analysis: {
        impact: "major",
        summary: "s",
        keyPoints: [],
        actions: [
          { type: "new_compare_page", detail: "d" },
          { type: "consider_enhancing", feature: "Experiments", detail: "d2" },
        ],
        posthogRefs: [{ url: "https://posthog.com/compare/y", claim: "c" }],
        openQuestions: [],
      },
      image: { url: "https://cdn.invalid/b.png", altText: "alt", origin: "screenshot" },
      issues: [
        {
          action: { type: "new_compare_page", detail: "d" },
          issue: { url: "https://github.com/o/r/issues/2", number: 2 },
        },
        {
          action: { type: "consider_enhancing", feature: "Experiments", detail: "d2" },
          issue: { url: "https://github.com/o/r/issues/3", number: 3 },
        },
      ],
    });

    const pending = await store.getUnpostedAnalyses(new Date("2020-01-01T00:00:00Z"), 10);
    const target = pending.find((row) => row.item.externalId === "retry-target");
    expect(target).toBeDefined();
    expect(target?.model).toBe("claude-opus-5");
    expect(target?.analysis.impact).toBe("major");
    expect(target?.analysis.actions.map((action) => action.type)).toEqual([
      "new_compare_page",
      "consider_enhancing",
    ]);
    expect(target?.analysis.actions[1]?.feature).toBe("Experiments");
    expect(target?.analysis.posthogRefs[0]?.url).toBe("https://posthog.com/compare/y");
    // A retry re-posts the same picture and links the issues this run opened,
    // one per action, rather than opening a second set.
    expect(target?.image).toEqual({
      url: "https://cdn.invalid/b.png",
      altText: "alt",
      origin: "screenshot",
    });
    expect(target?.issues.map((entry) => entry.issue?.number)).toEqual([2, 3]);
    expect(target?.issues.map((entry) => entry.action.type)).toEqual([
      "new_compare_page",
      "consider_enhancing",
    ]);
    expect(target?.item).toMatchObject({
      competitor: "mixpanel",
      source: "blog",
      title: "Release retry-target",
      raw: { body: "fixture body", description: "d" },
    });
  });

  it("still reads a phase 1 row that stored severity and no image", async () => {
    const [stored] = await store.insertNewItems([item("legacy-target")]);
    await db.query(
      `insert into analyses (item_id, severity, analysis, model)
       values ((select id from items where external_id = 'legacy-target'), 'notable', $1::jsonb, 'claude-opus-5')`,
      [
        JSON.stringify({
          severity: "notable",
          summary: "s",
          action: "update_pages",
          action_detail: "d",
          posthog_refs: [],
        }),
      ],
    );
    expect(stored).toBeDefined();

    const pending = await store.getUnpostedAnalyses(new Date("2020-01-01T00:00:00Z"), 10);
    const target = pending.find((row) => row.item.externalId === "legacy-target");
    expect(target?.analysis.impact).toBe("notable");
    // A row written before `actions` existed reads back as a list of one.
    expect(target?.analysis.actions).toEqual([{ type: "update_pages", detail: "d" }]);
    expect(target?.image).toBeNull();
    expect(target?.issues).toEqual([
      { action: { type: "update_pages", detail: "d" }, issue: null },
    ]);
  });

  it("reads a row from before the split, whose one issue was the whole alert's", async () => {
    await store.insertNewItems([item("single-issue-target")]);
    await db.query(
      `insert into analyses (item_id, severity, analysis, model)
       values ((select id from items where external_id = 'single-issue-target'), 'notable', $1::jsonb, 'claude-opus-5')`,
      [
        JSON.stringify({
          impact: "notable",
          summary: "s",
          actions: [
            { type: "update_pages", detail: "d" },
            { type: "consider_building", detail: "d2" },
          ],
          issue: { url: "https://github.com/o/r/issues/9", number: 9 },
        }),
      ],
    );

    const pending = await store.getUnpostedAnalyses(new Date("2020-01-01T00:00:00Z"), 10);
    const target = pending.find((row) => row.item.externalId === "single-issue-target");
    // The one issue belonged to the first action, so that is where it lands.
    expect(target?.issues.map((entry) => entry.issue?.number ?? null)).toEqual([9, null]);
  });

  it("ignores analyses older than the retry window", async () => {
    const pending = await store.getUnpostedAnalyses(new Date("2099-01-01T00:00:00Z"), 10);
    expect(pending).toHaveLength(0);
  });

  it("saves a page with everything known about it, and overwrites it next time", async () => {
    const url = "https://posthog.com/compare/best-mixpanel-alternatives";
    await store.savePage(
      corpusPage({
        url,
        title: "Old title",
        text: "old",
        mentions: ["mixpanel"],
        kind: "marketing",
        contentHash: "one",
        fetchedAt: new Date("2026-01-01T00:00:00Z"),
      }),
    );
    await store.savePage(
      corpusPage({
        url,
        title: "New title",
        text: "new",
        mentions: ["mixpanel", "amplitude"],
        kind: "marketing",
        contentHash: "two",
        etag: '"abc"',
        fetchedAt: new Date("2026-01-15T00:00:00Z"),
        changedAt: new Date("2026-01-15T00:00:00Z"),
      }),
    );

    const [stored] = await store.getPages([url]);
    expect(stored).toMatchObject({
      title: "New title",
      text: "new",
      mentions: ["mixpanel", "amplitude"],
      kind: "marketing",
      contentHash: "two",
      etag: '"abc"',
    });
    expect(stored?.fetchedAt.toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });

  it("lists every row without its body, which is what the refresh plans against", async () => {
    const meta = await store.listPageMeta();
    const row = meta.find((entry) => entry.url.includes("best-mixpanel-alternatives"));

    expect(row?.contentHash).toBe("two");
    expect(row).not.toHaveProperty("text");
  });

  it("reads back the pages analysis asks for by URL, and skips the rest", async () => {
    const docsUrl = "https://posthog.com/docs/experiments/managing-lifecycle";
    await store.savePage(
      corpusPage({
        url: docsUrl,
        title: "Managing the experiment lifecycle",
        text: "You stop an experiment by hand.",
        fetchedAt: new Date("2026-01-20T00:00:00Z"),
      }),
    );

    const pages = await store.getPages([docsUrl, "https://posthog.com/docs/never-indexed"]);

    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      url: docsUrl,
      title: "Managing the experiment lifecycle",
      text: "You stop an experiment by hand.",
      mentions: [],
      kind: "docs",
    });
    expect(await store.getPages([])).toEqual([]);
  });

  it("records that a page was checked and had not moved, without touching its body", async () => {
    const url = "https://posthog.com/docs/unchanged";
    await store.savePage(
      corpusPage({ url, text: "the stored body", fetchedAt: new Date("2026-01-01T00:00:00Z") }),
    );

    await store.touchPage(url, new Date("2026-02-01T00:00:00Z"));

    const [stored] = await store.getPages([url]);
    expect(stored?.text).toBe("the stored body");
    expect(stored?.fetchedAt.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  describe("the corpus bookkeeping", () => {
    const listed = "https://posthog.com/docs/still-listed";
    const dropped = "https://posthog.com/docs/dropped";
    const used = "https://posthog.com/docs/used-by-an-analyst";
    const at = new Date("2026-03-01T00:00:00Z");

    it("resets a streak, raises another, retires a page, and stamps what was used", async () => {
      for (const url of [listed, dropped, used]) {
        await store.savePage(corpusPage({ url, text: "t", missingStreak: 1 }));
      }

      await store.recordCorpusRun({
        seen: [{ url: listed, sources: ["sitemap", "llms"] }],
        missing: [dropped],
        retired: [dropped],
        used: [used],
        at,
      });

      const byUrl = new Map((await store.listPageMeta()).map((row) => [row.url, row]));
      expect(byUrl.get(listed)?.missingStreak).toBe(0);
      expect(byUrl.get(listed)?.discoveredFrom).toEqual(["llms", "sitemap"]);
      expect(byUrl.get(dropped)?.missingStreak).toBe(2);
      expect(byUrl.get(dropped)?.retiredAt?.toISOString()).toBe(at.toISOString());
      expect(byUrl.get(used)?.lastUsedAt?.toISOString()).toBe(at.toISOString());
    });

    it("leaves a retired page out of the corpus but keeps the row", async () => {
      const live = (await store.loadCorpus()).map((page) => page.url);
      expect(live).not.toContain(dropped);
      expect((await store.listPageMeta()).map((row) => row.url)).toContain(dropped);
    });

    it("brings a page back the moment a body is written for it again", async () => {
      await store.savePage(corpusPage({ url: dropped, text: "it is back" }));
      expect((await store.loadCorpus()).map((page) => page.url)).toContain(dropped);
    });

    it("loads only the kinds it was asked for", async () => {
      const marketing = await store.loadCorpus(["marketing"]);
      expect(marketing.every((page) => page.kind === "marketing")).toBe(true);
      expect(marketing.length).toBeGreaterThan(0);
    });
  });

  it("replaces a page's claims instead of appending", async () => {
    const url = "https://posthog.com/compare/best-mixpanel-alternatives";
    const claim = { url, competitor: "mixpanel" as const, paragraph: "one", heading: "Pricing" };
    await store.replaceClaimsForUrl(url, [claim]);
    await store.replaceClaimsForUrl(url, [{ ...claim, paragraph: "two" }]);

    const claims = await store.getClaims("mixpanel", 10);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ paragraph: "two", heading: "Pricing" });
  });

  it("ranks a page about the competitor above one that only name-drops it", async () => {
    const pages: Array<[string, string]> = [
      [
        "https://posthog.com/compare/best-fullstory-alternatives",
        "a very long paragraph that merely mentions Amplitude in passing and keeps going",
      ],
      ["https://posthog.com/blog/posthog-vs-amplitude", "short but on topic"],
      ["https://posthog.com/compare/best-amplitude-alternatives", "also short"],
    ];

    for (const [url, paragraph] of pages) {
      await store.savePage(corpusPage({ url, title: url, text: "t", mentions: ["amplitude"] }));
      await store.replaceClaimsForUrl(url, [
        { url, competitor: "amplitude", paragraph, heading: null },
      ]);
    }

    expect((await store.getClaims("amplitude", 5)).map((claim) => claim.url)).toEqual([
      "https://posthog.com/compare/best-amplitude-alternatives",
      "https://posthog.com/blog/posthog-vs-amplitude",
      "https://posthog.com/compare/best-fullstory-alternatives",
    ]);
  });

  it("ranks comparison pages ahead of docs pages", async () => {
    const docsUrl = "https://posthog.com/docs/migrate/mixpanel";
    await store.savePage(
      corpusPage({ url: docsUrl, title: "Migrate", text: "t", mentions: ["mixpanel"] }),
    );
    await store.replaceClaimsForUrl(docsUrl, [
      {
        url: docsUrl,
        competitor: "mixpanel",
        paragraph: "a much longer docs paragraph that would otherwise sort first",
        heading: null,
      },
    ]);

    const claims = await store.getClaims("mixpanel", 10);
    expect(claims[0]?.url).toContain("/compare/");
  });
});
