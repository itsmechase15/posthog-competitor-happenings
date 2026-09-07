import { randomUUID } from "node:crypto";
import type {
  CandidateItem,
  CompetitorId,
  PostHogClaim,
  PostHogPage,
  SourceId,
  StoredItem,
} from "../types.js";
import { itemKey, type PendingPost, type RecordAnalysisInput, type Store } from "./store.js";

/**
 * Non-persistent store used when `DATABASE_URL` is unset. It lets a dry run
 * exercise the whole pipeline with no live secrets — at the cost of treating
 * every item as new, since nothing survives the process.
 */
export class MemoryStore implements Store {
  private readonly items = new Map<string, StoredItem>();
  private readonly pages = new Map<string, PostHogPage>();
  private readonly claims: PostHogClaim[] = [];

  async insertNewItems(items: CandidateItem[]): Promise<StoredItem[]> {
    const inserted: StoredItem[] = [];
    for (const item of items) {
      const key = itemKey(item);
      if (this.items.has(key)) continue;
      const stored: StoredItem = { ...item, id: randomUUID() };
      this.items.set(key, stored);
      inserted.push(stored);
    }
    return inserted;
  }

  async findKnownKeys(items: CandidateItem[]): Promise<Set<string>> {
    return new Set(items.map(itemKey).filter((key) => this.items.has(key)));
  }

  async countItems(competitor: CompetitorId, source: SourceId): Promise<number> {
    let count = 0;
    for (const item of this.items.values()) {
      if (item.competitor === competitor && item.source === source) count += 1;
    }
    return count;
  }

  async recordAnalysis(_input: RecordAnalysisInput): Promise<string> {
    return randomUUID();
  }

  async markSlackPosted(_analysisId: string, _postedAt: Date): Promise<void> {
    // Nothing to persist.
  }

  async getUnpostedAnalyses(): Promise<PendingPost[]> {
    // Analyses are never persisted here, so there is never a backlog.
    return [];
  }

  async getIndexedPageUrls(): Promise<Map<string, Date>> {
    return new Map([...this.pages.values()].map((page) => [page.url, page.fetchedAt]));
  }

  async upsertPage(page: PostHogPage): Promise<void> {
    this.pages.set(page.url, page);
  }

  async replaceClaimsForUrl(url: string, claims: PostHogClaim[]): Promise<void> {
    for (let index = this.claims.length - 1; index >= 0; index -= 1) {
      if (this.claims[index]?.url === url) this.claims.splice(index, 1);
    }
    this.claims.push(...claims);
  }

  async getClaims(competitor: CompetitorId, limit: number): Promise<PostHogClaim[]> {
    const rank = (url: string): number => {
      if (url.includes("/compare/")) return 0;
      if (url.includes("posthog-vs-")) return 1;
      if (url.includes("/docs/")) return 3;
      return 2;
    };
    return this.claims
      .filter((claim) => claim.competitor === competitor)
      .sort((a, b) => rank(a.url) - rank(b.url) || b.paragraph.length - a.paragraph.length)
      .slice(0, limit);
  }

  async close(): Promise<void> {
    // Nothing to close.
  }
}
