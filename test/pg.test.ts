import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isUnreachable, PostgresStore, sslConfigFor, unreachableHint } from "../src/db/pg.js";
import type { CandidateItem } from "../src/types.js";

/**
 * Runs the real SQL against an embedded Postgres over the wire protocol, so
 * the queries and the committed migration are checked together rather than
 * only being exercised against a hand-written fake.
 */
const PORT = 55_432;
const migration = readFileSync(
  fileURLToPath(new URL("../migrations/001_init.sql", import.meta.url)),
  "utf8",
);

let db: PGlite;
let server: PGLiteSocketServer;
let store: PostgresStore;

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(migration);
  server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1" });
  await server.start();
  store = new PostgresStore(`postgres://postgres@127.0.0.1:${PORT}/postgres`);
}, 60_000);

afterAll(async () => {
  await store?.close();
  await server?.stop();
  await db?.close();
});

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
      issue: { url: "https://github.com/o/r/issues/1", number: 1 },
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
        issue: { number: number };
      };
    }>("select severity, slack_posted_at, analysis from analyses where id::text = $1", [
      analysisId,
    ]);
    const row = rows.rows[0];
    expect(row?.analysis.impact).toBe("notable");
    expect(row?.analysis.actions).toEqual([{ type: "update_pages", detail: "d" }]);
    expect(row?.analysis.image.url).toBe("https://cdn.invalid/a.png");
    expect(row?.analysis.issue.number).toBe(1);
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
      issue: { url: "https://github.com/o/r/issues/2", number: 2 },
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
    // A retry re-posts the same picture and links the same issue.
    expect(target?.image).toEqual({
      url: "https://cdn.invalid/b.png",
      altText: "alt",
      origin: "screenshot",
    });
    expect(target?.issue).toEqual({ url: "https://github.com/o/r/issues/2", number: 2 });
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
    expect(target?.issue).toBeNull();
  });

  it("ignores analyses older than the retry window", async () => {
    const pending = await store.getUnpostedAnalyses(new Date("2099-01-01T00:00:00Z"), 10);
    expect(pending).toHaveLength(0);
  });

  it("upserts pages and reports when each was fetched", async () => {
    const url = "https://posthog.com/compare/best-mixpanel-alternatives";
    await store.upsertPage({
      url,
      title: "Old title",
      text: "old",
      mentions: ["mixpanel"],
      fetchedAt: new Date("2026-01-01T00:00:00Z"),
    });
    await store.upsertPage({
      url,
      title: "New title",
      text: "new",
      mentions: ["mixpanel", "amplitude"],
      fetchedAt: new Date("2026-01-15T00:00:00Z"),
    });

    const indexed = await store.getIndexedPageUrls();
    expect(indexed.get(url)?.toISOString()).toBe("2026-01-15T00:00:00.000Z");

    const rows = await db.query<{ title: string; mentions: string[] }>(
      "select title, mentions from pages where url = $1",
      [url],
    );
    expect(rows.rows[0]?.title).toBe("New title");
    expect(rows.rows[0]?.mentions).toEqual(["mixpanel", "amplitude"]);
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
      await store.upsertPage({ url, title: url, text: "t", mentions: ["amplitude"], fetchedAt: new Date() });
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
    await store.upsertPage({
      url: docsUrl,
      title: "Migrate",
      text: "t",
      mentions: ["mixpanel"],
      fetchedAt: new Date(),
    });
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
