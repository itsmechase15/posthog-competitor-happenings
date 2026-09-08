import type { Config } from "../config.js";
import type { Store } from "../db/store.js";
import { createLogger } from "../log.js";
import type { PostHogDoc, PostHogPage, StoredItem } from "../types.js";
import { extractPage, proseText } from "../util/html.js";
import { fetchText } from "../util/http.js";
import { sentences, titleFromUrl, truncate } from "../util/text.js";
import { docUrlsForText, matchProducts } from "./products.js";

const log = createLogger("posthog-docs");

/** Per-doc excerpt budget. Enough to show what a product already does. */
const MAX_EXCERPT_CHARS = 900;
/** How many docs may be fetched live when the index does not have them yet. */
const DEFAULT_MAX_FETCHES = 4;
/** Sentences kept beyond the lead, chosen by relevance to the signal. */
const FOCUS_SENTENCES = 4;

/**
 * Docs fetched during this process, so a run whose page writes go nowhere (a
 * dry run, or an unreachable database) fetches each page once rather than once
 * per item. One run is one process, so nothing here outlives the freshness the
 * index already manages.
 */
const fetched = new Map<string, PostHogPage>();

/** Drops the per-process memo. For tests, which need each case isolated. */
export function clearFetchedDocs(): void {
  fetched.clear();
}

/** Words too common to tell one product's docs from another's. */
const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "announcing",
  "available",
  "every",
  "from",
  "introducing",
  "new",
  "now",
  "posthog",
  "release",
  "shipped",
  "that",
  "their",
  "them",
  "this",
  "which",
  "with",
  "your",
]);

/** The terms an excerpt should be built around: the signal's own vocabulary. */
export function focusTerms(text: string): string[] {
  const fromKeywords = matchProducts(text, 3).flatMap((product) => product.keywords);
  const fromText = text
    .toLowerCase()
    .split(/[^a-z0-9/]+/)
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word));
  return [...new Set([...fromKeywords, ...fromText])];
}

/**
 * Cut a docs page down to the part that speaks to this signal. The lead
 * sentence always survives, because it says what the product is; the rest is
 * picked by how much of the signal's vocabulary it uses. A model reading this
 * should be able to tell "PostHog schedules flag changes" from "PostHog
 * schedules experiment stops" without guessing.
 */
export function docExcerpt(text: string, terms: string[], maxChars = MAX_EXCERPT_CHARS): string {
  const all = sentences(text);
  if (all.length === 0) return "";

  const lead = all[0] ?? "";
  const scored = all.slice(1).map((sentence, index) => {
    const lower = sentence.toLowerCase();
    const score = terms.reduce((total, term) => (lower.includes(term) ? total + 1 : total), 0);
    return { sentence, index, score };
  });

  const picked = scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, FOCUS_SENTENCES)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.sentence);

  return truncate([lead, ...picked].join(" ").trim(), maxChars);
}

function toDoc(page: Pick<PostHogPage, "url" | "title" | "text">, terms: string[]): PostHogDoc {
  return {
    url: page.url,
    title: page.title || titleFromUrl(page.url),
    excerpt: docExcerpt(page.text, terms),
  };
}

export interface DocsContextOptions {
  maxProducts?: number;
  maxUrls?: number;
  maxFetches?: number;
}

/**
 * The PostHog docs that belong in front of the model for one signal.
 *
 * Reads the index first, and fetches at most a handful of pages the index does
 * not have yet — storing what it fetches, so the next run reads it instead.
 * A fetch that fails costs an excerpt, never the run: an alert with thinner
 * docs context is still an alert, and the prompt tells the model to hold back
 * on gap claims it cannot verify.
 */
export async function gatherDocsContext(
  config: Config,
  store: Store,
  item: Pick<StoredItem, "title" | "raw">,
  options: DocsContextOptions = {},
): Promise<PostHogDoc[]> {
  const text = signalText(item);
  const urls = docUrlsForText(text, options);
  if (urls.length === 0) return [];

  const terms = focusTerms(text);
  const indexed = new Map((await store.getPages(urls)).map((page) => [page.url, page]));
  const docs: PostHogDoc[] = [];
  let fetches = 0;
  const maxFetches = options.maxFetches ?? DEFAULT_MAX_FETCHES;

  for (const url of urls) {
    const page = indexed.get(url) ?? fetched.get(url);
    if (page && page.text.trim().length > 0) {
      docs.push(toDoc(page, terms));
      continue;
    }

    if (fetches >= maxFetches) continue;
    fetches += 1;
    const live = await fetchDoc(config, store, url);
    if (live) docs.push(toDoc(live, terms));
  }

  log.info(
    `docs context for "${item.title}": ${docs.length} of ${urls.length} pages (${fetches} fetched live)`,
  );
  return docs;
}

async function fetchDoc(
  config: Config,
  store: Store,
  url: string,
): Promise<PostHogPage | null> {
  try {
    const html = await fetchText(url, {
      timeoutMs: config.httpTimeoutMs,
      userAgent: config.userAgent,
      accept: "text/html,application/xhtml+xml",
      attempts: 2,
    });
    const extracted = extractPage(html);
    const page: PostHogPage = {
      url,
      title: extracted.title || titleFromUrl(url),
      text: proseText(extracted.blocks) || extracted.text,
      mentions: [],
      fetchedAt: new Date(),
    };
    fetched.set(url, page);
    // Written back so this is a one-off cost per page, not a per-run one.
    await store.upsertPage(page).catch((error: unknown) => {
      log.warn(`could not store ${url}`, error instanceof Error ? error.message : error);
    });
    return page;
  } catch (error) {
    log.warn(`could not fetch ${url}`, error instanceof Error ? error.message : error);
    return null;
  }
}

function signalText(item: Pick<StoredItem, "title" | "raw">): string {
  const raw = item.raw as Record<string, unknown>;
  const parts = [item.title, raw.description, raw.body ?? raw.preview ?? raw.text].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );
  return parts.join("\n\n");
}
