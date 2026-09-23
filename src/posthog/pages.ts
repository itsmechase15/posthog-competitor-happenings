/**
 * Which posthog.com pages this bot may ask someone to edit.
 *
 * `update_pages` and `new_compare_page` are marketing's work: a compare page,
 * a product page, a blog post, the pricing page. The docs are a different
 * thing entirely. They are the evidence an alert is checked against – what
 * PostHog ships today – and a docs page is only ever wrong in the sense that
 * the product changed, which is not something a competitor's launch tells us.
 *
 * So a docs URL is never a page target. A model that cites one has cited its
 * own evidence as the thing to fix, and sending marketing to edit the
 * Experiments docs because Amplitude shipped a scheduled stop is work nobody
 * asked for. The claims indexer still reads the docs, and product issues still
 * cite them: reading a page and editing it are not the same permission.
 */

/** Paths that are never edit targets, docs first. */
const DENIED_PREFIXES = ["/docs", "/handbook", "/questions", "/community", "/careers"];

/** Marketing sections that run deeper than one path segment. */
const ALLOWED_PREFIXES = [
  "/compare",
  "/blog",
  "/customers",
  "/tutorials",
  "/newsletter",
  "/founders",
  "/product-engineers",
];

/** The path of a posthog.com URL, or null for anything hosted elsewhere. */
function postHogPath(url: string): string | null {
  try {
    const { hostname, pathname } = new URL(url);
    if (hostname !== "posthog.com" && hostname !== "www.posthog.com") return null;
    return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  } catch {
    return null;
  }
}

function underPrefix(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** A page that says what PostHog ships, rather than how it is sold. */
export function isDocsUrl(url: string): boolean {
  const path = postHogPath(url);
  return path !== null && underPrefix(path, ["/docs"]);
}

/**
 * A page a page action may name. Product marketing pages are one path segment
 * deep – `/experiments`, `/pricing`, `/ai` – which is also how the catalog
 * links them, so the rule covers pages the catalog has not caught up with yet.
 */
export function isMarketingTarget(url: string): boolean {
  const path = postHogPath(url);
  if (path === null || underPrefix(path, DENIED_PREFIXES)) return false;
  if (underPrefix(path, ALLOWED_PREFIXES)) return true;
  return path.split("/").filter(Boolean).length === 1;
}
