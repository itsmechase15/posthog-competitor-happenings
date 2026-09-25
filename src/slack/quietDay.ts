import { COMPETITORS, COMPETITOR_IDS } from "../config.js";
import { createLogger } from "../log.js";
import type { SlackMessage } from "./message.js";
import type { SlackPoster } from "./post.js";
import { sanitizeCopy } from "../util/text.js";

const log = createLogger("slack");

/**
 * The line a day with no competitor launch gets.
 *
 * Silence used to be the answer, and silence is ambiguous: a reader could not
 * tell a quiet day from a broken cron, a dead token, or a database that had
 * stopped answering. One short message says somebody looked and there was
 * nothing, which is the whole point of a daily job.
 */
export const QUIET_DAY_HEADLINE = "No new competitor products or features today";

/**
 * The zone a day means here.
 *
 * GitHub's cron speaks only UTC, so the daily workflow is scheduled at both
 * 14:00 and 15:00 UTC for one 07:00 in Los Angeles, and the guard there only
 * turns away a run that is too early – a delayed morning puts both entries
 * through. "Today" therefore has to mean the calendar day the schedule was
 * written in, or the run that lands at 00:30 UTC on a winter night counts as
 * tomorrow and says the same thing twice.
 */
export const SCHEDULE_TIME_ZONE = "America/Los_Angeles";

/** The calendar day in the schedule's zone, as `2026-09-24`. */
export function scheduleDay(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * What the note needs from the store: whether the day already heard, and
 * somewhere to say that it has.
 *
 * Narrower than the whole `Store` on purpose – this is the only state the
 * message keeps, and a test of "twice in one day posts once" should not have to
 * stand up a corpus to say so.
 */
export interface QuietDayNotes {
  quietDayNoteSent(day: string): Promise<boolean>;
  recordQuietDayNote(day: string, at: Date): Promise<void>;
}

/** What the run found, as far as deciding whether the day was quiet goes. */
export interface QuietDayRun {
  /** Items collected from the feeds, new or already seen. */
  candidates: number;
  /**
   * Analyses this run handed to Slack, whether or not Slack took them. Counted
   * rather than the posts that succeeded: an alert Slack refused is still an
   * alert, and the next run retries it. Saying the day was quiet on top of it
   * would be the one wrong thing to say.
   */
  attempted: number;
  /** Items a first run recorded without alerting. */
  seeded: number;
  /** Sources that failed outright. */
  failedSources: number;
}

/** "Mixpanel or Amplitude", from whichever competitors are configured. */
function competitorList(): string {
  const labels = COMPETITOR_IDS.map((id) => COMPETITORS[id].label);
  if (labels.length <= 1) return labels[0] ?? "the competitors we watch";
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * Why this run gets no quiet-day message, or null when it should get one.
 *
 * Every reason here is a run that posted nothing and was not quiet, so the
 * message would be untrue rather than merely redundant.
 */
export function quietDaySkipReason(run: QuietDayRun): string | null {
  if (run.attempted > 0) {
    return `${count(run.attempted, "alert")} went out this run`;
  }
  if (run.candidates === 0 && run.failedSources > 0) {
    return `${count(run.failedSources, "source")} failed and nothing was collected, so the day was not checked`;
  }
  if (run.seeded > 0) {
    return `first run for a source: ${count(run.seeded, "existing item")} recorded without alerting`;
  }
  return null;
}

/**
 * The message itself: the headline, and the one line under it that says what
 * was read. The count is there because "nothing happened" and "nothing was
 * read" look identical from the channel, and a number tells them apart.
 */
export function buildQuietDayMessage(run: QuietDayRun): SlackMessage {
  const checked =
    run.candidates > 0 ? ` ${count(run.candidates, "item")} checked, none of them new.` : "";

  return {
    text: sanitizeCopy(`${QUIET_DAY_HEADLINE}.`),
    blocks: [
      // Alerts open with a divider because Slack collapses consecutive messages
      // from the same bot. This one does too, so it never reads as the tail of
      // yesterday's alert.
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: sanitizeCopy(
            `*${QUIET_DAY_HEADLINE}*\nNothing new from ${competitorList()}.${checked}`,
          ),
        },
      },
    ],
  };
}

/**
 * Post the quiet-day message, once a day, if the run earned one.
 *
 * Called once at the end of a cycle, after every alert has been tried, so a
 * run cannot post two of these however many sources it read. Once a day on top
 * of that, because a run is not a day: two scheduled runs land on the same
 * Pacific morning whenever GitHub is late with the earlier one, and the day
 * they both read is the same day. Every other message the bot sends is deduped
 * by the item behind it, and this one has no item, so the day is what it
 * dedupes on.
 *
 * A failure is logged and swallowed: this is the least important message the
 * bot sends, and it must never be the thing that fails a run whose alerts all
 * went out.
 */
export async function postQuietDayNote(
  poster: SlackPoster,
  notes: QuietDayNotes,
  run: QuietDayRun,
  now = new Date(),
): Promise<boolean> {
  const skip = quietDaySkipReason(run);
  if (skip) {
    // At info: the run log is the only record of why the channel stayed quiet
    // about being quiet, and that is the first question anyone asks about it.
    log.info(`no quiet-day message: ${skip}`);
    return false;
  }

  const day = scheduleDay(now);

  try {
    if (await notes.quietDayNoteSent(day)) {
      log.info(`no quiet-day message: the channel was already told about ${day}`);
      return false;
    }
  } catch (error) {
    // Not knowing is not a reason to say it again. A database this run cannot
    // read has already failed the steps that matter, and repeating the one
    // message nobody needs twice is the failure this check exists to stop.
    log.error(
      `could not tell whether the quiet-day message for ${day} has gone out, so it is not being sent`,
      error instanceof Error ? error.message : error,
    );
    return false;
  }

  try {
    await poster.post(buildQuietDayMessage(run));
    log.info("nothing new from any competitor, so the channel was told so");
  } catch (error) {
    log.error(
      "failed to post the quiet-day message",
      error instanceof Error ? error.message : error,
    );
    return false;
  }

  try {
    // Only after Slack took it. A refused message left a day nobody was told
    // about, and the next run should get to try again.
    await notes.recordQuietDayNote(day, now);
  } catch (error) {
    log.error(
      `posted the quiet-day message for ${day} but could not record it, so a later run today may repeat it`,
      error instanceof Error ? error.message : error,
    );
  }

  return true;
}
