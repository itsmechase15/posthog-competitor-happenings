import type { Config } from "../config.js";
import { createLogger } from "../log.js";
import { parseSitemap } from "../sources/sitemap.js";
import type { DiscoverySource, PageKind } from "../types.js";
import { extractLinks } from "../util/html.js";
import { fetchText, HttpError } from "../util/http.js";
import { normalizeUrl } from "../util/text.js";
import { CANONICAL_DOC_URLS, MARKETING_PAGE_URLS } from "./products.js";

const log = createLogger("posthog-discover");

const SITE_HOSTS = new Set(["posthog.com", "www.posthog.com"]);

/** A URL that serves a file rather than a page anyone would quote a sentence from. */
const NOT_A_PAGE = /\.(xml|txt|json|png|jpe?g|gif|svg|webp|ico|css|js|pdf|zip|docx?|mp4|webm|html)$/i;

/** PostHog's own changelog. Its entries say what shipped, documented or not. */
const CHANGELOG_PREFIX = "/changelog";

/** The product documentation. The only evidence a gap claim may rest on. */
const DOCS_PREFIX = "/docs";

/**
 * Docs paths that are generated reference rather than prose about the product.
 *
 * `/docs/api` and `/docs/open-api-spec` are one page per REST operation, and
 * `/docs/references` is one page per SDK type. Together they are 2,800 pages
 * of near-identical boilerplate, and holding them costs three ways: they
 * double the corpus and the workspace, they skew a lexical index by shifting
 * the document frequency of every common word, and they rank as strong matches
 * for generic vocabulary, which blocks honest actions on evidence nobody could
 * have read. What PostHog ships is written in the prose docs; an endpoint stub
 * that says "for instructions on how to authenticate, see API overview"
 * establishes nothing either way.
 */
const GENERATED_REFERENCE_PREFIXES = [
  "/docs/api",
  "/docs/open-api-spec",
  "/docs/references",
];

/**
 * Marketing sections that run deeper than one path segment.
 *
 * This is the set the claims indexer has always read, so the pages that carry
 * PostHog's copy about a competitor stay in reach, plus the rest of PostHog's
 * own writing – the newsletter and the two editorial sections – because a
 * `consider_publishing` action is checked against what PostHog has already
 * published, and a post that lives under `/founders` is as published as one
 * under `/blog`. It is an allowlist rather than a denylist because the
 * sitemap's long tail is community Q&A: 7,700 pages of `/questions`, which
 * mention Mixpanel constantly and are nobody's marketing copy and nobody's
 * product documentation.
 */
const MARKETING_PREFIXES = [
  "/compare",
  "/blog",
  "/tutorials",
  "/customers",
  "/newsletter",
  "/founders",
  "/product-engineers",
];

/**
 * Section roots that are indexes rather than pages, or sections whose contents
 * are handled elsewhere. A single-segment path is otherwise held as marketing,
 * because that is how posthog.com links its product pages – `/experiments`,
 * `/session-replay`, `/pricing` – and how `isMarketingTarget` reads them.
 */
const NOT_CORPUS_ROOTS = new Set([
  "/docs",
  "/questions",
  "/handbook",
  "/community",
  "/careers",
  "/events",
  "/newsletter",
  "/404",
  "/old-home",
]);

