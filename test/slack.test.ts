import { describe, expect, it } from "vitest";
import { FALLBACK_MODEL } from "../src/analysis/fallback.js";
import {
  ACTION_HEADING,
  buildSlackMessage,
  ISSUE_LINK_LABEL,
  renderMessageText,
  type SlackMessage,
} from "../src/slack/message.js";
import type { Alert } from "../src/types.js";

const base: Alert = {
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
    keyPoints: [
      "Set a start time, an end time, or both, per experiment or flag.",
      "Removes the manual babysitting a fixed-length test used to need.",
    ],
    actions: [
      {
        type: "consider_enhancing",
        feature: "Experiments",
        detail:
          "PostHog experiments start manually and stop manually; there is no end time. Adding one is a small change to the experiment form.",
      },
      {
        type: "update_pages",
        detail: "The Amplitude compare page says neither tool schedules experiment stops.",
      },
    ],
    posthogRefs: [
      {
        url: "https://posthog.com/compare/best-amplitude-alternatives",
        claim: "Both tools require manual experiment management.",
        suggestedEdit: "Note that Amplitude now schedules stops.",
      },
    ],
    openQuestions: ["Does the schedule apply to feature flags outside experiments?"],
  },
  model: "claude-opus-5",
  image: {
    url: "https://fixture.invalid/images/schedule-stop.png",
    altText: "Amplitude: Schedule experiment stop",
    origin: "page",
  },
  issue: { url: "https://github.com/itsmechase15/posthog-competitor-happenings/issues/7", number: 7 },
};

