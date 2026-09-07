import * as cheerio from "cheerio";
import { collapseWhitespace } from "./text.js";

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

/** Convert an RSS `content:encoded` payload into plain text. */
export function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $(NON_CONTENT).remove();
  return collapseWhitespace($.root().text());
}
