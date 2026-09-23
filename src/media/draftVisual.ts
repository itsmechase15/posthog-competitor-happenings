import type { Config } from "../config.js";
import { createFileStore, type FileStore } from "../github/files.js";
import { createLogger } from "../log.js";
import type { CorpusIndex } from "../posthog/retrieval.js";
import {
  isContentAction,
  type AnalyzedItem,
  type ArticleDraftVisual,
  type DraftShot,
  type RecommendedAction,
} from "../types.js";
import { launchBrowser } from "./browser.js";
import {
  captureDraft,
  planDraft,
  templateCandidates,
  type DraftCaptureResult,
  type DraftPlan,
} from "./draftPage.js";

const log = createLogger("draft-visual");

/**
 * The pictures on a `consider_publishing` issue, end to end: stage the draft
 * on a real posthog.com post, photograph it a screen at a time, commit the
 * PNGs, and hand back the URLs the issue embeds.
 *
 * Only `consider_publishing` gets them. Every other action is about a page or
 * a product that exists, and has its own picture or none.
 *
 * Every step fails soft. No browser, no post that will take the draft, a
 * commit the token cannot make: each costs the pictures and none of them costs
 * the issue, which carries the draft in a fence either way.
 */
export interface DraftVisualMaker {
  readonly description: string;
  /** Never throws. Null when the action carries nothing to lay out. */
  make(alert: AnalyzedItem, action: RecommendedAction): Promise<ArticleDraftVisual | null>;
}

/** What the maker asks of the browser: one draft, on the first of these posts that will take it. */
export type DraftCapture = (
  plan: DraftPlan,
  templateUrls: string[],
  userAgent: string,
) => Promise<DraftCaptureResult>;

/** One browser per draft, closed whichever way this ends. */
export const captureOne: DraftCapture = async (plan, templateUrls, userAgent) => {
  const browser = await launchBrowser();
  try {
    return await captureDraft(browser, plan, { userAgent, templateUrls });
  } finally {
    await browser.close().catch(() => undefined);
  }
};

function textOnly(plan: DraftPlan): ArticleDraftVisual {
  return { title: plan.title, wordCount: plan.wordCount, capturedOn: plan.capturedOn, shots: [] };
}

export class BrowserDraftVisualMaker implements DraftVisualMaker {
  readonly description: string;

  constructor(
    private readonly index: CorpusIndex | null,
    private readonly files: FileStore,
    private readonly userAgent: string,
    private readonly capture: DraftCapture = captureOne,
  ) {
    this.description = `stages the draft on a posthog.com blog post and photographs it, ${files.description}`;
  }

  async make(alert: AnalyzedItem, action: RecommendedAction): Promise<ArticleDraftVisual | null> {
    if (!isContentAction(action)) return null;
    const plan = planDraft(action);
    if (!plan) return null;

    let captured: DraftCaptureResult;
    try {
      captured = await this.capture(plan, templateCandidates(action, this.index), this.userAgent);
    } catch (error) {
      // The commonest one by far: no browser on the box. It is a log line and
      // not an error, because the issue is fine without the pictures.
      log.warn(
        `no pictures of the draft for ${alert.item.url}: ${error instanceof Error ? error.message : error}. The issue carries the draft as text.`,
      );
      return textOnly(plan);
    }
    if (captured.status === "skipped") {
      log.warn(`no pictures of the draft for ${alert.item.url}: ${captured.reason}`);
      return textOnly(plan);
    }

    // All or nothing. Three shots of a four-shot draft is a piece with its
    // ending missing, captioned as if it were whole. Every shot is still
    // written, because a dry run's file store answers null for each and still
    // puts the PNG in a temp directory, which is what a dry run is for.
    const committed: DraftShot[] = [];
    let refused = false;
    for (const [index, bytes] of captured.shots.entries()) {
      const path = plan.pathFor(index);
      const url = await this.files.put(path, bytes, commitMessage(plan, index, captured.shots.length));
      if (!url) refused = true;
      else committed.push({ url, path, alt: plan.altFor(index, captured.shots.length) });
    }
    if (refused) return textOnly(plan);

    if (committed.length > 0) {
      log.info(
        `photographed the draft "${plan.title}" on ${captured.stagedOn} in ${committed.length} shot(s)`,
      );
    }
    return { ...textOnly(plan), shots: committed, stagedOn: captured.stagedOn };
  }
}

/**
 * A commit message that says what the file is, because these land on the
 * default branch. `[skip ci]` because a picture is not a code change.
 */
export function commitMessage(plan: DraftPlan, index: number, total: number): string {
  const part = total > 1 ? `, part ${index + 1} of ${total}` : "";
  return `Add a picture of the draft "${plan.title}"${part} [skip ci]\n\nThe draft staged on a posthog.com blog post in a headless browser on ${plan.capturedOn}, for a consider_publishing issue. Published nowhere.`;
}

/** The plan with no pictures, for when nothing should open a browser. */
export class TextOnlyDraftVisualMaker implements DraftVisualMaker {
  readonly description: string;

  constructor(readonly reason: string) {
    this.description = `text-only drafts (${reason})`;
  }

  async make(_alert: AnalyzedItem, action: RecommendedAction): Promise<ArticleDraftVisual | null> {
    if (!isContentAction(action)) return null;
    const plan = planDraft(action);
    return plan ? textOnly(plan) : null;
  }
}

export function createDraftVisualMaker(config: Config, index: CorpusIndex | null): DraftVisualMaker {
  if (config.skipPageVisuals) return new TextOnlyDraftVisualMaker("SKIP_PAGE_VISUALS is set");
  // A dry run stages the draft and writes the PNGs to a temp directory, the
  // same way the page before/after does: the pictures need no credentials, and
  // they are the part of a publishing issue worth looking at before a real run.
  return new BrowserDraftVisualMaker(index, createFileStore(config), config.userAgent);
}
