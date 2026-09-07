import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CompetitorConfig } from "../src/config.js";
import { sitemapEntriesToItems } from "../src/sources/blog.js";
import { parseSitemap } from "../src/sources/sitemap.js";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

const competitor: CompetitorConfig = {
  id: "mixpanel",
  label: "Fixture Co",
  changelogFeed: "https://fixture.invalid/changelogs/rss.xml",
  sitemaps: ["https://fixture.invalid/blog/sitemap.xml"],
  blogPathPrefixes: ["/blog/"],
  xUsername: "fixture",
  aliases: ["fixture"],
};

describe("parseSitemap", () => {
  it("returns child sitemaps for an index", () => {
    const parsed = parseSitemap(fixture("sitemap-index.fixture.xml"));
    expect(parsed.entries).toHaveLength(0);
    expect(parsed.children).toEqual([
      "https://fixture.invalid/blog/sitemap.xml?sitemap=post-sitemap.xml",
      "https://fixture.invalid/blog/sitemap.xml?sitemap=tag-sitemap.xml",
    ]);
  });

  it("returns entries with lastmod for a urlset", () => {
    const parsed = parseSitemap(fixture("sitemap-urlset.fixture.xml"));
    expect(parsed.children).toHaveLength(0);
    expect(parsed.entries).toHaveLength(7);
    const fresh = parsed.entries.find((entry) => entry.url.endsWith("/fresh-post"));
    expect(fresh?.lastModified?.toISOString()).toBe("2026-01-19T12:00:00.000Z");
  });

  it("leaves lastModified null when the sitemap omits it", () => {
    const parsed = parseSitemap(fixture("sitemap-urlset.fixture.xml"));
    const undated = parsed.entries.find((entry) => entry.url.endsWith("/undated-post"));
    expect(undated?.lastModified).toBeNull();
  });
});

describe("sitemapEntriesToItems", () => {
  const entries = parseSitemap(fixture("sitemap-urlset.fixture.xml")).entries;
  const items = sitemapEntriesToItems(competitor, entries, {
    since: new Date("2026-01-10T00:00:00Z"),
    limit: 50,
  });
  const urls = items.map((item) => item.url);

  it("keeps articles under the blog prefix", () => {
    expect(urls).toContain("https://fixture.invalid/blog/fresh-post");
  });

  it("drops the blog index, taxonomy pages, and pagination", () => {
    expect(urls).not.toContain("https://fixture.invalid/blog");
    expect(urls).not.toContain("https://fixture.invalid/blog/tag/analytics");
    expect(urls).not.toContain("https://fixture.invalid/blog/page/3");
  });

  it("drops pages outside the blog prefix", () => {
    expect(urls).not.toContain("https://fixture.invalid/pricing");
  });

  it("drops entries older than the lookback window", () => {
    expect(urls).not.toContain("https://fixture.invalid/blog/stale-post");
  });

  it("drops undated entries, which would otherwise resurface forever", () => {
    expect(urls).not.toContain("https://fixture.invalid/blog/undated-post");
  });

  it("identifies blog items by URL so a re-render does not look new", () => {
    expect(items[0]).toMatchObject({
      source: "blog",
      externalId: "https://fixture.invalid/blog/fresh-post",
    });
  });

  it("respects the candidate limit", () => {
    const limited = sitemapEntriesToItems(competitor, entries, {
      since: new Date("2020-01-01T00:00:00Z"),
      limit: 1,
    });
    expect(limited).toHaveLength(1);
  });
});
