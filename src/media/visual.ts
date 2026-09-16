import type { Config } from "../config.js";
import { createFileStore, type FileStore } from "../github/files.js";
import { createLogger } from "../log.js";
import type { CorpusIndex } from "../posthog/retrieval.js";
import type {
  AnalyzedItem,
  PageEditPlan,
  PageEditVisual,
  PageShots,
  RecommendedAction,
} from "../types.js";
import { launchBrowser } from "./browser.js";
import { captureEdit, type CaptureResult } from "./livePage.js";
import { buildPageEditPlans } from "./pageEdit.js";

const log = createLogger("page-visual");

/**
 * The before/after on an `update_pages` issue, end to end: work out what the
 * edit is, open the real page in a headless browser, photograph it before and
 * with the copy staged in the browser only, commit both PNGs, and hand back
 * the URLs the issue embeds.
 *
 * Only `update_pages` gets a pair. `consider_enhancing` and
 * `consider_building` are asking for a feature, and there is no before and
 * after of a feature that does not exist yet – a picture of one would be an
 * invention, which is the failure mode this whole repo is built against.
 *
 * Every step fails soft, and the whole thing is one `try`. A browser that will
 * not launch, a page that will not load, a commit the token cannot make: each
 * costs the pictures and none of them costs the issue, which already says the
 * same thing in words and arrives here carrying its diff and its copy.
 */
export interface PageVisualMaker {
  readonly description: string;
  /** Never throws. Empty when there was nothing to photograph. */
  make(alert: AnalyzedItem, action: RecommendedAction): Promise<PageEditVisual[]>;
}

/**
 * Two pages is the cap. One page edit is the normal shape of an
 * `update_pages` action, a second happens when a launch breaks the same claim
 * on a compare page and a product page, and a third is six screenshots above
 * the copy somebody came to paste.
 */
const MAX_VISUALS = 2;

/**
 * Photograph each page. One browser for the batch, a fresh context per page so
 * nothing one page sets carries into the next, and the browser closed
 * whichever way this ends.
 */
