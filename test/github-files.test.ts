import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config.js";
import {
  createFileStore,
  DisabledFileStore,
  GitHubFileStore,
} from "../src/github/files.js";

/**
 * Committing a screenshot to this repo, which is the only way a GitHub issue
 * will render an image it did not get from a browser upload.
 *
 * The rule under every case: a file that cannot be written costs the issue its
 * pictures and nothing else, so `put` returns null rather than throwing.
 */

const PNG = Buffer.from("fake png bytes");
const PATH = "artifacts/update-pages/2026-09-16/compare-mixpanel-abcd1234.png";

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A repo whose default branch is `main`, and a path that holds nothing yet. */
function freshRepo() {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith("/repos/o/r")) return json(200, { default_branch: "main" });
    if (url.includes("/contents/") && url.includes("?ref=")) {
      return json(404, { message: "Not Found" });
    }
    return json(201, { content: { path: PATH } });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHubFileStore", () => {
  it("commits the file and hands back a raw URL the issue can embed", async () => {
    const spy = freshRepo();
    vi.stubGlobal("fetch", spy);

    const url = await new GitHubFileStore("o/r", "ghs-test", 5_000).put(PATH, PNG, "Add the before of /compare/mixpanel");

    expect(url).toBe(`https://raw.githubusercontent.com/o/r/main/${PATH}`);
    const put = spy.mock.calls.find((call) => call[1]?.method === "PUT") as [string, RequestInit];
    expect(put[0]).toBe(`https://api.github.com/repos/o/r/contents/${PATH}`);
    const payload = JSON.parse(put[1].body as string) as Record<string, string>;
    expect(payload.content).toBe(PNG.toString("base64"));
    expect(payload.branch).toBe("main");
    expect(payload.message).toBe("Add the before of /compare/mixpanel");
  });

  it("writes to whichever branch the repo calls its default", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/repos/o/r")) return json(200, { default_branch: "trunk" });
        if (url.includes("?ref=")) return json(404, { message: "Not Found" });
        return json(201, {});
      }),
    );

    const url = await new GitHubFileStore("o/r", "ghs-test", 5_000).put(PATH, PNG, "Add the before of /compare/mixpanel");
    expect(url).toBe(`https://raw.githubusercontent.com/o/r/trunk/${PATH}`);
  });

  /**
   * The file name is a hash of the edit and the day, so a path that exists
   * already holds these exact bytes. Writing it again changes nothing.
   */
  it("re-uses a shot that is already committed instead of writing it twice", async () => {
    const spy = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith("/repos/o/r")) return json(200, { default_branch: "main" });
      return json(200, { content: { path: PATH } });
    });
    vi.stubGlobal("fetch", spy);

    const url = await new GitHubFileStore("o/r", "ghs-test", 5_000).put(PATH, PNG, "Add the before of /compare/mixpanel");

    expect(url).toBe(`https://raw.githubusercontent.com/o/r/main/${PATH}`);
    expect(spy.mock.calls.some((call) => call[1]?.method === "PUT")).toBe(false);
  });

  it("takes the URL when something else committed the same path first", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/repos/o/r")) return json(200, { default_branch: "main" });
        if (url.includes("?ref=")) return json(404, { message: "Not Found" });
        return json(409, { message: "is at 0a1b but expected 2c3d" });
      }),
    );

    const url = await new GitHubFileStore("o/r", "ghs-test", 5_000).put(PATH, PNG, "Add the before of /compare/mixpanel");
    expect(url).toBe(`https://raw.githubusercontent.com/o/r/main/${PATH}`);
  });

  it("returns null rather than failing the run when the write is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/repos/o/r")) return json(200, { default_branch: "main" });
        if (url.includes("?ref=")) return json(404, { message: "Not Found" });
        return json(403, { message: "Resource not accessible by integration" });
      }),
    );

    expect(await new GitHubFileStore("o/r", "ghs-test", 5_000).put(PATH, PNG, "Add the before of /compare/mixpanel")).toBeNull();
  });

  it("falls back to main when the repo will not say what its default branch is", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/repos/o/r")) return json(404, { message: "Not Found" });
        if (url.includes("?ref=")) return json(404, { message: "Not Found" });
        return json(201, {});
      }),
    );

    const url = await new GitHubFileStore("o/r", "ghs-test", 5_000).put(PATH, PNG, "Add the before of /compare/mixpanel");
    expect(url).toBe(`https://raw.githubusercontent.com/o/r/main/${PATH}`);
  });

  it("looks the default branch up once, however many shots a run commits", async () => {
    const spy = freshRepo();
    vi.stubGlobal("fetch", spy);

    const store = new GitHubFileStore("o/r", "ghs-test", 5_000);
    await store.put(PATH, PNG, "Add the before of /compare/mixpanel");
    await store.put(PATH.replace("abcd1234", "beef5678"), PNG, "Add the before of /compare/mixpanel");

    expect(spy.mock.calls.filter((call) => call[0].endsWith("/repos/o/r"))).toHaveLength(1);
  });
});

describe("createFileStore", () => {
  const config = (overrides: Partial<Config>): Config =>
    ({
      dryRun: false,
      githubToken: undefined,
      githubRepo: "itsmechase15/posthog-competitor-happenings",
      httpTimeoutMs: 5_000,
      ...overrides,
    }) as Config;

  it("commits screenshots when there is a token", () => {
    const store = createFileStore(config({ githubToken: "ghs-test" }));
    expect(store).toBeInstanceOf(GitHubFileStore);
    expect(store.description).toContain("artifacts/update-pages");
  });

  it("writes nothing during a dry run, and says where the card would have gone", async () => {
    const store = createFileStore(config({ dryRun: true, githubToken: "ghs-test" }));
    expect(store).toBeInstanceOf(DisabledFileStore);
    expect(await store.put(PATH, PNG, "Add the before of /compare/mixpanel")).toBeNull();
  });

  it("names the missing secret when there is no token", () => {
    expect(createFileStore(config({})).description).toContain("GITHUB_TOKEN is not set");
  });
});
