import { chromium, type Browser } from "playwright-core";

/**
 * The headless browser the before/after is photographed in.
 *
 * `playwright-core` rather than `playwright`, so installing this app does not
 * download a browser: the daily job installs the headless shell in its own
 * step, and a machine without one files every issue in text. That fallback is
 * the whole contract of this module – it throws, and the caller opens the
 * issue anyway.
 */

/** A browser that will not start inside a minute is not going to. */
const LAUNCH_TIMEOUT_MS = 60_000;

/**
 * The browsers to try, in order. The headless shell is the small download and
 * the one the workflows install; plain Chromium is what a developer machine
 * with `npx playwright install chromium` already has.
 */
const CHANNELS: Array<string | undefined> = ["chromium-headless-shell", undefined];

/** Throws when there is no Chromium, which costs the pictures and nothing else. */
export async function launchBrowser(): Promise<Browser> {
  const failures: string[] = [];
  for (const channel of CHANNELS) {
    try {
      return await chromium.launch({
        timeout: LAUNCH_TIMEOUT_MS,
        ...(channel ? { channel } : {}),
      });
    } catch (error) {
      failures.push(`${channel ?? "chromium"}: ${error instanceof Error ? error.message : error}`);
    }
  }
  throw new Error(`no Chromium to photograph with (${failures.join("; ")})`);
}
