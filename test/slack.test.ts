import { describe, expect, it } from "vitest";
import { FALLBACK_MODEL } from "../src/analysis/fallback.js";
import { buildSlackMessage, renderMessageText } from "../src/slack/message.js";
import type { AnalyzedItem } from "../src/types.js";

const base: AnalyzedItem = {
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
    severity: "notable",
    summary: "Experiments can now be scheduled to stop automatically.",
    action: "consider_enhancing",
    actionDetail: "PostHog experiments start manually and stop manually; there is no end time.",
    posthogRefs: [
      {
        url: "https://posthog.com/compare/best-amplitude-alternatives",
        claim: "Both tools require manual experiment management.",
        suggestedEdit: "Note that Amplitude now schedules stops.",
      },
    ],
  },
  model: "claude-opus-5",
};

describe("buildSlackMessage", () => {
  const message = buildSlackMessage(base);
  const rendered = JSON.stringify(message);

  it("puts competitor, severity, and source in the fallback text", () => {
    expect(message.text).toBe("Amplitude · Notable · changelog: Schedule experiment stop");
  });

  it("links the item rather than dumping raw JSON", () => {
    expect(rendered).toContain("<https://fixture.invalid/releases/schedule-experiment-stop|");
    expect(rendered).not.toContain("externalId");
  });

  it("renders the action as a readable label with its detail", () => {
    expect(rendered).toContain("*Consider enhancing* — PostHog experiments start manually");
  });

  it("cites PostHog refs with their suggested edit", () => {
    expect(rendered).toContain("/compare/best-amplitude-alternatives");
    expect(rendered).toContain("Suggested edit:");
  });

  it("omits the refs block when there is nothing to cite", () => {
    const withoutRefs = buildSlackMessage({
      ...base,
      analysis: { ...base.analysis, posthogRefs: [] },
    });
    expect(JSON.stringify(withoutRefs)).not.toContain("PostHog pages to check");
  });

  it("says so when the summary was not model-analyzed", () => {
    const heuristic = buildSlackMessage({ ...base, model: FALLBACK_MODEL });
    expect(JSON.stringify(heuristic)).toContain("Not model-analyzed");
  });

  it("renders to readable text for logs and artifacts", () => {
    const text = renderMessageText(message);
    expect(text).toContain("*Amplitude · Notable · changelog*");
    expect(text).toContain("*Consider enhancing* —");
    expect(text).toContain("*PostHog pages to check*");
    expect(text.trimEnd().endsWith("_Analyzed with claude-opus-5_")).toBe(true);
  });

  it("escapes Slack mrkdwn control characters", () => {
    const escaped = buildSlackMessage({
      ...base,
      analysis: { ...base.analysis, summary: "a < b & c > d" },
    });
    expect(JSON.stringify(escaped)).toContain("a &lt; b &amp; c &gt; d");
  });
});