function underPrefix(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * The canonical form of a corpus URL: no fragment, no query, no trailing
 * slash, and no `.md` suffix. posthog.com serves `/docs/x` and `/docs/x.md` as
 * the same page, and storing both would double the corpus and split its
 * history.
 */
export function canonicalCorpusUrl(raw: string): string {
  const normalized = normalizeUrl(raw);
  try {
    const url = new URL(normalized);
    url.search = "";
    url.hash = "";
    if (url.pathname.endsWith(".md")) url.pathname = url.pathname.slice(0, -3);
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return normalized;
  }
}

/**
 * What a URL is worth holding as, or null when it is not corpus material.
 *
 * This is the one place that decides what "the docs" means, and it is
 * deliberately wider than the catalog: the corpus is every page PostHog
 * publishes about the product, and the catalog is a route into it.
 */
export function classifyCorpusUrl(raw: string): PageKind | null {
  let url: URL;
  try {
    url = new URL(canonicalCorpusUrl(raw));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!SITE_HOSTS.has(url.hostname.toLowerCase())) return null;

  const path = url.pathname;
  if (path === "/" || NOT_A_PAGE.test(path)) return null;
  if (NOT_CORPUS_ROOTS.has(path)) return null;

  if (underPrefix(path, [CHANGELOG_PREFIX])) return "changelog";
  if (path.startsWith(`${DOCS_PREFIX}/`)) {
    return underPrefix(path, GENERATED_REFERENCE_PREFIXES) ? null : "docs";
  }
  if (underPrefix(path, MARKETING_PREFIXES)) return "marketing";
  // A product page is one segment deep, which is also how the catalog links it.
  return path.split("/").filter(Boolean).length === 1 ? "marketing" : null;
}

/** One discovered URL, with every source that offered it this run. */
export interface Discovery {
  url: string;
  kind: PageKind;
  sources: DiscoverySource[];
}

interface SourceUrls {
  source: DiscoverySource;
  urls: string[];
}

/**
 * Fold the sources into one list, keeping every source that named each URL.
 *
 * The union is the point. No single input is trusted to be complete: a sitemap
 * can lag a deploy, `llms.txt` is a subset somebody curated for another
 * purpose, and a crawl only reaches what something already linked. A URL any
 * of them names is a page we hold.
 */
export function mergeDiscoveries(groups: SourceUrls[]): Discovery[] {
  const found = new Map<string, Discovery>();

  for (const group of groups) {
    for (const raw of group.urls) {
      const kind = classifyCorpusUrl(raw);
      if (kind === null) continue;
      const url = canonicalCorpusUrl(raw);
      const existing = found.get(url);
      if (existing) {
        if (!existing.sources.includes(group.source)) existing.sources.push(group.source);
        continue;
      }
      found.set(url, { url, kind, sources: [group.source] });
    }
  }

  return [...found.values()].sort((a, b) => a.url.localeCompare(b.url));
}

/**
 * Fold one more source into a list already merged. Used for the crawl input,
 * which cannot be collected until the pages it comes off have been read.
 */
export function addDiscoverySource(
  existing: Discovery[],
  source: DiscoverySource,
  urls: string[],
): Discovery[] {
  const found = new Map(
    existing.map((entry) => [entry.url, { ...entry, sources: [...entry.sources] }]),
  );

  for (const raw of urls) {
    const kind = classifyCorpusUrl(raw);
    if (kind === null) continue;
    const url = canonicalCorpusUrl(raw);
    const entry = found.get(url);
    if (!entry) {
      found.set(url, { url, kind, sources: [source] });
      continue;
    }
    if (!entry.sources.includes(source)) entry.sources.push(source);
  }

  return [...found.values()].sort((a, b) => a.url.localeCompare(b.url));
}

/** Every URL in a sitemap or sitemap index, without following the children. */
export function urlsFromSitemap(xml: string): { urls: string[]; children: string[] } {
  const parsed = parseSitemap(xml);
  return { urls: parsed.entries.map((entry) => entry.url), children: parsed.children };
}

const BARE_URL = /https?:\/\/[^\s)<>"']+/g;
const LLMS_LINK = /\[[^\]]*\]\((https?:\/\/[^)\s]+)/g;

/**
 * The URLs an `llms.txt` lists.
 *
 * It is read as one input and never as the corpus. It is a file PostHog
 * curates for model consumption, which means it is a subset chosen for some
 * other purpose than ours, and a page missing from it is not a page that does
 * not exist.
 */
export function urlsFromLlmsTxt(text: string): string[] {
  const found: string[] = [];
  const add = (url: string): void => {
    const trimmed = url.replace(/[.,;:]+$/, "");
    if (!found.includes(trimmed)) found.push(trimmed);
  };
  for (const match of text.matchAll(LLMS_LINK)) {
    if (match[1]) add(match[1]);
  }
  for (const match of text.matchAll(BARE_URL)) {
    add(match[0]);
  }
  return found;
}

