import * as cheerio from "cheerio";
import { collapseWhitespace, parseDate } from "./text.js";

const NON_CONTENT = "script, style, noscript, template, svg, iframe, nav, footer, header, form";

export interface ExtractedPage {
  title: string;
  /** The page's own summary, when it declares one. Usually cleaner than the first paragraph. */
  description: string;
  /** Readable body text with the chrome removed. */
  text: string;
  /** Body paragraphs, each tagged with the nearest preceding heading. */
  blocks: Array<{ heading: string | null; paragraph: string }>;
}

function pickRoot($: cheerio.CheerioAPI): cheerio.Cheerio<never> {
  for (const selector of ["main", "article", "[role=main]", "body"]) {
    const found = $(selector).first();
    if (found.length > 0) return found as unknown as cheerio.Cheerio<never>;
  }
  return $.root() as unknown as cheerio.Cheerio<never>;
}

/** Strip an HTML document down to a title, readable text, and heading-tagged paragraphs. */
export function extractPage(html: string): ExtractedPage {
  const $ = cheerio.load(html);
  $(NON_CONTENT).remove();

  const title = collapseWhitespace(
    $("meta[property='og:title']").attr("content") ?? $("title").first().text() ?? "",
  );
  const description = collapseWhitespace(
    $("meta[property='og:description']").attr("content") ??
      $("meta[name='description']").attr("content") ??
      "",
  );

  const root = $(pickRoot($));
  const blocks: ExtractedPage["blocks"] = [];
  let heading: string | null = null;

  root.find("h1, h2, h3, h4, p, li, blockquote").each((_, element) => {
    const node = $(element);
    const tag = (element as { tagName?: string }).tagName?.toLowerCase() ?? "";
    const text = collapseWhitespace(node.text());
    if (!text) return;

    if (tag.startsWith("h")) {
      heading = text;
      return;
    }
    // One-word list items are almost always nav leftovers, not claims.
    if (text.split(" ").length < 4) return;
    blocks.push({ heading, paragraph: text });
  });

  const text = collapseWhitespace(
    blocks.length > 0 ? blocks.map((block) => block.paragraph).join("\n\n") : root.text(),
  );

  return { title, description, text, blocks };
}

/**
 * A block that reads as a sentence rather than a link in an in-page contents
 * list. Docs pages open with a stack of section links, and glued together by
 * whitespace collapsing they read as one long fragment that says nothing.
 */
