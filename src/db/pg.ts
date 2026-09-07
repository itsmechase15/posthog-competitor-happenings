import pg from "pg";
import { analysisSchema, normalizeAnalysis } from "../analysis/schema.js";
import { createLogger } from "../log.js";
import type {
  CandidateItem,
  CompetitorId,
  PostHogClaim,
  PostHogPage,
  SourceId,
  StoredItem,
} from "../types.js";
import { itemKey, type PendingPost, type RecordAnalysisInput, type Store } from "./store.js";

const log = createLogger("db");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", ""]);

/**
 * Hosted Postgres (Supabase included) requires TLS but often presents a chain
 * the default Node trust store does not recognise, so verification is relaxed
 * unless `DATABASE_SSL_STRICT` asks for it. Local databases get no TLS at all,
 * because they typically do not offer it.
 */
export function sslConfigFor(
  connectionString: string,
  strict = process.env.DATABASE_SSL_STRICT === "true",
): pg.PoolConfig["ssl"] {
  let host = "";
  let sslmode: string | null = null;
  try {
    const url = new URL(connectionString);
    host = url.hostname;
    sslmode = url.searchParams.get("sslmode");
  } catch {
    // Not a URL (e.g. a key/value DSN); fall through to the TLS default.
  }

  if (sslmode === "disable" || LOCAL_HOSTS.has(host)) return false;
  return strict ? true : { rejectUnauthorized: false };
}

export class PostgresStore implements Store {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({
      connectionString,
      max: 4,
      ssl: sslConfigFor(connectionString),
    });
  }

  async insertNewItems(items: CandidateItem[]): Promise<StoredItem[]> {
    if (items.length === 0) return [];
    const inserted: StoredItem[] = [];

    for (const item of items) {
      const result = await this.pool.query<{ id: string }>(
        `INSERT INTO items (competitor, source, external_id, title, url, published_at, raw)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (competitor, source, external_id) DO NOTHING
         RETURNING id::text`,
        [
          item.competitor,
          item.source,
          item.externalId,
          item.title,
          item.url,
          item.publishedAt,
          JSON.stringify(item.raw),
        ],
      );
      const row = result.rows[0];
      if (row) inserted.push({ ...item, id: row.id });
    }

    return inserted;
  }

  async findKnownKeys(items: CandidateItem[]): Promise<Set<string>> {
    if (items.length === 0) return new Set();
    const result = await this.pool.query<{
      competitor: CompetitorId;
      source: SourceId;
      external_id: string;
    }>(
      `SELECT competitor, source, external_id
       FROM items
       WHERE (competitor, source, external_id) IN (
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
       )`,
      [
        items.map((item) => item.competitor),
        items.map((item) => item.source),
        items.map((item) => item.externalId),
      ],
    );
    return new Set(
      result.rows.map((row) =>
        itemKey({ competitor: row.competitor, source: row.source, externalId: row.external_id }),
      ),
    );
  }

  async countItems(competitor: CompetitorId, source: SourceId): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM items WHERE competitor = $1 AND source = $2",
      [competitor, source],
    );
    return Number.parseInt(result.rows[0]?.count ?? "0", 10);
  }

  async recordAnalysis(input: RecordAnalysisInput): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO analyses (item_id, severity, analysis, model)
       VALUES ($1, $2, $3::jsonb, $4)
       RETURNING id::text`,
      [input.itemId, input.analysis.severity, JSON.stringify(input.analysis), input.model],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error(`failed to record analysis for item ${input.itemId}`);
    return id;
  }

  async markSlackPosted(analysisId: string, postedAt: Date): Promise<void> {
    await this.pool.query("UPDATE analyses SET slack_posted_at = $2 WHERE id::text = $1", [
      analysisId,
      postedAt,
    ]);
  }

  async getUnpostedAnalyses(since: Date, limit: number): Promise<PendingPost[]> {
    const result = await this.pool.query<{
      analysis_id: string;
      analysis: unknown;
      model: string;
      item_id: string;
      competitor: CompetitorId;
      source: SourceId;
      external_id: string;
      title: string;
      url: string;
      published_at: Date | null;
      raw: Record<string, unknown> | null;
    }>(
      `SELECT a.id::text AS analysis_id, a.analysis, a.model,
              i.id::text AS item_id, i.competitor, i.source, i.external_id,
              i.title, i.url, i.published_at, i.raw
       FROM analyses a
       JOIN items i ON i.id = a.item_id
       WHERE a.slack_posted_at IS NULL AND a.created_at >= $1
       ORDER BY a.created_at ASC
       LIMIT $2`,
      [since, limit],
    );

    const pending: PendingPost[] = [];
    for (const row of result.rows) {
      try {
        pending.push({
          analysisId: row.analysis_id,
          model: row.model,
          analysis: normalizeAnalysis(analysisSchema.parse(row.analysis)),
          item: {
            id: row.item_id,
            competitor: row.competitor,
            source: row.source,
            externalId: row.external_id,
            title: row.title,
            url: row.url,
            publishedAt: row.published_at,
            raw: row.raw ?? {},
          },
        });
      } catch (error) {
        // A row we cannot parse is not worth failing the run over; it would
        // only ever have produced a malformed message.
        log.warn(`skipping unreadable analysis ${row.analysis_id}`, error);
      }
    }
    return pending;
  }

  async getIndexedPageUrls(): Promise<Map<string, Date>> {
    const result = await this.pool.query<{ url: string; fetched_at: Date | null }>(
      "SELECT url, fetched_at FROM pages",
    );
    const map = new Map<string, Date>();
    for (const row of result.rows) {
      map.set(row.url, row.fetched_at ?? new Date(0));
    }
    return map;
  }

  async upsertPage(page: PostHogPage): Promise<void> {
    await this.pool.query(
      `INSERT INTO pages (url, title, text, mentions, fetched_at)
       VALUES ($1, $2, $3, $4::text[], $5)
       ON CONFLICT (url) DO UPDATE
         SET title = EXCLUDED.title,
             text = EXCLUDED.text,
             mentions = EXCLUDED.mentions,
             fetched_at = EXCLUDED.fetched_at`,
      [page.url, page.title, page.text, page.mentions, page.fetchedAt],
    );
  }

  async replaceClaimsForUrl(url: string, claims: PostHogClaim[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM claims WHERE url = $1", [url]);
      for (const claim of claims) {
        await client.query(
          "INSERT INTO claims (url, competitor, paragraph, heading) VALUES ($1, $2, $3, $4)",
          [claim.url, claim.competitor, claim.paragraph, claim.heading],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getClaims(competitor: CompetitorId, limit: number): Promise<PostHogClaim[]> {
    const result = await this.pool.query<{
      url: string;
      competitor: CompetitorId;
      paragraph: string;
      heading: string | null;
    }>(
      `SELECT url, competitor, paragraph, heading
       FROM claims
       WHERE competitor = $1
       ORDER BY
         CASE
           WHEN url LIKE '%/compare/%' THEN 0
           WHEN url LIKE '%posthog-vs-%' THEN 1
           WHEN url LIKE '%/docs/%' THEN 3
           ELSE 2
         END,
         length(paragraph) DESC
       LIMIT $2`,
      [competitor, limit],
    );
    return result.rows.map((row) => ({
      url: row.url,
      competitor: row.competitor,
      paragraph: row.paragraph,
      heading: row.heading,
    }));
  }

  async close(): Promise<void> {
    await this.pool.end().catch((error: unknown) => {
      log.warn("failed to close pool cleanly", error);
    });
  }
}
