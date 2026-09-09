import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config.js";
import {
  buildIssueBody,
  buildIssueDraft,
  buildIssueDrafts,
  createIssueCreator,
  DisabledIssueCreator,
  GitHubIssueCreator,
} from "../src/github/issue.js";
import type {
  AnalyzedItem,
  FeatureImage,
  PostHogRef,
  RecommendedAction,
} from "../src/types.js";

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
    actions: [
      {
        type: "update_pages",
        detail: "PostHog has no end time. The compare page says neither tool does.",
      },
      {
        type: "consider_enhancing",
        feature: "Experiments",
        detail: "PostHog experiments stop manually; a scheduled stop is a small form change.",
      },
    ],
    posthogRefs: [
      {
        url: "https://posthog.com/compare/best-amplitude-alternatives",
        claim: "Both tools require manual experiment management.",
        suggestedEdit: "Note that Amplitude now schedules stops.",
      },
      {
        url: "https://posthog.com/docs/experiments/managing-lifecycle",
        claim: "Experiments are started, paused, and stopped by hand.",
      },
      {
        url: "https://posthog.com/docs/session-replay",
        claim: "Recordings are captured by the web SDK.",
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

const pageAction = analyzed.analysis.actions[0] as RecommendedAction;
const productAction = analyzed.analysis.actions[1] as RecommendedAction;

describe("buildIssueDrafts", () => {
  const drafts = buildIssueDrafts(analyzed, image);

  it("opens one issue per recommended action, not one per alert", () => {
    expect(drafts).toHaveLength(2);
    expect(drafts.map((entry) => entry.action.type)).toEqual([
      "update_pages",
      "consider_enhancing",
    ]);
  });

  it("names the action in each title, so three issues read as three jobs", () => {
    expect(drafts.map((entry) => entry.draft.title)).toEqual([
      "Amplitude: Schedule experiment stop \u2013 Update pages",
      "Amplitude: Schedule experiment stop \u2013 Consider enhancing Experiments",
    ]);
  });

  it("keeps the action title inside GitHub's title limit", () => {
    const long = buildIssueDrafts(
      { ...analyzed, item: { ...analyzed.item, title: "Scheduled stops ".repeat(20) } },
      image,
    );
    for (const { draft } of long) {
      expect(draft.title.length).toBeLessThanOrEqual(120);
      expect(draft.title).toContain("\u2013 ");
    }
  });

  it("routes page work to marketing and product work to product", () => {
    expect(drafts[0]?.draft.labels).toContain("owner:marketing");
    expect(drafts[1]?.draft.labels).toContain("owner:product");
  });

  it("scopes each body to its own action", () => {
    const [pages, product] = drafts.map((entry) => entry.draft.body) as [string, string];
    expect(pages).toContain(
      "## Recommended action\n**Update pages** \u2013 PostHog has no end time.",
    );
    expect(pages).not.toContain("## Recommended action\n**Consider enhancing");
    expect(product).toContain("## Recommended action\n**Consider enhancing Experiments** \u2013");
  });

  it("leaves the sibling actions to their own issues", () => {
    for (const { draft } of drafts) {
      expect(draft.body).not.toContain("Also recommended");
      expect(draft.body).not.toContain("tracked in its own issue");
    }
  });
});

describe("buildIssueDraft", () => {
  const draft = buildIssueDraft(analyzed, image, pageAction);

  it("labels competitor, source, impact, this action, its owner, and its product", () => {
    expect(draft.labels).toEqual([
      "competitor-happenings",
      "amplitude",
      "source:changelog",
      "impact:notable",
      "action:update-pages",
      "owner:marketing",
    ]);
    expect(buildIssueDraft(analyzed, image, productAction).labels).toEqual([
      "competitor-happenings",
      "amplitude",
      "source:changelog",
      "impact:notable",
      "action:consider-enhancing",
      "owner:product",
      "product:experiments",
    ]);
  });

  it("carries the detail Slack no longer shows", () => {
    for (const fragment of [
      "## What you need to know\nAmplitude experiments can now be scheduled to stop on their own.",
      "## Impact\n- [ ] Minor\n- [x] Notable\n- [ ] Major",
      "## More detail\n- Set a start time, an end time, or both.",
      "## Recommended action",
      "**Update pages** \u2013 PostHog has no end time. The compare page says neither tool does.",
      "https://posthog.com/compare/best-amplitude-alternatives",
      "**Suggested edit:** Note that Amplitude now schedules stops.",
      "Does this cover flags outside experiments?",
      "https://fixture.invalid/releases/schedule-experiment-stop",
    ]) {
      expect(draft.body).toContain(fragment);
    }
  });

  it("shows the whole impact scale with only this alert's level checked", () => {
    for (const [impact, expected] of [
      ["minor", "## Impact\n- [x] Minor\n- [ ] Notable\n- [ ] Major"],
      ["major", "## Impact\n- [ ] Minor\n- [ ] Notable\n- [x] Major"],
    ] as const) {
      const body = buildIssueBody(
        { ...analyzed, analysis: { ...analyzed.analysis, impact } },
        image,
        pageAction,
      );
      expect(body).toContain(expected);
    }
  });

  it("gives marketing every cited page and the edits suggested for them", () => {
    expect(draft.body).toContain("## PostHog pages to update");
    expect(draft.body).toContain("https://posthog.com/compare/best-amplitude-alternatives");
    expect(draft.body).toContain("**Suggested edit:** Note that Amplitude now schedules stops.");
    expect(draft.body).toContain("https://posthog.com/docs/session-replay");
  });

  it("gives product only the docs that back its own action", () => {
    const product = buildIssueDraft(analyzed, image, productAction).body;
    expect(product).toContain("## PostHog pages for context");
    expect(product).toContain("https://posthog.com/docs/experiments/managing-lifecycle");
    expect(product).toContain(
      "**Claim today:** Experiments are started, paused, and stopped by hand.",
    );
    // The compare page and its edit are the marketing issue's job, and session
    // replay is some other action's product.
    expect(product).not.toContain("https://posthog.com/compare/best-amplitude-alternatives");
    expect(product).not.toContain("Suggested edit");
    expect(product).not.toContain("https://posthog.com/docs/session-replay");
  });

  it("says when no docs page backs a product action, rather than borrowing marketing's", () => {
    const body = buildIssueBody(
      {
        ...analyzed,
        analysis: {
          ...analyzed.analysis,
          posthogRefs: [analyzed.analysis.posthogRefs[0] as PostHogRef],
        },
      },
      image,
      productAction,
    );
    expect(body).toContain("## PostHog pages for context");
    expect(body).toContain("No PostHog docs page in context speaks to this action");
    expect(body).not.toContain("best-amplitude-alternatives");
  });

  it("says who owns the work in the header", () => {
    expect(draft.body).toContain("owned by **marketing**");
    expect(buildIssueDraft(analyzed, image, productAction).body).toContain(
      "owned by **product**",
    );
  });

  it("keeps the action title plain, because Slack mrkdwn links are not markdown", () => {
    expect(draft.body).not.toContain("<https://posthog.com/experiments|");
  });

  it("embeds the feature image", () => {
    expect(draft.body).toContain('<img src="https://cdn.invalid/hero.png"');
    expect(draft.body).toContain("Feature image (page): https://cdn.invalid/hero.png");
  });

  it("says so rather than leaving a section blank", () => {
    const body = buildIssueBody(
      { ...analyzed, analysis: { ...analyzed.analysis, posthogRefs: [], openQuestions: [] } },
      null,
      pageAction,
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
      buildIssueDraft(analyzed, image, pageAction),
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
      buildIssueDraft(analyzed, image, pageAction),
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
      buildIssueDraft(analyzed, image, pageAction),
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