export async function captureAll(
  plans: PageEditPlan[],
  userAgent: string,
): Promise<CaptureResult[]> {
  if (plans.length === 0) return [];

  const browser = await launchBrowser();
  try {
    const results: CaptureResult[] = [];
    for (const plan of plans) {
      results.push(await captureEdit(browser, plan, { userAgent }));
    }
    return results;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export class BrowserPageVisualMaker implements PageVisualMaker {
  readonly description: string;

  constructor(
    private readonly index: CorpusIndex,
    private readonly files: FileStore,
    private readonly userAgent: string,
    private readonly capture: (
      plans: PageEditPlan[],
      userAgent: string,
    ) => Promise<CaptureResult[]> = captureAll,
  ) {
    this.description = `photographs the live page before and after, ${files.description}`;
  }

  async make(alert: AnalyzedItem, action: RecommendedAction): Promise<PageEditVisual[]> {
    const plans = buildPageEditPlans(action, alert.analysis.posthogRefs, this.index).slice(
      0,
      MAX_VISUALS,
    );
    if (plans.length === 0) return [];

    let captures: CaptureResult[];
    try {
      captures = await this.capture(plans, this.userAgent);
    } catch (error) {
      // The commonest one by far: no browser on the box. It is a log line and
      // not an error, because the issue is fine without the pictures.
      log.warn(
        `no before/after for ${alert.item.url}: ${error instanceof Error ? error.message : error}. The issues get the diff and the copy to paste.`,
      );
      return plans.map((plan) => ({ ...plan, shots: null, copyMissingLive: false }));
    }

    const visuals: PageEditVisual[] = [];
    for (const [index, plan] of plans.entries()) {
      const capture = captures[index];
      if (!capture) continue;
      visuals.push(await this.publish(plan, capture));
    }

    const shot = visuals.filter((visual) => visual.shots !== null).length;
    if (shot > 0) log.info(`photographed ${shot} live page edit(s) for ${alert.item.url}`);
    return visuals;
  }

  /**
   * Commit one page's pair, or say what there is to say instead.
   *
   * **Both or neither.** A before shot with no after is a screenshot of a page
   * with nothing to compare it to, captioned as half of a comparison; it reads
   * as a broken issue. When one of the two commits is refused, the pair is
   * dropped and the section is the text-only one.
   */
  private async publish(plan: PageEditPlan, capture: CaptureResult): Promise<PageEditVisual> {
    const textOnly: PageEditVisual = { ...plan, shots: null, copyMissingLive: false };

    switch (capture.status) {
      case "missing": {
        // The stored page has the line and the live page does not, which means
        // the page has changed since the corpus read it and the edit may
        // already have been made. Worth one line in the issue; nothing else
        // here knows it.
        if (!plan.quotedOnStoredPage) {
          log.warn(`the quoted line is on neither the live nor the stored ${plan.url}`);
          return textOnly;
        }
        log.warn(`the quoted line is no longer on ${plan.url}, so there is nothing to show`);
        return { ...textOnly, copyMissingLive: true };
      }
      case "skipped": {
        log.warn(`no before/after of ${plan.url}: ${capture.reason}`);
        return textOnly;
      }
      case "captured": {
        const shots = await this.commitPair(plan, capture.before, capture.after);
        return shots ? { ...textOnly, shots } : textOnly;
      }
      default: {
        const exhaustive: never = capture;
        return exhaustive;
      }
    }
  }

  private async commitPair(
    plan: PageEditPlan,
    before: Buffer,
    after: Buffer,
  ): Promise<PageShots | null> {
    // Both are written even when the first one comes back with no URL, because
    // a dry run's file store returns null for each and still writes the PNG to
    // a temp file, and the pair is what somebody previewing a dry run wants to
    // look at.
    const beforeUrl = await this.files.put(plan.beforePath, before, commitMessage(plan, "before"));
    const afterUrl = await this.files.put(plan.afterPath, after, commitMessage(plan, "after"));
    if (!beforeUrl || !afterUrl) return null;

    return {
      beforeUrl,
      afterUrl,
      beforeAlt: plan.beforeAlt,
      afterAlt: plan.afterAlt,
    };
  }
}

/**
 * A commit message that says what the file is for, because these land on the
 * default branch and somebody reading the log deserves better than "add png".
 * `[skip ci]` because a picture is not a code change, and a daily job that
 * files three pairs should not queue six builds.
 */
export function commitMessage(plan: PageEditPlan, side: "before" | "after"): string {
  const staged =
    side === "before"
      ? `posthog.com${plan.path} as it read on ${plan.capturedOn}`
      : `posthog.com${plan.path} with the proposed copy staged in a headless browser, published nowhere`;
  const what = plan.mode === "insert" ? "adds copy next to" : "replaces";
  return `Add the ${side} of ${plan.path} [skip ci]\n\nThis is ${staged}. The edit ${what} a line there: ${plan.summary}`;
}

/** The plans with no pictures, for when nothing should open a browser. */
export class TextOnlyPageVisualMaker implements PageVisualMaker {
  readonly description: string;

  constructor(
    private readonly index: CorpusIndex,
    readonly reason: string,
  ) {
    this.description = `text-only page edits (${reason})`;
  }

  async make(alert: AnalyzedItem, action: RecommendedAction): Promise<PageEditVisual[]> {
    return buildPageEditPlans(action, alert.analysis.posthogRefs, this.index)
      .slice(0, MAX_VISUALS)
      .map((plan) => ({ ...plan, shots: null, copyMissingLive: false }));
  }
}

/** Nothing at all, for the callers with no corpus to plan an edit from. */
export class NoPageVisualMaker implements PageVisualMaker {
  readonly description = "no before/after";

  async make(): Promise<PageEditVisual[]> {
    return [];
  }
}

export function createPageVisualMaker(config: Config, index: CorpusIndex): PageVisualMaker {
  if (config.skipPageVisuals) return new TextOnlyPageVisualMaker(index, "SKIP_PAGE_VISUALS is set");
  // A dry run photographs the page and writes both PNGs to a temp directory,
  // the same way the disabled issue editor logs the edit it would have made: a
  // dry run that skipped the capture would hide the half of this that can
  // break, and the capture needs no credentials.
  return new BrowserPageVisualMaker(index, createFileStore(config), config.userAgent);
}
