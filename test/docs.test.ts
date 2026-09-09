import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config.js";
import { MemoryStore } from "../src/db/memory.js";
import {
  clearFetchedDocs,
  docExcerpt,
  focusTerms,
  gatherDocsContext,
  topUpDocsForActions,
} from "../src/posthog/docs.js";
import type { PostHogPage, StoredItem } from "../src/types.js";

const config = { httpTimeoutMs: 5_000, userAgent: "test-agent" } as Config;

const item: StoredItem = {
  id: "1",
  competitor: "amplitude",
  source: "changelog",
  externalId: "guid-1",
  title: "Schedule experiment stop",
  url: "https://fixture.invalid/releases/schedule-experiment-stop",
  publishedAt: new Date("2026-01-15T00:00:00Z"),
  raw: { body: "You can now pick a date and time for an experiment to stop on its own." },
};

const lifecycle: PostHogPage = {
  url: "https://posthog.com/docs/experiments/managing-lifecycle",
  title: "Managing the experiment lifecycle",
  text: "Experiments move through draft, running, and complete. You start an experiment by clicking launch, and you stop it by clicking complete when you have enough data. There is no end date field, so stopping is a manual step. Cohort analysis is unaffected.",
  mentions: [],
  fetchedAt: new Date("2026-01-10T00:00:00Z"),
};

