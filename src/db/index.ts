import type { Config } from "../config.js";
import { createLogger } from "../log.js";
import { MemoryStore } from "./memory.js";
import { PostgresStore } from "./pg.js";
import { itemKey, type Store } from "./store.js";

const log = createLogger("db");

export interface CreateStoreOptions {
  /**
   * Permit the in-memory store when `DATABASE_URL` is unset. On by default for
   * dry runs and single-item verification; off for the daily run, where a
   * missing database would silently re-alert everything tomorrow.
   */
  allowMemoryFallback?: boolean;
}

export function createStore(config: Config, options: CreateStoreOptions = {}): Store {
  if (!config.databaseUrl) {
    if (!config.dryRun && !options.allowMemoryFallback) {
      throw new Error("DATABASE_URL is required unless DRY_RUN=true");
    }
    log.warn("DATABASE_URL is unset — using an in-memory store, nothing will persist");
    return new MemoryStore();
  }

  if (config.dryRun) {
    log.info("dry run: reading from Postgres, writes are skipped");
    return new ReadOnlyStore(new PostgresStore(config.databaseUrl));
  }

  return new PostgresStore(config.databaseUrl);
}

/**
 * Wraps a store so a dry run can read real dedupe and PostHog-index state
 * without leaving anything behind. Writes are dropped; inserted items get
 * throwaway ids so the rest of the pipeline still runs end to end.
 */
class ReadOnlyStore implements Store {
  constructor(private readonly inner: Store) {}

  async insertNewItems(items: Parameters<Store["insertNewItems"]>[0]) {
    if (items.length === 0) return [];
    const known = await this.inner.findKnownKeys(items);
    return items
      .filter((item) => {
        const key = itemKey(item);
        if (known.has(key)) return false;
        known.add(key);
        return true;
      })
      .map((item, index) => ({ ...item, id: `dry-run-${index + 1}` }));
  }

  findKnownKeys(...args: Parameters<Store["findKnownKeys"]>) {
    return this.inner.findKnownKeys(...args);
  }

  countItems(...args: Parameters<Store["countItems"]>) {
    return this.inner.countItems(...args);
  }

  async recordAnalysis() {
    return "dry-run-analysis";
  }

  async markSlackPosted() {
    // No-op in dry run.
  }

  getUnpostedAnalyses(...args: Parameters<Store["getUnpostedAnalyses"]>) {
    return this.inner.getUnpostedAnalyses(...args);
  }

  getIndexedPageUrls() {
    return this.inner.getIndexedPageUrls();
  }

  async upsertPage() {
    // No-op in dry run.
  }

  async replaceClaimsForUrl() {
    // No-op in dry run.
  }

  getClaims(...args: Parameters<Store["getClaims"]>) {
    return this.inner.getClaims(...args);
  }

  close() {
    return this.inner.close();
  }
}

export { MemoryStore, PostgresStore };
export type { Store };
