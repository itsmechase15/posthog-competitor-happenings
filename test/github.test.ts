import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config.js";
import {
  buildIssueBody,
  buildIssueDraft,
  buildIssueDrafts,
  createIssueCreator,
  createIssueEditor,
  DisabledIssueCreator,
  DisabledIssueEditor,
  GitHubIssueCreator,
  GitHubIssueEditor,
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
        // The copy that goes on the page, which is what an update_pages issue
        // is for. `src/analysis/rewrite.ts` is where it has to survive.
        proposedText:
          "Amplitude schedules an experiment to stop on a date you pick. PostHog experiments stop when you stop them, so a fixed-length test needs someone to end it.",
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

  it("labels competitor, source, impact, this action, its owner, its teams, and its product", () => {
    expect(draft.labels).toEqual([
      "competitor-happenings",
      "amplitude",
      "source:changelog",
      "impact:notable",
      "action:update-pages",
      "owner:marketing",
      "team:marketing",
    ]);

    expect(buildIssueDraft(analyzed, image, productAction).labels).toEqual([
      "competitor-happenings",
      "amplitude",
      "source:changelog",
      "impact:notable",
      "action:consider-enhancing",
      "owner:product",
      "team:experiments",
      "product:experiments",
    ]);
  });

  it("mints no product label for a feature the catalog does not know", () => {
    const unknown = buildIssueDraft(analyzed, image, {
      type: "consider_enhancing",
      feature: "Time travel",
      detail: "PostHog cannot replay a session backwards.",
    });
    expect(unknown.labels.some((label) => label.startsWith("product:"))).toBe(false);
    expect(unknown.labels).not.toContain("product:time-travel");
  });

  it("labels a platform surface as one, because nobody owns its roadmap", () => {
    const proxy = buildIssueDraft(analyzed, image, {
      type: "consider_enhancing",
      feature: "Managed reverse proxy",
      detail: "Bring the managed proxy into onboarding.",
    });
    expect(proxy.labels).toContain("platform:reverse-proxy");
  });

  it("names the small teams in the body, with the spirit animal each one picked", () => {
    expect(draft.body).toContain("## Related team(s)\nMarketing \u{1F986}");
    expect(buildIssueDraft(analyzed, image, productAction).body).toContain(
      "## Related team(s)\nExperiments",
    );
  });

  it("names the team that owns the plumbing, not a department", () => {
    const sdk = buildIssueDraft(analyzed, image, {
      type: "consider_building",
      detail: "Ship an SDK option that routes ingestion through a domain the customer owns.",
    });
    expect(sdk.body).toContain("## Related team(s)\nIngestion, Client Libraries");
    expect(sdk.labels).toContain("team:ingestion");
    expect(sdk.labels).toContain("team:client-libraries");
    expect(sdk.labels).not.toContain("team:engineering");
  });

  it("takes the teams the model suggested when they are real small teams", () => {
    const suggested = buildIssueDraft(analyzed, image, {
      ...productAction,
      teams: ["Experiments", "Feature Flags"],
    });
    expect(suggested.body).toContain("## Related team(s)\nExperiments, Feature Flags \u{1F9AB}");
    expect(suggested.labels).toContain("team:feature-flags");
  });

  it("carries the detail Slack no longer shows", () => {
    for (const fragment of [
      "## What you need to know\nAmplitude experiments can now be scheduled to stop on their own.",
      "## Impact\n- [ ] Minor \u2013 no new feature or enhancement in the post\n- [x] Notable \u2013 an enhancement of an existing feature\n- [ ] Major \u2013 a brand-new feature that did not exist before",
      "## More detail\n- Set a start time, an end time, or both.",
      "## Recommended action",
      "**Update pages** \u2013 PostHog has no end time. The compare page says neither tool does.",
      "https://posthog.com/compare/best-amplitude-alternatives",
      "**Why** \u2013 Note that Amplitude now schedules stops.",
      "Does this cover flags outside experiments?",
      "https://fixture.invalid/releases/schedule-experiment-stop",
    ]) {
      expect(draft.body).toContain(fragment);
    }
  });

  it("leads with the news, then the detail, then how much it matters, then the ask", () => {
    for (const body of [draft.body, buildIssueDraft(analyzed, image, productAction).body]) {
      const headings = [...body.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
      expect(headings.slice(0, 4)).toEqual([
        "What you need to know",
        "More detail",
        "Impact",
        "Recommended action",
      ]);
      expect(headings.indexOf("Open questions")).toBeGreaterThan(
        headings.indexOf("Recommended action"),
      );
      expect(headings.at(-1)).toBe("Sources");
    }

    const withGap = buildIssueBody(analyzed, image, {
      ...productAction,
      gap: "PostHog experiments have no scheduled stop.",
    });
    const gapHeadings = [...withGap.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(gapHeadings.slice(0, 5)).toEqual([
      "What you need to know",
      "More detail",
      "Impact",
      "Recommended action",
      "The gap this closes",
    ]);
  });

  it("tags the source in the header and the sources link the way Slack does", () => {
    expect(draft.body).toContain("**Amplitude** · changelog · published 2026-01-15");
    expect(draft.body).toContain(
      "- [Amplitude changelog](https://fixture.invalid/releases/schedule-experiment-stop)",
    );

    const fromTheirSite = buildIssueBody(
      { ...analyzed, item: { ...analyzed.item, source: "blog" } },
      image,
      pageAction,
    );
    expect(fromTheirSite).toContain("**Amplitude** · article · published 2026-01-15");
    expect(fromTheirSite).toContain("- [Amplitude article](");
  });

  it("shows the whole impact scale, with what each level means and only this alert's level checked", () => {
    for (const [impact, expected] of [
      ["minor", "- [x] Minor \u2013 no new feature or enhancement in the post"],
      ["major", "- [x] Major \u2013 a brand-new feature that did not exist before"],
    ] as const) {
      const body = buildIssueBody(
        { ...analyzed, analysis: { ...analyzed.analysis, impact } },
        image,
        pageAction,
      );
      expect(body).toContain(expected);
    }
  });

  it("gives marketing the pages it can edit and the copy to put on them", () => {
    expect(draft.body).toContain("## PostHog pages to update");
    expect(draft.body).toContain("https://posthog.com/compare/best-amplitude-alternatives");
    expect(draft.body).toContain("**Why** \u2013 Note that Amplitude now schedules stops.");
  });

  /**
   * The whole point of an update_pages issue: the page as it reads now, and
   * the words to put there instead, side by side and ready to paste.
   */
  describe("the exact rewrite", () => {
    it("shows the current copy and the replacement as quoted blocks", () => {
      expect(draft.body).toContain(
        [
          "### https://posthog.com/compare/best-amplitude-alternatives",
          "",
          "**On the page today**",
          "> Both tools require manual experiment management.",
          "",
          "**Replace it with**",
          "> Amplitude schedules an experiment to stop on a date you pick. PostHog experiments stop when you stop them, so a fixed-length test needs someone to end it.",
          "",
          "**Why** \u2013 Note that Amplitude now schedules stops.",
        ].join("\n"),
      );
    });

    it("carries the rewrite whole, so nobody has to go and write the rest", () => {
      const ref = analyzed.analysis.posthogRefs[0] as PostHogRef;
      expect(draft.body).toContain(ref.proposedText as string);
    });

    it("keeps a multi-paragraph rewrite readable as a quote", () => {
      const body = buildIssueBody(
        {
          ...analyzed,
          analysis: {
            ...analyzed.analysis,
            posthogRefs: [
              {
                ...(analyzed.analysis.posthogRefs[0] as PostHogRef),
                proposedText: "Amplitude schedules a stop.\nPostHog stops experiments by hand.",
              },
            ],
          },
        },
        image,
        pageAction,
      );
      expect(body).toContain("> Amplitude schedules a stop.\n>\n> PostHog stops experiments by hand.");
    });

    it("says so when an edit came back with no copy, rather than looking complete", () => {
      const body = buildIssueBody(
        {
          ...analyzed,
          analysis: {
            ...analyzed.analysis,
            posthogRefs: [
              {
                url: "https://posthog.com/compare/best-amplitude-alternatives",
                claim: "Both tools require manual experiment management.",
                suggestedEdit: "Note that Amplitude now schedules stops.",
              },
            ],
          },
        },
        image,
        pageAction,
      );
      expect(body).toContain("**Suggested edit:** Note that Amplitude now schedules stops.");
      expect(body).toContain("the wording is still to write");
    });

    it("leaves the product issue alone: its docs are evidence, not copy to edit", () => {
      const product = buildIssueDraft(analyzed, image, productAction).body;
      expect(product).not.toContain("**Replace it with**");
    });
  });

  it("never sends marketing to edit a docs page, however it was cited", () => {
    expect(draft.body).not.toContain("https://posthog.com/docs/session-replay");
    expect(draft.body).not.toContain("https://posthog.com/docs/experiments/managing-lifecycle");
  });

  it("gives product only the docs that back its own action", () => {
    const product = buildIssueDraft(analyzed, image, productAction).body;
    expect(product).toContain("## What PostHog's docs say today");
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
    expect(body).toContain("## What PostHog's docs say today");
    expect(body).toContain("No PostHog docs page describes this part of Experiments yet");
    expect(body).not.toContain("best-amplitude-alternatives");
  });

  /**
   * The section reading empty next to a list of docs URLs is what sent a
   * reader looking for the bug. There is no bug: PostHog documents what
   * PostHog ships, so a gap has no page, and the list underneath is the docs
   * somebody writes afterwards.
   */
  describe("an empty docs section", () => {
    const withoutRefs = (action: RecommendedAction): string =>
      buildIssueBody(
        { ...analyzed, analysis: { ...analyzed.analysis, posthogRefs: [] } },
        null,
        action,
      );

    it("says PostHog has no page because PostHog does not ship it", () => {
      const body = withoutRefs({
        type: "consider_building",
        detail: "Ship a typed Python client for agent code.",
      });
      expect(body).toContain(
        "No PostHog docs page describes this capability, which is what you would expect for something PostHog does not ship",
      );
      expect(body).toContain("that absence is the gap rather than a check that failed");
    });

    it("never says the recommendation went unchecked", () => {
      expect(withoutRefs(productAction)).not.toContain("has been checked against what PostHog");
    });

    it("sends the reader to the section the evidence is actually in", () => {
      const body = withoutRefs({
        ...productAction,
        gap: "PostHog experiments have no scheduled stop.",
        evidenceUrl: "https://posthog.com/docs/experiments/managing-lifecycle",
      });
      expect(body).toContain('The docs the gap itself was read off are under "The gap this closes"');
    });

    it("says what the docs listed under it are for, and only when they are there", () => {
      const future =
        'The pages under "Docs that would change if this ships" are the ones somebody would rewrite after PostHog does this, not evidence for it.';

      const listed = buildIssueBody(
        {
          ...analyzed,
          analysis: { ...analyzed.analysis, posthogRefs: [] },
          docs: [
            {
              url: "https://posthog.com/docs/experiments",
              title: "Experiments",
              excerpt: "Experiments compare variants.",
            },
          ],
        },
        null,
        productAction,
      );
      expect(listed).toContain(future);
      expect(listed).toContain("## Docs that would change if this ships");

      expect(withoutRefs(productAction)).not.toContain(future);
    });
  });

  /**
   * A statement under "Open questions" leaves the reader to work out what is
   * being asked. Analyses stored before that was enforced still render here,
   * so the body is the last place it is checked rather than the first.
   */
  describe("open questions", () => {
    const asked = (questions: string[]): string[] => {
      const body = buildIssueBody(
        { ...analyzed, analysis: { ...analyzed.analysis, openQuestions: questions } },
        null,
        productAction,
      );
      const section = body.split("## Open questions\n")[1]?.split("\n\n")[0] ?? "";
      return section.split("\n").map((line) => line.replace(/^- /, ""));
    };

    it("asks the statement a stored analysis left behind", () => {
      expect(
        asked([
          "Whether Headless is generally available on every Mixpanel plan.",
          "Whether PostHog users writing agent code want a typed Python client",
        ]),
      ).toEqual([
        "Is Headless generally available on every Mixpanel plan?",
        "Do we know whether PostHog users writing agent code want a typed Python client?",
      ]);
    });

    it("renders nothing under the heading that is not a question", () => {
      for (const question of asked([
        "Whether the compare page is stale.",
        "Is this priced per seat?",
        "No docs page covers the Python client.",
      ])) {
        expect(question.endsWith("?") || question.includes("? ")).toBe(true);
      }
    });
  });

  it("names the docs a product action would make wrong if it shipped", () => {
    const product = buildIssueDraft(analyzed, image, productAction).body;
    expect(product).toContain(
      "## Docs that would change if this ships\n- https://posthog.com/docs/experiments/managing-lifecycle",
    );
  });

  it("reads the docs the verdict was checked against, not just the ones it cited", () => {
    const body = buildIssueBody(
      {
        ...analyzed,
        analysis: { ...analyzed.analysis, posthogRefs: [] },
        docs: [
          {
            url: "https://posthog.com/docs/experiments",
            title: "Experiments",
            excerpt: "Experiments compare variants.",
          },
          {
            url: "https://posthog.com/docs/session-replay",
            title: "Session replay",
            excerpt: "Recordings are captured by the web SDK.",
          },
        ],
      },
      image,
      productAction,
    );
    expect(body).toContain(
      "## Docs that would change if this ships\n- https://posthog.com/docs/experiments",
    );
    // Some other product's page, in context for a different action.
    expect(body).not.toContain("- https://posthog.com/docs/session-replay");
  });

  it("leaves the section off a page action, whose whole job is already a page edit", () => {
    expect(draft.body).not.toContain("Docs that would change if this ships");
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

  it("edits through the same token, and writes nothing when there is none", () => {
    expect(createIssueEditor(config({ githubToken: "ghs-test" }))).toBeInstanceOf(GitHubIssueEditor);
    expect(createIssueEditor(config({ dryRun: true, githubToken: "ghs-test" }))).toBeInstanceOf(
      DisabledIssueEditor,
    );
    expect(createIssueEditor(config({})).description).toContain("GITHUB_TOKEN");
  });
});

/** Every review verdict reaches its issue through one of these three calls. */
describe("GitHubIssueEditor", () => {
  const issue = { number: 12, url: "https://github.com/o/r/issues/12" };
  const editor = (): GitHubIssueEditor => new GitHubIssueEditor("o/r", "ghs-test", 5_000);

  const ok = (): Response =>
    new Response(JSON.stringify({ number: 12 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  const refused = (status: number, message: string): Response =>
    new Response(JSON.stringify({ message }), {
      status,
      headers: { "content-type": "application/json" },
    });

  const sent = (spy: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> =>
    JSON.parse((spy.mock.calls[call]?.[1] as RequestInit).body as string) as Record<
      string,
      unknown
    >;

  it("patches the issue and names the state reason GitHub understands", async () => {
    const spy = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", spy);

    expect(
      await editor().update(issue, {
        title: "Amplitude: something \u2013 Consider enhancing Experiments",
        body: "the revised body",
        labels: ["impact:notable", "review:revised"],
        state: "closed",
        stateReason: "not_planned",
      }),
    ).toBe(true);

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/o/r/issues/12");
    expect(init.method).toBe("PATCH");
    expect(sent(spy)).toEqual({
      title: "Amplitude: something \u2013 Consider enhancing Experiments",
      body: "the revised body",
      labels: ["impact:notable", "review:revised"],
      state: "closed",
      state_reason: "not_planned",
    });
  });

  it("closes as not planned and lands the labels in the same request", async () => {
    const spy = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", spy);

    await editor().close(issue, "not_planned", ["review:dropped", "review-pass:done"]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(sent(spy)).toEqual({
      labels: ["review:dropped", "review-pass:done"],
      state: "closed",
      state_reason: "not_planned",
    });
  });

  it("posts a comment to the comments endpoint", async () => {
    const spy = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", spy);

    await editor().comment(issue, "Reviewed by `claude-fable-5-1`: agreed \u2013 it stands.");

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/o/r/issues/12/comments");
    expect(init.method).toBe("POST");
    expect(sent(spy).body).toContain("agreed");
  });

  it("keeps a rewritten body when the repo rejects one of its labels", async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce(refused(422, "Validation Failed"))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", spy);

    expect(await editor().update(issue, { body: "revised", labels: ["review:revised"] })).toBe(true);
    expect(sent(spy, 1)).toEqual({ body: "revised" });
  });

  it("gives up on a labels-only patch it cannot send, rather than patching nothing", async () => {
    const spy = vi.fn().mockResolvedValue(refused(422, "Validation Failed"));
    vi.stubGlobal("fetch", spy);

    // Nothing but labels was asked for, so there is no smaller request to make.
    expect(await editor().update(issue, { labels: ["review:agreed"] })).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("reports a refusal instead of failing the run", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(refused(401, "Bad credentials")));
    expect(await editor().comment(issue, "anything")).toBe(false);
  });

  it("has nothing to edit when no issue was opened", async () => {
    const spy = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", spy);

    expect(await editor().update(null, { labels: ["review:agreed"] })).toBe(false);
    expect(await editor().comment(null, "anything")).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("DisabledIssueEditor", () => {
  it("says what it would have done, including for an issue that was never opened", async () => {
    const spy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", spy);
    const editor = new DisabledIssueEditor("dry run");

    expect(await editor.update(null, { body: "revised", labels: ["review:revised"] })).toBe(false);
    expect(await editor.comment({ number: 3, url: "u" }, "Reviewed by x")).toBe(false);
    expect(await editor.close(null, "not_planned", ["review:dropped"])).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
