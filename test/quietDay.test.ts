import { describe, expect, it } from "vitest";
import { renderMessageText, type SlackMessage } from "../src/slack/message.js";
import type { SlackPoster } from "../src/slack/post.js";
import {
  buildQuietDayMessage,
  postQuietDayNote,
  QUIET_DAY_HEADLINE,
  quietDaySkipReason,
  type QuietDayRun,
} from "../src/slack/quietDay.js";

/** A run that read plenty of items and found nothing it had not already seen. */
const quiet: QuietDayRun = { candidates: 42, attempted: 0, seeded: 0, failedSources: 0 };

class RecordingPoster implements SlackPoster {
  readonly description = "recording";
  readonly posted: SlackMessage[] = [];

  async post(message: SlackMessage): Promise<void> {
    this.posted.push(message);
  }
}

class BrokenPoster implements SlackPoster {
  readonly description = "broken";

  async post(): Promise<void> {
    throw new Error("not_in_channel");
  }
}

describe("quietDaySkipReason", () => {
  it("lets the message through when the run posted no alerts", () => {
    expect(quietDaySkipReason(quiet)).toBeNull();
  });

  it("holds it back when the run had alerts to post", () => {
    expect(quietDaySkipReason({ ...quiet, attempted: 2 })).toMatch(/2 alerts went out/);
  });

  /**
   * An alert Slack refused is still an alert, and the next run retries it.
   * "Nothing happened today" written over the top of one would be the worst
   * thing this feature could say, so it is the attempt that counts.
   */
  it("holds it back when the alerts were tried and Slack refused them", () => {
    expect(quietDaySkipReason({ ...quiet, attempted: 1 })).not.toBeNull();
  });

  it("holds it back when nothing was collected because every source failed", () => {
    expect(quietDaySkipReason({ ...quiet, candidates: 0, failedSources: 3 })).toMatch(
      /3 sources failed/,
    );
  });

  /** One broken feed out of several is still a day that was checked. */
  it("lets it through when a source failed but the others were read", () => {
    expect(quietDaySkipReason({ ...quiet, failedSources: 1 })).toBeNull();
  });

  it("holds it back on a first run that recorded a backlog silently", () => {
    expect(quietDaySkipReason({ ...quiet, seeded: 30 })).toMatch(/first run/);
  });
});

describe("buildQuietDayMessage", () => {
  it("says nothing happened, and says what was checked", () => {
    const rendered = renderMessageText(buildQuietDayMessage(quiet));
    expect(rendered).toContain(QUIET_DAY_HEADLINE);
    expect(rendered).toContain("Mixpanel or Amplitude");
    expect(rendered).toContain("42 items checked");
  });

  it("leaves the count out when there was nothing to count", () => {
    const rendered = renderMessageText(buildQuietDayMessage({ ...quiet, candidates: 0 }));
    expect(rendered).toContain(QUIET_DAY_HEADLINE);
    expect(rendered).not.toContain("0 items");
  });

  it("is short, and punctuated the way PostHog punctuates", () => {
    const message = buildQuietDayMessage(quiet);
    expect(message.text).toBe(`${QUIET_DAY_HEADLINE}.`);
    expect(renderMessageText(message)).not.toMatch(/[\u2014\u201c\u201d\u2018\u2019]/);
    // A divider, then the one line. An alert this is not.
    expect(message.blocks).toHaveLength(2);
  });
});

describe("postQuietDayNote", () => {
  it("posts one message when the run posted no alerts", async () => {
    const poster = new RecordingPoster();
    await expect(postQuietDayNote(poster, quiet)).resolves.toBe(true);

    expect(poster.posted).toHaveLength(1);
    expect(poster.posted[0]?.text).toContain(QUIET_DAY_HEADLINE);
  });

  it("posts nothing when the run already had alerts", async () => {
    const poster = new RecordingPoster();
    await expect(postQuietDayNote(poster, { ...quiet, attempted: 1 })).resolves.toBe(false);

    expect(poster.posted).toEqual([]);
  });

  /** The least important message the bot sends never fails the run. */
  it("swallows a Slack refusal", async () => {
    await expect(postQuietDayNote(new BrokenPoster(), quiet)).resolves.toBe(false);
  });
});
