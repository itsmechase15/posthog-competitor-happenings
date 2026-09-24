import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/db/memory.js";
import { renderMessageText, type SlackMessage } from "../src/slack/message.js";
import type { SlackPoster } from "../src/slack/post.js";
import {
  buildQuietDayMessage,
  postQuietDayNote,
  QUIET_DAY_HEADLINE,
  quietDaySkipReason,
  scheduleDay,
  type QuietDayNotes,
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

/**
 * The morning of 2026-09-24, when GitHub ran both cron entries four hours late
 * and the channel was told twice that nothing had shipped. 18:00 and 18:48 UTC
 * are 11:00 and 11:48 in Los Angeles, so both belong to one Pacific day.
 */
const FIRST_RUN = new Date("2026-09-24T18:00:51Z");
const SECOND_RUN = new Date("2026-09-24T18:48:30Z");

describe("scheduleDay", () => {
  it("names the Pacific day, not the UTC one", () => {
    // 01:30 UTC on the 25th is still the evening of the 24th in Los Angeles,
    // which is the day the cron was written in.
    expect(scheduleDay(new Date("2026-09-25T01:30:00Z"))).toBe("2026-09-24");
    expect(scheduleDay(FIRST_RUN)).toBe("2026-09-24");
  });

  it("turns the day over at Pacific midnight, in either offset", () => {
    // Summer: the boundary is 07:00 UTC.
    expect(scheduleDay(new Date("2026-09-25T06:59:00Z"))).toBe("2026-09-24");
    expect(scheduleDay(new Date("2026-09-25T07:01:00Z"))).toBe("2026-09-25");
    // Winter: an hour later, and the same run time falls on the day before.
    expect(scheduleDay(new Date("2026-01-15T07:59:00Z"))).toBe("2026-01-14");
    expect(scheduleDay(new Date("2026-01-15T08:01:00Z"))).toBe("2026-01-15");
  });
});

describe("postQuietDayNote", () => {
  it("posts one message when the run posted no alerts", async () => {
    const poster = new RecordingPoster();
    await expect(postQuietDayNote(poster, new MemoryStore(), quiet)).resolves.toBe(true);

    expect(poster.posted).toHaveLength(1);
    expect(poster.posted[0]?.text).toContain(QUIET_DAY_HEADLINE);
  });

  it("posts nothing when the run already had alerts", async () => {
    const poster = new RecordingPoster();
    await expect(
      postQuietDayNote(poster, new MemoryStore(), { ...quiet, attempted: 1 }),
    ).resolves.toBe(false);

    expect(poster.posted).toEqual([]);
  });

  /** The least important message the bot sends never fails the run. */
  it("swallows a Slack refusal", async () => {
    await expect(postQuietDayNote(new BrokenPoster(), new MemoryStore(), quiet)).resolves.toBe(
      false,
    );
  });

  /**
   * The bug this once-a-day check exists for. Both scheduled entries ran on the
   * morning of 2026-09-24 because GitHub delayed them past 07:00 Pacific, both
   * found nothing new, and the channel got the same line 48 minutes apart.
   */
  it("says it once a day, however many runs land that morning", async () => {
    const poster = new RecordingPoster();
    const notes = new MemoryStore();

    await expect(postQuietDayNote(poster, notes, quiet, FIRST_RUN)).resolves.toBe(true);
    await expect(postQuietDayNote(poster, notes, quiet, SECOND_RUN)).resolves.toBe(false);

    expect(poster.posted).toHaveLength(1);
  });

  it("says it again tomorrow", async () => {
    const poster = new RecordingPoster();
    const notes = new MemoryStore();

    await postQuietDayNote(poster, notes, quiet, FIRST_RUN);
    await expect(
      postQuietDayNote(poster, notes, quiet, new Date("2026-09-25T14:00:00Z")),
    ).resolves.toBe(true);

    expect(poster.posted).toHaveLength(2);
  });

  /** A day nobody was told about is a day the next run should still tell. */
  it("records nothing when Slack refused the message", async () => {
    const notes = new MemoryStore();
    await postQuietDayNote(new BrokenPoster(), notes, quiet, FIRST_RUN);

    expect(await notes.quietDayNoteSent("2026-09-24")).toBe(false);

    const poster = new RecordingPoster();
    await expect(postQuietDayNote(poster, notes, quiet, SECOND_RUN)).resolves.toBe(true);
    expect(poster.posted).toHaveLength(1);
  });

  it("stamps the day it posted, and only that day", async () => {
    const notes = new MemoryStore();
    await postQuietDayNote(new RecordingPoster(), notes, quiet, FIRST_RUN);

    expect(await notes.quietDayNoteSent("2026-09-24")).toBe(true);
    expect(await notes.quietDayNoteSent("2026-09-25")).toBe(false);
  });

  /** Not knowing whether the channel has heard is not a reason to say it again. */
  it("stays quiet when it cannot read what has already gone out", async () => {
    const poster = new RecordingPoster();
    const broken: QuietDayNotes = {
      async quietDayNoteSent() {
        throw new Error("connection terminated unexpectedly");
      },
      async recordQuietDayNote() {
        // Never reached.
      },
    };

    await expect(postQuietDayNote(poster, broken, quiet, FIRST_RUN)).resolves.toBe(false);
    expect(poster.posted).toEqual([]);
  });

  /** A stamp that would not write is worth a log line, not a lost message. */
  it("still counts as posted when the stamp fails to write", async () => {
    const poster = new RecordingPoster();
    const halfBroken: QuietDayNotes = {
      async quietDayNoteSent() {
        return false;
      },
      async recordQuietDayNote() {
        throw new Error("connection terminated unexpectedly");
      },
    };

    await expect(postQuietDayNote(poster, halfBroken, quiet, FIRST_RUN)).resolves.toBe(true);
    expect(poster.posted).toHaveLength(1);
  });
});
