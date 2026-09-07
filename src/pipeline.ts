import { analyzeItems, createAnalyzer } from "./analysis/analyze.js";
import type { Config } from "./config.js";
import { createStore } from "./db/index.js";
import { itemKey, type Store } from "./db/store.js";
import { createLogger } from "./log.js";
import { refreshPostHogIndex } from "./posthog/index.js";
import { buildSlackMessage } from "./slack/message.js";
import { ConsolePoster, WebhookPoster, type SlackPoster } from "./slack/post.js";
import { enrichArticles } from "./sources/enrich.js";
import { collectCandidates, groupBySourceKey } from "./sources/index.js";
import type { CandidateItem, StoredItem } from "./types.js";
import { daysAgo } from "./util/text.js";

const log = createLogger("pipeline");

export interface RunSummary {
  candidates: number;
  newItems: number;
  seeded: number;
  analyzed: number;
  posted: number;
  notes: string[];
}

function createPoster(config: Config): SlackPoster {
  if (config.dryRun) return new ConsolePoster("dry run");
  if (!config.slackWebhookUrl) return new ConsolePoster("SLACK_WEBHOOK_URL unset");
  return new WebhookPoster(config.slackWebhookUrl, config.httpTimeoutMs);
}

/** Items with no date are kept: a missing date is not evidence of staleness. */
function withinLookback(item: CandidateItem, since: Date): boolean {
  return item.publishedAt === null || item.publishedAt >= since;
}

/**
 * Decide which new items to analyze. The first time we see a competitor+source
 * pair its whole backlog looks new, so that batch is recorded and skipped
 * instead of being fired at Slack all at once.
 */
async function selectForAnalysis(
  config: Config,
  store: Store,
  candidates: CandidateItem[],
): Promise<{ toAnalyze: StoredItem[]; seeded: number; newItems: number }> {
  const since = daysAgo(config.lookbackDays);
  const known = await store.findKnownKeys(candidates);
  const seenThisRun = new Set<string>();

  const unseen = candidates.filter((item) => {
    const key = itemKey(item);
    if (known.has(key) || seenThisRun.has(key)) return false;
    seenThisRun.add(key);
    return true;
  });

  const toAnalyze: StoredItem[] = [];
  let seeded = 0;
  let newItems = 0;

  for (const group of groupBySourceKey(unseen).values()) {
    const existing = await store.countItems(group.competitor, group.source);
    const isSeedRun = existing === 0 && !config.forceAnalyze;

    const accepted = isSeedRun
      ? group.items
      : group.items
          .filter((item) => withinLookback(item, since))
          .sort(
            (a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
          )
          .slice(0, config.maxItemsPerSource);

    // Seed runs never reach analysis, so there is nothing to enrich for.
    const prepared = isSeedRun ? accepted : await enrichArticles(config, accepted);
    const stored = await store.insertNewItems(prepared);
    newItems += stored.length;

    if (isSeedRun) {
      seeded += stored.length;
      log.info(
        `${group.competitor}/${group.source}: first run, recorded ${stored.length} existing items without alerting`,
      );
      continue;
    }

    toAnalyze.push(...stored);
  }

  toAnalyze.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));

  if (toAnalyze.length > config.maxItemsPerRun) {
    log.warn(
      `capping this run at ${config.maxItemsPerRun} of ${toAnalyze.length} new items (MAX_ITEMS_PER_RUN)`,
    );
  }

  return { toAnalyze: toAnalyze.slice(0, config.maxItemsPerRun), seeded, newItems };
}

export async function runCycle(config: Config): Promise<RunSummary> {
  const store = createStore(config);
  const poster = createPoster(config);
  const summary: RunSummary = {
    candidates: 0,
    newItems: 0,
    seeded: 0,
    analyzed: 0,
    posted: 0,
    notes: [],
  };

  try {
    try {
      await refreshPostHogIndex(config, store);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`PostHog index refresh failed: ${message}`);
      summary.notes.push(`posthog-index: failed (${message})`);
    }

    const collection = await collectCandidates(config);
    summary.candidates = collection.candidates.length;
    summary.notes.push(...collection.notes);
    log.info(`collected ${collection.candidates.length} candidates`);

    const selection = await selectForAnalysis(config, store, collection.candidates);
    summary.newItems = selection.newItems;
    summary.seeded = selection.seeded;
    log.info(`${selection.toAnalyze.length} new items to analyze`);

    const analyzer = createAnalyzer(config);
    const analyzed = await analyzeItems(selection.toAnalyze, store, analyzer);
    summary.analyzed = analyzed.length;

    for (const entry of analyzed) {
      const analysisId = await store.recordAnalysis({
        itemId: entry.item.id,
        analysis: entry.analysis,
        model: entry.model,
      });
      try {
        await poster.post(buildSlackMessage(entry));
        await store.markSlackPosted(analysisId, new Date());
        summary.posted += 1;
      } catch (error) {
        log.error(
          `failed to post ${entry.item.url} to Slack`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    return summary;
  } finally {
    await store.close();
  }
}