beforeEach(() => {
  clearFetchedDocs();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubHtml(html: string) {
  const spy = vi.fn(() =>
    Promise.resolve(new Response(html, { status: 200, headers: { "content-type": "text/html" } })),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("focusTerms", () => {
  it("takes the signal's own vocabulary, plus the matched product's keywords", () => {
    const terms = focusTerms("Schedule experiment stop on a date you pick");
    expect(terms).toContain("experiment");
    expect(terms).toContain("schedule");
  });

  it("drops words too common to tell two products apart", () => {
    expect(focusTerms("Introducing a new PostHog release")).not.toContain("posthog");
    expect(focusTerms("Introducing a new PostHog release")).not.toContain("introducing");
  });
});

describe("docExcerpt", () => {
  it("keeps the lead sentence, because it says what the product is", () => {
    expect(docExcerpt(lifecycle.text, ["schedule"])).toContain(
      "Experiments move through draft, running, and complete.",
    );
  });

  it("keeps the sentences that speak to the signal and drops the rest", () => {
    const excerpt = docExcerpt(lifecycle.text, ["stop", "end date", "manual"]);
    expect(excerpt).toContain("There is no end date field");
    expect(excerpt).not.toContain("Cohort analysis is unaffected");
  });

  it("stays inside its budget", () => {
    const excerpt = docExcerpt("A ".repeat(2_000), ["a"], 300);
    expect(excerpt.length).toBeLessThanOrEqual(300);
  });

  it("returns nothing for a page with no text, rather than throwing", () => {
    expect(docExcerpt("", ["stop"])).toBe("");
  });
});

describe("gatherDocsContext", () => {
  it("reads the index instead of the network when the page is already there", async () => {
    const store = new MemoryStore();
    await store.upsertPage(lifecycle);
    const spy = stubHtml("<html><body><p>should not be fetched</p></body></html>");

    const docs = await gatherDocsContext(config, store, item, { maxFetches: 0 });

    expect(docs.map((doc) => doc.url)).toEqual([lifecycle.url]);
    expect(docs[0]?.excerpt).toContain("There is no end date field");
    expect(spy).not.toHaveBeenCalled();
  });

  it("fetches a docs page the index does not have, and stores it for next time", async () => {
    const store = new MemoryStore();
    const spy = stubHtml(
      `<html><head><title>Scheduled flag changes</title></head><body><main>
        <ul><li>How to schedule a change</li><li>Edit a scheduled change</li></ul>
        <p>You can schedule a feature flag change to happen on a future date, including turning a flag off.</p>
      </main></body></html>`,
    );

    const docs = await gatherDocsContext(config, store, item, { maxUrls: 1, maxFetches: 1 });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(docs[0]?.url).toBe("https://posthog.com/docs/feature-flags/scheduled-flag-changes");
    expect(docs[0]?.title).toBe("Scheduled flag changes");
    // The lead is the page's first real sentence, not its contents list.
    expect(docs[0]?.excerpt).toMatch(/^You can schedule a feature flag change/);
    expect(docs[0]?.excerpt).not.toContain("Edit a scheduled change");
    expect(await store.getPages([docs[0]?.url ?? ""])).toHaveLength(1);
  });

  it("gives the model both sides of the Amplitude scheduling case", async () => {
    const store = new MemoryStore();
    await store.upsertPage(lifecycle);
    await store.upsertPage({
      url: "https://posthog.com/docs/feature-flags/scheduled-flag-changes",
      title: "Scheduled flag changes",
      text: "Scheduled flag changes let you set a date for a flag to change. You can schedule a rollout percentage change or turn the flag off.",
      mentions: [],
      fetchedAt: new Date(),
    });
    await store.upsertPage({
      url: "https://posthog.com/docs/experiments",
      title: "Experiments",
      text: "Experiments let you test changes against a control group and read the result.",
      mentions: [],
      fetchedAt: new Date(),
    });

    const docs = await gatherDocsContext(config, store, item, { maxFetches: 0 });
    const urls = docs.map((doc) => doc.url);

    expect(urls).toContain("https://posthog.com/docs/experiments/managing-lifecycle");
    expect(urls).toContain("https://posthog.com/docs/feature-flags/scheduled-flag-changes");
  });

  it("caps how many pages it will fetch in one go", async () => {
    const store = new MemoryStore();
    const spy = stubHtml("<html><body><main><p>Some documentation about experiments.</p></main></body></html>");

    const docs = await gatherDocsContext(config, store, item, { maxUrls: 6, maxFetches: 2 });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(docs).toHaveLength(2);
  });

  it("returns nothing when the signal names no product we hold docs for", async () => {
    const store = new MemoryStore();
    const spy = stubHtml("<html><body><p>x</p></body></html>");

    const docs = await gatherDocsContext(config, store, {
      title: "We redesigned our website footer",
      raw: {},
    });

    expect(docs).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps going when a docs page cannot be fetched", async () => {
    const store = new MemoryStore();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("nope", { status: 404 }))),
    );

    await expect(
      gatherDocsContext(config, store, item, { maxUrls: 1, maxFetches: 1 }),
    ).resolves.toEqual([]);
  });
});

describe("topUpDocsForActions", () => {
  const enhanceProxy = {
    type: "consider_enhancing" as const,
    feature: "Managed reverse proxy",
    detail: "Offer a managed proxy on a domain the customer owns.",
  };

  it("reads the docs for a product the verdict named but the signal never matched", async () => {
    const store = new MemoryStore();
    await store.upsertPage({
      url: "https://posthog.com/docs/advanced/proxy",
      title: "Deploy a reverse proxy",
      text: "A reverse proxy routes events through your own domain, which ad blockers have not cataloged. PostHog's managed reverse proxy handles the certificate for you.",
      mentions: [],
      fetchedAt: new Date(),
    });
    const spy = stubHtml("<html><body><p>should not be fetched</p></body></html>");

    const docs = await topUpDocsForActions(config, store, item, [enhanceProxy], []);

    expect(docs.map((doc) => doc.url)).toEqual(["https://posthog.com/docs/advanced/proxy"]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("fetches that page when the index has never seen it", async () => {
    const store = new MemoryStore();
    const spy = stubHtml(
      "<html><head><title>Deploy a reverse proxy</title></head><body><main><p>PostHog runs a managed reverse proxy on a subdomain you own.</p></main></body></html>",
    );

    const docs = await topUpDocsForActions(config, store, item, [enhanceProxy], []);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(docs[0]?.excerpt).toContain("managed reverse proxy");
  });

  it("looks nothing up for a product whose docs are already in context", async () => {
    const store = new MemoryStore();
    const spy = stubHtml("<html><body><p>should not be fetched</p></body></html>");
    const inContext = [
      {
        url: "https://posthog.com/docs/experiments/managing-lifecycle",
        title: "Managing the experiment lifecycle",
        excerpt: "You stop an experiment by hand.",
      },
    ];

    const docs = await topUpDocsForActions(
      config,
      store,
      item,
      [{ type: "consider_enhancing", feature: "Experiments", detail: "Add an end time." }],
      inContext,
    );

    expect(docs).toEqual(inContext);
    expect(spy).not.toHaveBeenCalled();
  });

  it("costs an excerpt rather than the verdict when the fetch fails", async () => {
    const store = new MemoryStore();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("nope", { status: 404 }))));

    await expect(topUpDocsForActions(config, store, item, [enhanceProxy], [])).resolves.toEqual([]);
  });
});
