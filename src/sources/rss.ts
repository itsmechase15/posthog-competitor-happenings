import { XMLParser } from "fast-xml-parser";
import type { CompetitorConfig } from "../config.js";
import { htmlToText } from "../util/html.js";
import { collapseWhitespace, normalizeUrl, parseDate, sha1, truncate } from "../util/text.js";
import type { CandidateItem } from "../types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "__cdata",
  trimValues: true,
});

/** RSS/Atom nodes arrive as a string, an object, or an array depending on the feed. */
function textOf(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return collapseWhitespace(node);
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) return textOf(node[0]);
  if (typeof node === "object") {
    const record = node as Record<string, unknown>;
    if ("__cdata" in record) return textOf(record.__cdata);
    if ("#text" in record) return textOf(record["#text"]);
    if ("@_href" in record) return textOf(record["@_href"]);
  }
  return "";
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export interface FeedEntry {
  title: string;
  link: string;
  guid: string | null;
  publishedAt: Date | null;
  /** Full entry body as plain text, when the feed provides one. */
  body: string;
}

/** Parse an RSS 2.0 or Atom document into a flat list of entries. */
export function parseFeed(xml: string): FeedEntry[] {
  const parsed = parser.parse(xml) as Record<string, any>;
  const channel = parsed?.rss?.channel ?? parsed?.channel;
  const rawEntries = channel ? asArray(channel.item) : asArray(parsed?.feed?.entry);

  return rawEntries
    .map((entry: Record<string, unknown>): FeedEntry => {
      const link = textOf(entry.link);
      const bodyHtml =
        textOf(entry["content:encoded"]) || textOf(entry.content) || textOf(entry.description);
      const guidNode = entry.guid ?? entry.id;
      return {
        title: textOf(entry.title),
        link: link ? normalizeUrl(link) : "",
        guid: textOf(guidNode) || null,
        publishedAt: parseDate(
          textOf(entry.pubDate) || textOf(entry.published) || textOf(entry.updated),
        ),
        body: bodyHtml.includes("<") ? htmlToText(bodyHtml) : collapseWhitespace(bodyHtml),
      };
    })
    .filter((entry) => entry.title !== "" || entry.link !== "");
}

/**
 * A changelog entry's identity. Prefers the feed's own guid; falls back to a
 * hash so entries without one (or with a reused link + anchor) still dedupe.
 */
export function changelogExternalId(entry: FeedEntry): string {
  if (entry.guid) return entry.guid;
  if (entry.link) return entry.link;
  return sha1(`${entry.title}|${entry.publishedAt?.toISOString() ?? ""}`);
}

export function feedEntriesToItems(
  competitor: CompetitorConfig,
  entries: FeedEntry[],
): CandidateItem[] {
  return entries.map((entry) => ({
    competitor: competitor.id,
    source: "changelog" as const,
    externalId: changelogExternalId(entry),
    title: entry.title || competitor.label,
    url: entry.link || competitor.changelogFeed,
    publishedAt: entry.publishedAt,
    raw: {
      feed: competitor.changelogFeed,
      guid: entry.guid,
      body: truncate(entry.body, 8_000),
    },
  }));
}
