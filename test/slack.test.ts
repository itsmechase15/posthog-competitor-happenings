import { describe, expect, it } from "vitest";
import { FALLBACK_MODEL } from "../src/analysis/fallback.js";
import { buildSlackMessage, ISSUE_LINK_LABEL, renderMessageText } from "../src/slack/message.js";
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
    impact: "medium",
    summary: "Amplitude experiments can now be scheduled to stop on their own.",
    keyPoints: [
      "Set a start time, an end time, or both, per experiment or flag.",
      "Removes the manual babysitting a fixed-length test used to need.",
    ],
    action: "consider_enhancing",
    actionDetail:
      "PostHog experiments start manually and stop manually; there is no end time. Adding one is a small change to the experiment form.",
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

  it("makes the first text line one sentence about the change, not a metadata line", () => {
    const first = blocks[1]?.text?.text as string;
    expect(first).toBe("*Amplitude experiments can now be scheduled to stop on their own.*");
    expect(first).not.toContain("Notable");
    expect(first).not.toContain("· changelog");
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

  it("puts the substance under a KNOW heading, as bullets", () => {
    expect(rendered).toContain("*What you need to KNOW*");
    expect(rendered).toContain("• Set a start time, an end time, or both");
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

  it("drops the KNOW block when there is nothing to put in it", () => {
    const message = buildSlackMessage({
      ...base,
      analysis: { ...base.analysis, summary: "One sentence only.", keyPoints: [] },
    });
    expect(JSON.stringify(message)).not.toContain("What you need to KNOW");
  });

  it("labels impact and never says severity", () => {
    expect(rendered).toContain("*Impact*");
    expect(rendered).toContain("Medium");
    expect(rendered.toLowerCase()).not.toContain("severity");
    for (const legacy of ["Minor", "Notable", "Major"]) {
      expect(rendered).not.toContain(legacy);
    }
  });

  it("shows each impact level with its own dot", () => {
    const dots = (["low", "medium", "high"] as const).map((impact) => {
      const message = buildSlackMessage({ ...base, analysis: { ...base.analysis, impact } });
      return (message.blocks as Array<Record<string, any>>).find((block) =>
        (block.text?.text as string | undefined)?.startsWith("*Impact*"),
      )?.text?.text as string;
    });
    expect(dots).toEqual([
      "*Impact*  :large_blue_circle: Low",
      "*Impact*  :large_yellow_circle: Medium",
      "*Impact*  :red_circle: High",
    ]);
  });

  it("gives the recommended action exactly one sentence of detail", () => {
    const action = (blocks.find((block) =>
      (block.text?.text as string | undefined)?.startsWith("*Recommended action*"),
    )?.text?.text ?? "") as string;
    expect(action).toBe(
      "*Recommended action*\nConsider enhancing — PostHog experiments start manually and stop manually; there is no end time.",
    );
    expect(action).not.toContain("small change to the experiment form");
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
    expect(blocks.length).toBeLessThanOrEqual(7);
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
    expect(JSON.stringify(message)).toContain("GitHub issue not created");
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
    expect(text).toContain("*Impact*  :large_yellow_circle: Medium");
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
