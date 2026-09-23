import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config.js";
import { forcedSourceFor, resolveForcedCandidate } from "../src/sources/force.js";

const config = {
  httpTimeoutMs: 5_000,
  userAgent: "test-agent",
} as Config;

/** The post that broke the force path: real, published, and long out of the recent slice. */
const OLD_POST = "https://amplitude.com/blog/amplitude-sdk-or-not";

const SITEMAP_INDEX = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://amplitude.com/sitemap-blog.xml</loc></sitemap>
</sitemapindex>`;

function blogSitemap(...urls: string[]): string {
  const entries = urls
    .map((url) => `<url><loc>${url}</loc><lastmod>2025-11-04T09:00:00+00:00</lastmod></url>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`;
}

const ARTICLE_HTML = `<html><head>
  <meta property="og:title" content="Should you build your own SDK?" />
  <meta property="article:published_time" content="2025-11-04T09:00:00Z" />
</head><body><main>
  <h1>Should you build your own SDK?</h1>
  <p>Teams ask us whether to write an SDK themselves or take one off the shelf.</p>
</main></body></html>`;

/** Answer each URL with the body the test gave it, and 404 anything else. */
function router(routes: Record<string, string>): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    const body = routes[url];
    if (body === undefined) return new Response("not found", { status: 404 });
    return new Response(body, { status: 200 });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("forcedSourceFor", () => {
  it("reads a competitor blog URL off the configured blog prefixes", () => {
    expect(forcedSourceFor(OLD_POST)).toMatchObject({
      source: "blog",
      competitor: { id: "amplitude" },
    });
  });

  it("reads a changelog URL off the directory the feed lives in", () => {
    expect(forcedSourceFor("https://amplitude.com/releases/some-release")).toMatchObject({
      source: "changelog",
      competitor: { id: "amplitude" },
    });
    expect(forcedSourceFor("https://docs.mixpanel.com/changelogs#march-2026")).toMatchObject({
      source: "changelog",
      competitor: { id: "mixpanel" },
    });
  });

  it("claims nothing outside a configured competitor source", () => {
    expect(forcedSourceFor("https://posthog.com/blog/array-1-0")).toBeNull();
    expect(forcedSourceFor("https://amplitude.com/pricing")).toBeNull();
    expect(forcedSourceFor("not a url")).toBeNull();
  });
});

describe("resolveForcedCandidate", () => {
  it("finds a post the recent slice dropped in the competitor's full sitemap", async () => {
    const fetchSpy = router({
      "https://amplitude.com/sitemap-root.xml": SITEMAP_INDEX,
      "https://amplitude.com/sitemap-blog.xml": blogSitemap(OLD_POST),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const resolved = await resolveForcedCandidate(config, OLD_POST);

    expect(resolved?.item).toMatchObject({
      competitor: "amplitude",
      source: "blog",
      externalId: OLD_POST,
      url: OLD_POST,
    });
    expect(resolved?.item.publishedAt?.toISOString()).toBe("2025-11-04T09:00:00.000Z");
    expect(resolved?.item.raw).toMatchObject({ discoveredVia: "sitemap" });
    // The page itself is left to enrichment, exactly as on the daily run.
    expect(fetchSpy.mock.calls.map((call) => call[0])).not.toContain(OLD_POST);
  });

  it("falls back to the page when the sitemap has moved on", async () => {
    vi.stubGlobal(
      "fetch",
      router({
        "https://amplitude.com/sitemap-root.xml": SITEMAP_INDEX,
        "https://amplitude.com/sitemap-blog.xml": blogSitemap(
          "https://amplitude.com/blog/something-else",
        ),
        [OLD_POST]: ARTICLE_HTML,
      }),
    );

    const resolved = await resolveForcedCandidate(config, OLD_POST);

    expect(resolved?.item).toMatchObject({
      competitor: "amplitude",
      source: "blog",
      title: "Should you build your own SDK?",
      url: OLD_POST,
    });
    expect(resolved?.item.publishedAt?.toISOString()).toBe("2025-11-04T09:00:00.000Z");
    expect(resolved?.item.raw.body).toContain("off the shelf");
  });

  it("reads a changelog entry off its own page, which has no sitemap to check", async () => {
    const url = "https://amplitude.com/releases/session-replay-everywhere";
    vi.stubGlobal("fetch", router({ [url]: ARTICLE_HTML }));

    const resolved = await resolveForcedCandidate(config, url);

    expect(resolved?.item).toMatchObject({ competitor: "amplitude", source: "changelog", url });
  });

  it("keeps its hands off a URL no competitor source covers", async () => {
    const fetchSpy = router({});
    vi.stubGlobal("fetch", fetchSpy);

    await expect(resolveForcedCandidate(config, "https://posthog.com/blog/array")).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("gives up on a competitor URL that is gone rather than inventing one", async () => {
    vi.stubGlobal("fetch", router({}));
    await expect(resolveForcedCandidate(config, OLD_POST)).resolves.toBeNull();
  });
});