function isProse(paragraph: string): boolean {
  return /[.!?]["')\]]?$/.test(paragraph) && paragraph.split(" ").length >= 6;
}

/**
 * The page's prose, with its contents list dropped. Stored for the pages that
 * are quoted back to a model, where a run of section titles is noise standing
 * where the page's first real sentence should be.
 */
export function proseText(blocks: ExtractedPage["blocks"]): string {
  const prose = blocks.map((block) => block.paragraph).filter(isProse);
  return collapseWhitespace(prose.join(" "));
}

/**
 * Every same-site link on a page, as absolute URLs.
 *
 * This is discovery's third input, after the sitemap and `llms.txt`. A page
 * reached only from another page's prose – a new docs page the sitemap has not
 * caught up with, a changelog entry linked from its own index – gets into the
 * corpus on this and nothing else. Fragments are dropped: `/docs/x#setup` and
 * `/docs/x` are one page.
 */
export function extractLinks(html: string, baseUrl: string, pathPrefixes?: string[]): string[] {
  const found: string[] = [];

  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const target = match[1];
    if (!target || target.startsWith("#") || target.startsWith("mailto:")) continue;
    try {
      const url = new URL(target, baseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      if (pathPrefixes && !pathPrefixes.some((prefix) => url.pathname.startsWith(prefix))) continue;
      url.hash = "";
      const absolute = url.toString();
      if (!found.includes(absolute)) found.push(absolute);
    } catch {
      // A link target that is not a URL is a link nobody can follow.
    }
  }

  return found;
}

/** Social-preview tags first: a page's og:image is the picture it chose for itself. */
const META_IMAGE_SELECTORS = [
  "meta[property='og:image:secure_url']",
  "meta[property='og:image']",
  "meta[property='og:image:url']",
  "meta[name='twitter:image']",
  "meta[name='twitter:image:src']",
  "meta[itemprop='image']",
];

/** Sprites, avatars, and tracking pixels are images, but they are not the feature. */
const DECORATIVE_IMAGE =
  /(logo|icon|favicon|sprite|avatar|profile_image|badge|spacer|placeholder|pixel|1x1|blank|loading|emoji|social-share)/i;

function absolute(src: string, baseUrl: string): string | null {
  const trimmed = src.trim();
  if (!trimmed || trimmed.startsWith("data:")) return null;
  try {
    const url = new URL(trimmed, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** The largest candidate in a `srcset`, which is usually the last entry. */
function widestFromSrcset(srcset: string): string | undefined {
  const entries = srcset
    .split(",")
    .map((entry) => entry.trim().split(/\s+/))
    .filter((parts) => parts[0])
    .map((parts) => ({
      url: parts[0] as string,
      width: Number.parseInt(parts[1]?.replace(/\D/g, "") ?? "0", 10) || 0,
    }));
  if (entries.length === 0) return undefined;
  return entries.sort((a, b) => b.width - a.width)[0]?.url;
}

/**
 * Every image on a page that could plausibly show the feature, best first:
 * the page's own social preview, then in-content images with the obvious
 * chrome filtered out. SVGs are skipped because Slack will not render them.
 */
export function extractImageUrls(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const found: string[] = [];

  const add = (raw: string | undefined): void => {
    if (!raw) return;
    const url = absolute(raw, baseUrl);
    if (!url || url.toLowerCase().split("?")[0]?.endsWith(".svg")) return;
    if (!found.includes(url)) found.push(url);
  };

  for (const selector of META_IMAGE_SELECTORS) {
    add($(selector).first().attr("content"));
  }
  add($("link[rel='image_src']").first().attr("href"));

  $("script, style, noscript, nav, footer, header").remove();
  const root = $(pickRoot($));

  root.find("img, source").each((_, element) => {
    const node = $(element);
    const src = node.attr("src") ?? widestFromSrcset(node.attr("srcset") ?? "");
    if (!src || DECORATIVE_IMAGE.test(src)) return;
    // Explicitly tiny images are decoration whatever they are named.
    const width = Number.parseInt(node.attr("width") ?? "0", 10);
    if (width > 0 && width < 200) return;
    add(src);
  });

  return found;
}

/** Where a post usually says when it was published, most explicit first. */
const PUBLISHED_META_SELECTORS = [
  "meta[property='article:published_time']",
  "meta[property='og:article:published_time']",
  "meta[name='article:published_time']",
  "meta[itemprop='datePublished']",
  "meta[name='publish-date']",
  "meta[name='pubdate']",
  "meta[name='date']",
];

/**
 * The date a page says it was published on, or null when it does not say.
 *
 * Only for the pages we reach by name rather than through a feed or a sitemap,
 * which are the two places a date normally comes from. A wrong guess is worse
 * than none here, so nothing is inferred from the body copy.
 */
export function extractPublishedAt(html: string): Date | null {
  const $ = cheerio.load(html);

  for (const selector of PUBLISHED_META_SELECTORS) {
    const parsed = parseDate($(selector).first().attr("content"));
    if (parsed) return parsed;
  }

  const time = parseDate($("time[datetime]").first().attr("datetime"));
  if (time) return time;

  for (const element of $("script[type='application/ld+json']").toArray()) {
    const match = /"datePublished"\s*:\s*"([^"]+)"/.exec($(element).text());
    const parsed = parseDate(match?.[1]);
    if (parsed) return parsed;
  }

  return null;
}

/** Convert an RSS `content:encoded` payload into plain text. */
export function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $(NON_CONTENT).remove();
  return collapseWhitespace($.root().text());
}
