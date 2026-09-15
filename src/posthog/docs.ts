import { createLogger } from "../log.js";
import type { PostHogDoc, RecommendedAction, StoredItem } from "../types.js";
import { titleFromUrl } from "../util/text.js";
import { matchProducts, productForDocUrl, productsForAction } from "./products.js";
import { bestExcerpt, terms, type CorpusIndex } from "./retrieval.js";

const log = createLogger("posthog-docs");

/** Per-doc excerpt budget for the pre-loaded set. Enough to show what a product does. */
const MAX_EXCERPT_CHARS = 900;

/** Overview pages added for products the signal names but retrieval did not rank. */
const MAX_ROUTED_PAGES = 3;

/** Overview pages added for products a verdict named after the fact. */
const MAX_TOP_UP_PAGES = 3;

/** Everything the signal itself says, which is what retrieval is queried with. */
export function signalText(item: Pick<StoredItem, "title" | "raw">): string {
  const raw = item.raw as Record<string, unknown>;
  const parts = [item.title, raw.description, raw.body ?? raw.preview ?? raw.text].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );
  return parts.join("\n\n");
}

function toDoc(
  page: { url: string; title: string; text: string; kind?: PostHogDoc["kind"] },
  queryTerms: string[],
): PostHogDoc {
  return {
    url: page.url,
    title: page.title || titleFromUrl(page.url),
    excerpt: bestExcerpt(page.text, queryTerms, MAX_EXCERPT_CHARS),
    ...(page.kind ? { kind: page.kind } : {}),
  };
}

export interface ContextOptions {
  limit?: number;
  perSection?: number;
}

/**
 * The corpus excerpts pre-loaded into one signal's prompt.
 *
 * A starting point, not the evidence. The analyst has the whole corpus on disk
 * and a map of what is in it, so what this buys is a first read that is
 * usually right: the pages a lexical search for the launch's own words ranks
 * highest, capped per section so a launch that happens to use experimentation
 * vocabulary does not arrive with ten experiments pages and nothing else.
 *
 * Products the catalog routes the signal to get their overview page whether or
 * not retrieval ranked it, because "does PostHog have this at all" is answered
 * on an overview page and nowhere else.
 */
export function contextForSignal(
  index: CorpusIndex,
  item: Pick<StoredItem, "title" | "raw">,
  options: ContextOptions = {},
): PostHogDoc[] {
  const text = signalText(item);
  const queryTerms = terms(text);
  const hits = index.search(text, {
    limit: options.limit ?? 10,
    perSection: options.perSection ?? 4,
  });

  const docs: PostHogDoc[] = hits.map((hit) => ({
    url: hit.url,
    title: hit.title,
    excerpt: hit.excerpt,
    kind: hit.kind,
  }));
  const seen = new Set(docs.map((doc) => doc.url));

  let routed = 0;
  for (const product of matchProducts(text, 3)) {
    const url = product.docs[0];
    if (!url || seen.has(url) || routed >= MAX_ROUTED_PAGES) continue;
    const page = index.page(url);
    if (!page) continue;
    seen.add(url);
    routed += 1;
    docs.push(toDoc(page, queryTerms));
  }

  log.info(
    `context for "${item.title}": ${docs.length} corpus excerpts (${hits.length} retrieved, ${routed} routed from the catalog) out of ${index.size} pages`,
  );
  return docs;
}

/**
 * The overview pages for products a verdict names but the signal's own words
 * never matched.
 *
 * A signal about first-party domains pulls the proxy docs, and then the
 * analyst writes about a product one step to the side of them. Whatever it
 * named, the catalog knows where that product is documented, and an action
 * checked against no page at all is the one that ships "PostHog has no X" when
 * PostHog has X. Nothing is fetched here: it is a corpus lookup.
 */
export function topUpDocsForActions(
  index: CorpusIndex,
  item: Pick<StoredItem, "title" | "raw">,
  actions: RecommendedAction[],
  docs: PostHogDoc[],
): PostHogDoc[] {
  const covered = new Set(
    docs
      .map((doc) => productForDocUrl(doc.url)?.label)
      .filter((label): label is string => Boolean(label)),
  );
  const held = new Set(docs.map((doc) => doc.url));
  const queryTerms = terms(signalText(item));
  const added: PostHogDoc[] = [];

  for (const action of actions) {
    for (const product of productsForAction(action)) {
      const url = product.docs[0];
      if (!url || covered.has(product.label) || held.has(url)) continue;
      if (added.length >= MAX_TOP_UP_PAGES) break;
      const page = index.page(url);
      if (!page) continue;
      held.add(url);
      added.push(toDoc(page, queryTerms));
    }
  }

  if (added.length > 0) {
    log.info(
      `topped up context with ${added.map((doc) => doc.url).join(", ")} for products the verdict named`,
    );
  }
  return [...docs, ...added];
}
