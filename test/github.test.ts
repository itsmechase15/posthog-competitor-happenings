import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config.js";
import {
  buildIssueBody,
  buildIssueDraft,
  createIssueCreator,
  DisabledIssueCreator,
  GitHubIssueCreator,
} from "../src/github/issue.js";
import type { AnalyzedItem, FeatureImage } from "../src/types.js";

const analyzed: AnalyzedItem = {
  item: {
    id: "1",
    competitor: "amplitude",
    source: "changelog",
    externalId: "guid-1",
    title: "Schedule experiment stop",
    url: "https://fixture.invalid/releases/schedule-experiment-stop",
    publishedAt: new Date("2026-01-15T00:00:00Z"),
    raw: {},
  },
  analysis: {
    impact: "notable",
    summary: "Amplitude experiments can now be scheduled to stop on their own.",
    keyPoints: ["Set a start time, an end time, or both."],
    action: "update_pages",
    actionDetail: "PostHog has no end time. The compare page says neither tool does.",
    posthogRefs: [
      {
        url: "https://posthog.com/compare/best-amplitude-alternatives",
        claim: "Both tools require manual experiment management.",
        suggestedEdit: "Note that Amplitude now schedules stops.",
      },
    ],
    openQuestions: ["Does this cover flags outside experiments?"],
  },
  model: "claude-opus-5",
};

const image: FeatureImage = {
  url: "https://cdn.invalid/hero.png",
  altText: "Amplitude: Schedule experiment stop",
  origin: "page",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildIssueDraft", () => {
  const draft = buildIssueDraft(analyzed, image);

  it("titles the issue competitor plus feature", () => {
    expect(draft.title).toBe("Amplitude: Schedule experiment stop");
  });

  it("labels competitor, source, impact, and action", () => {
    expect(draft.labels).toEqual([
      "competitor-happenings",
      "amplitude",
      "source:changelog",
      "impact:notable",
      "action:update-pages",
    ]);
  });

  it("carries the detail Slack no longer shows", () => {
    for (const fragment of [
      "## What you need to know\nAmplitude experiments can now be scheduled to stop on their own.",
      "## Impact\nNotable",
      "## More detail\n- Set a start time, an end time, or both.",
      "**Update pages** — PostHog has no end time. The compare page says neither tool does.",
      "https://posthog.com/compare/best-amplitude-alternatives",
      "**Suggested edit:** Note that Amplitude now schedules stops.",
      "Does this cover flags outside experiments?",
      "https://fixture.invalid/releases/schedule-experiment-stop",
    ]) {
      expect(draft.body).toContain(fragment);
    }
  });

  it("embeds the feature image", () => {
    expect(draft.body).toContain('<img src="https://cdn.invalid/hero.png"');
    expect(draft.body).toContain("Feature image (page): https://cdn.invalid/hero.png");
  });

  it("says so rather than leaving a section blank", () => {
    const body = buildIssueBody(
      { ...analyzed, analysis: { ...analyzed.analysis, posthogRefs: [], openQuestions: [] } },
      null,
    );
    expect(body).toContain("No indexed PostHog.com page covers this yet");
    expect(body).toContain("None raised.");
    expect(body).not.toContain("<img");
  });
});

describe("GitHubIssueCreator", () => {
  it("posts the draft and returns the new issue", async () => {
    const spy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ number: 7, html_url: "https://github.com/o/r/issues/7" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", spy);

    const issue = await new GitHubIssueCreator("o/r", "ghs-test", 5_000).create(
      buildIssueDraft(analyzed, image),
    );

    expect(issue).toEqual({ number: 7, url: "https://github.com/o/r/issues/7" });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/o/r/issues");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer ghs-test");
    expect(JSON.parse(init.body as string).labels).toContain("impact:notable");
  });

  it("retries without labels when the repo rejects one", async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Validation Failed" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ number: 8, html_url: "https://github.com/o/r/issues/8" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", spy);

    const issue = await new GitHubIssueCreator("o/r", "ghs-test", 5_000).create(
      buildIssueDraft(analyzed, image),
    );

    expect(issue?.number).toBe(8);
    expect(JSON.parse((spy.mock.calls[1]?.[1] as RequestInit).body as string).labels).toEqual([]);
  });

  it("returns null instead of failing the run when GitHub refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "Bad credentials" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const issue = await new GitHubIssueCreator("o/r", "bad", 5_000).create(
      buildIssueDraft(analyzed, image),
    );
    expect(issue).toBeNull();
  });
});

describe("createIssueCreator", () => {
  const config = (overrides: Partial<Config>): Config =>
    ({
      dryRun: false,
      githubToken: undefined,
      githubRepo: "itsmechase15/posthog-competitor-happenings",
      httpTimeoutMs: 5_000,
      ...overrides,
    }) as Config;

  it("opens issues when a token is available", () => {
    const creator = createIssueCreator(config({ githubToken: "ghs-test" }));
    expect(creator).toBeInstanceOf(GitHubIssueCreator);
    expect(creator.description).toContain("itsmechase15/posthog-competitor-happenings");
  });

  it("writes nothing during a dry run, even with a token", () => {
    const creator = createIssueCreator(config({ dryRun: true, githubToken: "ghs-test" }));
    expect(creator).toBeInstanceOf(DisabledIssueCreator);
    expect(creator.description).toContain("dry run");
  });

  it("says which secret is missing when there is no token", () => {
    expect(createIssueCreator(config({})).description).toContain("GITHUB_TOKEN");
  });
});