/** Links on a changelog index that point at its own entries. */
export function changelogEntryUrls(html: string, indexUrl: string): string[] {
  return extractLinks(html, indexUrl, [CHANGELOG_PREFIX]);
}

export interface DiscoveryResult {
  discoveries: Discovery[];
  /** One line per input, for the run summary. */
  notes: string[];
}

async function text(config: Config, url: string): Promise<string | null> {
  try {
    return await fetchText(url, {
      timeoutMs: config.httpTimeoutMs,
      userAgent: config.userAgent,
      accept: "text/plain, application/xml, text/html, */*",
      attempts: 2,
    });
  } catch (error) {
    log.warn(`could not read ${url}`, error instanceof Error ? error.message : error);
    return null;
  }
}

/** How deep a sitemap index is followed. One level is what posthog.com publishes. */
const MAX_SITEMAP_CHILDREN = 8;

async function fromSitemaps(config: Config, notes: string[]): Promise<string[]> {
  const urls: string[] = [];

  for (const sitemapUrl of config.docsSitemaps) {
    const xml = await text(config, sitemapUrl);
    if (xml === null) {
      notes.push(`sitemap ${sitemapUrl}: unreadable`);
      continue;
    }
    const top = urlsFromSitemap(xml);
    urls.push(...top.urls);

    for (const child of top.children.slice(0, MAX_SITEMAP_CHILDREN)) {
      const childXml = await text(config, child);
      if (childXml === null) continue;
      urls.push(...urlsFromSitemap(childXml).urls);
    }
    notes.push(`sitemap ${sitemapUrl}: ${top.urls.length} urls, ${top.children.length} children`);
  }

  return urls;
}

/**
 * Discover what the corpus should hold, from the union of every input.
 *
 * `knownLinks` are the links found on pages already stored, which is how a
 * page reached only from another page's prose gets in. It is passed in rather
 * than crawled here: the refresh already has those bodies, and a crawl of its
 * own would fetch the whole site twice.
 */
export async function discoverCorpusUrls(
  config: Config,
  knownLinks: string[] = [],
): Promise<DiscoveryResult> {
  const notes: string[] = [];

  const sitemapUrls = await fromSitemaps(config, notes);

  const llms = config.docsLlmsTxt ? await text(config, config.docsLlmsTxt) : null;
  const llmsUrls = llms === null ? [] : urlsFromLlmsTxt(llms);
  if (config.docsLlmsTxt) notes.push(`llms.txt: ${llmsUrls.length} urls`);

  const changelogUrls: string[] = [];
  if (config.posthogChangelogIndex) {
    const html = await text(config, config.posthogChangelogIndex);
    if (html !== null) {
      changelogUrls.push(
        config.posthogChangelogIndex,
        ...changelogEntryUrls(html, config.posthogChangelogIndex),
      );
    }
    notes.push(`posthog changelog: ${changelogUrls.length} urls`);
  }

  const discoveries = mergeDiscoveries([
    { source: "sitemap", urls: sitemapUrls },
    { source: "llms", urls: llmsUrls },
    { source: "crawl", urls: knownLinks },
    { source: "changelog", urls: changelogUrls },
    // Last, so the catalog only ever adds a source to a URL the real inputs
    // already found. It pins the overview pages the bot routes to; it does not
    // decide what the corpus contains.
    { source: "catalog", urls: [...CANONICAL_DOC_URLS, ...MARKETING_PAGE_URLS] },
  ]);

  log.info(
    `discovery: ${discoveries.length} corpus urls (${discoveries.filter((entry) => entry.kind === "docs").length} docs, ${discoveries.filter((entry) => entry.kind === "marketing").length} marketing, ${discoveries.filter((entry) => entry.kind === "changelog").length} changelog)`,
  );
  return { discoveries, notes };
}

/** A page that is gone rather than merely unreachable. */
export function isGone(error: unknown): boolean {
  return error instanceof HttpError && (error.status === 404 || error.status === 410);
}
