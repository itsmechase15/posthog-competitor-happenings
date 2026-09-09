import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMPETITORS } from "../src/config.js";
import { entryUrl } from "../src/sources/link.js";
import { changelogExternalId, feedEntriesToItems, parseFeed } from "../src/sources/rss.js";

const xml = readFileSync(
  fileURLToPath(new URL("./fixtures/changelog.fixture.xml", import.meta.url)),
  "utf8",
);

describe("parseFeed", () => {
  const entries = parseFeed(xml);

  it("reads every item", () => {
    expect(entries).toHaveLength(2);
  });

  it("unwraps CDATA titles", () => {
    expect(entries[0]?.title).toBe("2026-01-15");
  });

  it("prefers content:encoded and strips markup and scripts", () => {
    const body = entries[0]?.body ?? "";
    expect(body).toContain("Widget Sync copies widgets between workspaces");
    expect(body).not.toContain("<p>");
    expect(body).not.toContain("ignored()");
  });

  it("falls back to description when there is no content:encoded", () => {
    expect(entries[1]?.body).toBe(
      "A short description used as the body when content:encoded is absent.",
    );
  });

  it("parses pubDate", () => {
    expect(entries[0]?.publishedAt?.toISOString()).toBe("2026-01-15T16:43:49.000Z");
  });

  it("strips tracking params from links", () => {
    expect(entries[1]?.link).toBe("https://fixture.invalid/releases/plain-title");
  });

  it("drops the anchor from the link but keeps it as the entry link", () => {
    expect(entries[0]?.link).toBe("https://fixture.invalid/changelogs");
    expect(entries[0]?.entryLink).toBe("https://fixture.invalid/changelogs#2026-01-15");
  });

  it("picks up an embedded screenshot, skipping the logo next to it", () => {
    expect(entries[0]?.image).toBe("https://fixture.invalid/img/widget-sync.png");
  });

  it("prefers an attached enclosure over the body", () => {
    expect(entries[1]?.image).toBe("https://fixture.invalid/img/attached.jpg");
  });
});

describe("changelogExternalId", () => {
  const entries = parseFeed(xml);

  it("uses the feed guid when present", () => {
    expect(changelogExternalId(entries[0]!)).toBe("fixture-guid-001");
  });

  it("falls back to the link when there is no guid", () => {
    expect(changelogExternalId(entries[1]!)).toBe("https://fixture.invalid/releases/plain-title");
  });

  it("hashes title and date when there is neither guid nor link", () => {
    const id = changelogExternalId({
      title: "No identity",
      link: "",
      entryLink: "",
      guid: null,
      publishedAt: new Date("2026-01-01T00:00:00Z"),
      body: "",
      image: null,
    });
    expect(id).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("feedEntriesToItems", () => {
  it("tags items with the competitor and changelog source", () => {
    const items = feedEntriesToItems(COMPETITORS.mixpanel, parseFeed(xml));
    expect(items[0]).toMatchObject({
      competitor: "mixpanel",
      source: "changelog",
      externalId: "fixture-guid-001",
    });
  });

  it("carries the entry's image through for the alert", () => {
    const items = feedEntriesToItems(COMPETITORS.mixpanel, parseFeed(xml));
    expect(items[0]?.raw.image).toBe("https://fixture.invalid/img/widget-sync.png");
  });

  it("keeps the anchor an entry shares a page with the rest of the changelog", () => {
    const items = feedEntriesToItems(COMPETITORS.mixpanel, parseFeed(xml));
    expect(items[0]?.url).toBe("https://fixture.invalid/changelogs");
    expect(entryUrl(items[0]!)).toBe("https://fixture.invalid/changelogs#2026-01-15");
  });

  it("leaves entryUrl out when the entry has a page of its own", () => {
    const items = feedEntriesToItems(COMPETITORS.mixpanel, parseFeed(xml));
    expect(items[1]?.raw.entryUrl).toBeUndefined();
    expect(entryUrl(items[1]!)).toBe("https://fixture.invalid/releases/plain-title");
  });
});
