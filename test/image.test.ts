import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config.js";
import {
  generatedCardUrl,
  imageFromRaw,
  resolveFeatureImage,
  screenshotUrl,
} from "../src/media/image.js";
import type { StoredItem } from "../src/types.js";
import { extractImageUrls } from "../src/util/html.js";

const config = {
  httpTimeoutMs: 5_000,
  userAgent: "test-agent",
  screenshotUrlTemplate: "https://shots.invalid/{url}",
} as Config;

const item: StoredItem = {
  id: "1",
  competitor: "amplitude",
  source: "changelog",
  externalId: "guid-1",
  title: "Schedule experiment stop",
  url: "https://fixture.invalid/releases/schedule-experiment-stop",
  publishedAt: new Date("2026-01-15T00:00:00Z"),
  raw: {},
};

afterEach(() => {
  vi.unstubAllGlobals();
});

/** HEAD probes answer from `types`; GET returns the page HTML. */
function stubHttp(options: { types?: Record<string, string>; html?: string }) {
  const spy = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === "HEAD") {
      const type = options.types?.[url];
      if (!type) return Promise.resolve(new Response("", { status: 404 }));
      return Promise.resolve(new Response("", { status: 200, headers: { "content-type": type } }));
    }
    if (options.html === undefined) return Promise.resolve(new Response("", { status: 500 }));
    return Promise.resolve(
      new Response(options.html, { status: 200, headers: { "content-type": "text/html" } }),
    );
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("extractImageUrls", () => {
  it("prefers the page's own social preview", () => {
    const html = `
      <html><head>
        <meta property="og:image" content="/img/hero.png" />
        <meta name="twitter:image" content="https://cdn.invalid/twitter.png" />
      </head><body><main><img src="/img/inline.png" /></main></body></html>`;
    expect(extractImageUrls(html, "https://fixture.invalid/releases/x")).toEqual([
      "https://fixture.invalid/img/hero.png",
      "https://cdn.invalid/twitter.png",
      "https://fixture.invalid/img/inline.png",
    ]);
  });

  it("skips logos, icons, tracking pixels, and SVGs", () => {
    const html = `<main>
      <img src="/logo.png" /><img src="/icons/star.png" /><img src="/px/1x1.gif" />
      <img src="/diagram.svg" /><img src="/screenshot.png" />
    </main>`;
    expect(extractImageUrls(html, "https://fixture.invalid/a")).toEqual([
      "https://fixture.invalid/screenshot.png",
    ]);
  });

  it("skips images that declare themselves tiny", () => {
    const html = `<main><img src="/thumb.png" width="48" /><img src="/wide.png" width="1200" /></main>`;
    expect(extractImageUrls(html, "https://fixture.invalid/a")).toEqual([
      "https://fixture.invalid/wide.png",
    ]);
  });

  it("takes the widest entry from a srcset", () => {
    const html = `<main><img srcset="/small.png 400w, /large.png 1600w" /></main>`;
    expect(extractImageUrls(html, "https://fixture.invalid/a")).toEqual([
      "https://fixture.invalid/large.png",
    ]);
  });

  it("ignores data URIs and other schemes", () => {
    const html = `<main><img src="data:image/png;base64,AAA" /><img src="mailto:a@b.c" /></main>`;
    expect(extractImageUrls(html, "https://fixture.invalid/a")).toEqual([]);
  });
});

describe("screenshotUrl", () => {
  it("substitutes the page into the template", () => {
    expect(screenshotUrl("https://shots.invalid/{url}", "https://a.invalid/b")).toBe(
      "https://shots.invalid/https://a.invalid/b",
    );
  });

  it("appends when the template has no placeholder", () => {
    expect(screenshotUrl("https://shots.invalid/", "https://a.invalid/b")).toBe(
      "https://shots.invalid/https://a.invalid/b",
    );
  });
});

describe("imageFromRaw", () => {
  it("reads an image a feed or tweet attached", () => {
    expect(imageFromRaw({ raw: { image: " https://cdn.invalid/a.png " } })).toBe(
      "https://cdn.invalid/a.png",
    );
  });

  it("returns null when there is nothing usable", () => {
    expect(imageFromRaw({ raw: {} })).toBeNull();
    expect(imageFromRaw({ raw: { image: "" } })).toBeNull();
    expect(imageFromRaw({ raw: { image: 42 } })).toBeNull();
  });
});

describe("resolveFeatureImage", () => {
  it("uses what the feed attached, without reading the page", async () => {
    const spy = stubHttp({ types: { "https://cdn.invalid/a.png": "image/png" } });
    const image = await resolveFeatureImage(config, {
      ...item,
      raw: { image: "https://cdn.invalid/a.png" },
    });

    expect(image).toEqual({
      url: "https://cdn.invalid/a.png",
      altText: "Amplitude: Schedule experiment stop",
      origin: "feed",
    });
    expect(spy).toHaveBeenCalledOnce();
  });

  it("marks a tweet's picture as coming from X", async () => {
    stubHttp({ types: { "https://pbs.invalid/media/a.jpg": "image/jpeg" } });
    const image = await resolveFeatureImage(config, {
      ...item,
      source: "x",
      raw: { image: "https://pbs.invalid/media/a.jpg" },
    });
    expect(image.origin).toBe("x");
  });

  it("falls back to the page's own image when the feed has none", async () => {
    stubHttp({
      html: `<head><meta property="og:image" content="https://cdn.invalid/og.png" /></head>`,
      types: { "https://cdn.invalid/og.png": "image/png" },
    });
    const image = await resolveFeatureImage(config, item);
    expect(image).toMatchObject({ url: "https://cdn.invalid/og.png", origin: "page" });
  });

  it("skips a candidate that does not actually serve an image", async () => {
    stubHttp({
      html: `<head>
        <meta property="og:image" content="https://cdn.invalid/gone.png" />
        <meta name="twitter:image" content="https://cdn.invalid/good.png" />
      </head>`,
      types: { "https://cdn.invalid/good.png": "image/webp" },
    });
    const image = await resolveFeatureImage(config, item);
    expect(image.url).toBe("https://cdn.invalid/good.png");
  });

  it("screenshots the feature page when it offers no picture", async () => {
    const shot = `https://shots.invalid/${item.url}`;
    stubHttp({ html: "<main><p>no pictures here</p></main>", types: { [shot]: "image/jpeg" } });
    const image = await resolveFeatureImage(config, item);
    expect(image).toMatchObject({ url: shot, origin: "screenshot" });
  });

  it("never returns without an image, even when everything fails", async () => {
    stubHttp({});
    const image = await resolveFeatureImage(config, item);
    expect(image.origin).toBe("generated");
    expect(image.url).toBe(generatedCardUrl(item));
    expect(image.url).toContain("Amplitude");
  });
});