describe("buildSlackMessage", () => {
  const message = buildSlackMessage(base);
  const blocks = message.blocks as Array<Record<string, any>>;
  const rendered = JSON.stringify(message);

  it("opens with the feature image, before any text", () => {
    expect(blocks[0]).toEqual({
      type: "image",
      image_url: "https://fixture.invalid/images/schedule-stop.png",
      alt_text: "Amplitude: Schedule experiment stop",
    });
  });

  it("puts the one-sentence summary under the KNOW heading, not on an unlabelled line", () => {
    const first = blocks[1]?.text?.text as string;
    expect(first).toBe(
      "*What you need to KNOW*\nAmplitude experiments can now be scheduled to stop on their own.",
    );
    expect(first).not.toContain("· changelog");
  });

  it("puts impact directly under the KNOW sentence", () => {
    expect(blocks[2]?.text?.text).toBe("*Impact*  :large_orange_circle: Notable");
  });

  it("uses that same sentence as the notification text", () => {
    expect(message.text).toBe("Amplitude experiments can now be scheduled to stop on their own.");
  });

  it("names the competitor in the lead when the summary forgets to", () => {
    const message = buildSlackMessage({
      ...base,
      analysis: { ...base.analysis, summary: "Experiments can now stop on a schedule." },
    });
    expect(message.text).toBe("Amplitude: Experiments can now stop on a schedule.");
  });

  it("keeps the elaborating bullets under their own heading, below impact", () => {
    const detail = blocks[3]?.text?.text as string;
    expect(detail).toContain("*More detail*");
    expect(detail).toContain("• Set a start time, an end time, or both");
    expect(detail).not.toContain(base.analysis.summary);
  });

  it("falls back to the rest of the summary when there are no key points", () => {
    const message = buildSlackMessage({
      ...base,
      analysis: {
        ...base.analysis,
        summary: "Amplitude ships scheduled stops. It covers flags too.",
        keyPoints: [],
      },
    });
    expect(JSON.stringify(message)).toContain("• It covers flags too.");
  });

  it("drops the detail block when there is nothing to put in it, and keeps KNOW", () => {
    const message = buildSlackMessage({
      ...base,
      analysis: { ...base.analysis, summary: "One sentence only.", keyPoints: [] },
    });
    expect(JSON.stringify(message)).not.toContain("More detail");
    expect(JSON.stringify(message)).toContain("What you need to KNOW");
  });

  it("labels impact and never says severity", () => {
    expect(rendered).toContain("*Impact*");
    expect(rendered).toContain("Notable");
    expect(rendered.toLowerCase()).not.toContain("severity");
    for (const dropped of ["Low", "Medium", "High"]) {
      expect(rendered).not.toContain(dropped);
    }
  });

  it("shows each impact level with its own dot", () => {
    const dots = (["minor", "notable", "major"] as const).map((impact) => {
      const message = buildSlackMessage({ ...base, analysis: { ...base.analysis, impact } });
      return (message.blocks as Array<Record<string, any>>).find((block) =>
        (block.text?.text as string | undefined)?.startsWith("*Impact*"),
      )?.text?.text as string;
    });
    expect(dots).toEqual([
      "*Impact*  :large_blue_circle: Minor",
      "*Impact*  :large_orange_circle: Notable",
      "*Impact*  :red_circle: Major",
    ]);
  });

  /** The heading section, then one section per action, in the order Slack shows them. */
  const actionBlocks = (message: SlackMessage): string[] => {
    const texts = (message.blocks as Array<Record<string, any>>)
      .filter((block) => block.type === "section")
      .map((block) => block.text?.text as string);
    const heading = texts.findIndex((text) => text?.startsWith(`*${ACTION_HEADING}*`));
    if (heading === -1) return [];
    const after = texts.slice(heading + 1);
    const end = after.findIndex((text) => !text?.startsWith("*") || text.startsWith("*<"));
    return [texts[heading] as string, ...(end === -1 ? after : after.slice(0, end))];
  };

  it("stacks each action as its own block: bold title, then one sentence under it", () => {
    expect(actionBlocks(message)).toEqual([
      "*Recommended action(s)*",
      "*Consider enhancing <https://posthog.com/experiments|Experiments>*\nPostHog experiments start manually and stop manually; there is no end time.",
      "*Update pages*\nThe Amplitude compare page says neither tool schedules experiment stops.",
    ]);
  });

  it("keeps the action detail to one sentence, so no block turns into a paragraph", () => {
    const [, first] = actionBlocks(message);
    expect(first).not.toContain("small change to the experiment form");
    expect((first as string).split("\n")).toHaveLength(2);
  });

  it("trims a long sentence so the detail line stays short", () => {
    const long = buildSlackMessage({
      ...base,
      analysis: {
        ...base.analysis,
        actions: [
          {
            type: "update_pages",
            detail: `The Amplitude compare page ${"still says neither tool schedules experiment stops, ".repeat(6)}and that is now wrong.`,
          },
        ],
      },
    });
    const detail = (actionBlocks(long)[1] as string).split("\n")[1] as string;
    expect(detail.length).toBeLessThanOrEqual(150);
    expect(detail.endsWith("\u2026")).toBe(true);
  });

  it("renders the actions with a blank line between them, not as dense bullets", () => {
    const text = renderMessageText(message);
    expect(text).toContain(
      [
        "*Recommended action(s)*",
        "",
        "*Consider enhancing <https://posthog.com/experiments|Experiments>*",
        "PostHog experiments start manually and stop manually; there is no end time.",
        "",
        "*Update pages*",
        "The Amplitude compare page says neither tool schedules experiment stops.",
      ].join("\n"),
    );
    expect(text).not.toContain("\u2022 Update pages");
  });

  it("never punctuates an action with an em dash", () => {
    expect(rendered).not.toContain("\u2014");
  });

  it("names the feature to enhance, so the title is not just 'Consider enhancing'", () => {
    expect(actionBlocks(message)[1]?.split("\n")[0]).toBe(
      "*Consider enhancing <https://posthog.com/experiments|Experiments>*",
    );
  });

  it("links a product name we know, inside the bold title", () => {
    const flags = buildSlackMessage({
      ...base,
      analysis: {
        ...base.analysis,
        actions: [
          {
            type: "consider_enhancing",
            feature: "feature flags",
            detail: "PostHog flags have no scheduled rollout.",
          },
        ],
      },
    });
    expect(actionBlocks(flags)[1]).toBe(
      "*Consider enhancing <https://posthog.com/feature-flags|Feature flags>*\nPostHog flags have no scheduled rollout.",
    );
  });

  it("matches a product whatever case the model wrote it in", () => {
    const titles = ["Feature Flags", "feature flags", "FEATURE  FLAGS", "Feature flag"].map(
      (feature) =>
        actionBlocks(
          buildSlackMessage({
            ...base,
            analysis: {
              ...base.analysis,
              actions: [{ type: "consider_enhancing", feature, detail: "A gap." }],
            },
          }),
        )[1]?.split("\n")[0],
    );
    expect(new Set(titles)).toEqual(
      new Set(["*Consider enhancing <https://posthog.com/feature-flags|Feature flags>*"]),
    );
  });

  it("leaves a feature we have no product page for as plain text", () => {
    const unknown = buildSlackMessage({
      ...base,
      analysis: {
        ...base.analysis,
        actions: [
          {
            type: "consider_enhancing",
            feature: "Session replay",
            detail: "PostHog replay has no mobile heatmaps.",
          },
        ],
      },
    });
    expect(actionBlocks(unknown)[1]).toBe(
      "*Consider enhancing Session replay*\nPostHog replay has no mobile heatmaps.",
    );
    expect(JSON.stringify(unknown)).not.toContain("posthog.com/session-replay");
  });

  it("links nothing on the three actions that name no feature", () => {
    const pages = buildSlackMessage({
      ...base,
      analysis: {
        ...base.analysis,
        actions: [{ type: "update_pages", detail: "The compare page is stale." }],
      },
    });
    expect(actionBlocks(pages)[1]).toBe("*Update pages*\nThe compare page is stale.");
  });

  it("keeps the product link as mrkdwn, not escaped into text", () => {
    expect(rendered).not.toContain("&lt;https://posthog.com/experiments");
    expect(rendered).toContain("<https://posthog.com/experiments|Experiments>");
  });

  it("links a product in every action of a multi-action alert", () => {
    const both = buildSlackMessage({
      ...base,
      analysis: {
        ...base.analysis,
        actions: [
          { type: "consider_enhancing", feature: "Experiments", detail: "No end time." },
          { type: "consider_enhancing", feature: "Feature flags", detail: "No scheduled rollout." },
          { type: "update_pages", detail: "The compare page is stale." },
        ],
      },
    });
    expect(actionBlocks(both).slice(1)).toEqual([
      "*Consider enhancing <https://posthog.com/experiments|Experiments>*\nNo end time.",
      "*Consider enhancing <https://posthog.com/feature-flags|Feature flags>*\nNo scheduled rollout.",
      "*Update pages*\nThe compare page is stale.",
    ]);
  });

  it("falls back to the bare label when a stored action names no feature", () => {
    const bare = buildSlackMessage({
      ...base,
      analysis: {
        ...base.analysis,
        actions: [{ type: "consider_enhancing", detail: "PostHog has an adjacent gap." }],
      },
    });
    expect(actionBlocks(bare)[1]).toBe("*Consider enhancing*\nPostHog has an adjacent gap.");
  });

  it("rewrites an em dash a model slipped into its own copy", () => {
    const slipped = buildSlackMessage({
      ...base,
      analysis: {
        ...base.analysis,
        summary: "Amplitude ships scheduled stops\u2014on experiments and flags.",
      },
    });
    expect(JSON.stringify(slipped)).not.toContain("\u2014");
    expect(JSON.stringify(slipped)).toContain("scheduled stops \u2013 on experiments and flags");
  });

  it("links the GitHub issue for the detail it no longer carries", () => {
    expect(rendered).toContain(
      `<https://github.com/itsmechase15/posthog-competitor-happenings/issues/7|${ISSUE_LINK_LABEL}>`,
    );
  });

  it("keeps PostHog page citations and suggested edits out of Slack", () => {
    expect(rendered).not.toContain("/compare/best-amplitude-alternatives");
    expect(rendered).not.toContain("Suggested edit");
    expect(rendered).not.toContain("PostHog pages");
    expect(rendered).not.toContain("Does the schedule apply");
  });

  it("stays short: one image, a handful of sections, one footer", () => {
    // Six fixed blocks plus one per action, and an alert carries at most three.
    expect(blocks.length).toBeLessThanOrEqual(9);
  });

  it("orders the blocks image, KNOW, impact, detail, actions, issue, footer", () => {
    const headings = blocks.map((block) =>
      block.type === "image"
        ? "image"
        : block.type === "context"
          ? "footer"
          : ((block.text?.text as string).split("\n")[0] ?? ""),
    );
    expect(headings).toEqual([
      "image",
      "*What you need to KNOW*",
      "*Impact*  :large_orange_circle: Notable",
      "*More detail*",
      `*${ACTION_HEADING}*`,
      "*Consider enhancing <https://posthog.com/experiments|Experiments>*",
      "*Update pages*",
      `*<https://github.com/itsmechase15/posthog-competitor-happenings/issues/7|${ISSUE_LINK_LABEL}>*`,
      "footer",
    ]);
  });

  it("says nothing about the missing issue outside a dry run", () => {
    const message = buildSlackMessage({ ...base, issue: null });
    expect(JSON.stringify(message)).not.toContain(ISSUE_LINK_LABEL);
    expect(JSON.stringify(message)).not.toContain("not created");
  });

  it("explains the missing issue when a dry run passed a note", () => {
    const message = buildSlackMessage({
      ...base,
      issue: null,
      issueNote: "GitHub issue not created — skipped (dry run)",
    });
    expect(JSON.stringify(message)).toContain(
      "GitHub issue not created \u2013 skipped (dry run)",
    );
  });

  it("keeps source and analyzer in a small footer, with a link to the source", () => {
    const footer = blocks.at(-1) as { type: string; elements: Array<{ text: string }> };
    expect(footer.type).toBe("context");
    expect(footer.elements[0]?.text).toContain("Amplitude · changelog · analyzed with claude-opus-5");
    expect(footer.elements[0]?.text).toContain(
      "<https://fixture.invalid/releases/schedule-experiment-stop|source>",
    );
  });

  it("says so when the summary was not model-analyzed", () => {
    const heuristic = buildSlackMessage({ ...base, model: FALLBACK_MODEL });
    expect(JSON.stringify(heuristic)).toContain("not model-analyzed");
  });

  it("renders to readable text for logs and artifacts", () => {
    const text = renderMessageText(message);
    expect(text.startsWith("![Amplitude: Schedule experiment stop](https://fixture.invalid/")).toBe(
      true,
    );
    expect(text).toContain("*What you need to KNOW*");
    expect(text).toContain("*Impact*  :large_orange_circle: Notable");
    expect(text).toContain("*More detail*");
    expect(text).toContain(ISSUE_LINK_LABEL);
  });

  it("escapes Slack mrkdwn control characters", () => {
    const escaped = buildSlackMessage({
      ...base,
      analysis: { ...base.analysis, summary: "Amplitude ships a < b & c > d." },
    });
    expect(JSON.stringify(escaped)).toContain("a &lt; b &amp; c &gt; d");
  });
});
