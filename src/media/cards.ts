import type { Config } from "../config.js";
import { CARD_DIR, createFileStore, type FileStore } from "../github/files.js";
import { createLogger } from "../log.js";
import type { CorpusIndex } from "../posthog/retrieval.js";
import type { AnalyzedItem, PageEditCard, PageEditPlan, RecommendedAction } from "../types.js";
import { sha1 } from "../util/text.js";
import { buildPageEditPlans, renderCardHtml, toCard } from "./pageEdit.js";
import { loadFontCss, renderCardPng } from "./render.js";

const log = createLogger("cards");

/**
 * The before/after cards one action's issue gets, pictures and all.
 *
 * Three steps, in an order chosen so the issue survives any of them failing:
 * the plan comes off the corpus, the PNG comes off the plan, and the PNG is
 * committed to this repo so the issue body can embed its raw URL. A failure at
 * step two or three costs the picture and nothing else – the card still
 * carries the diff and the copy to paste, and the issue is opened either way.
 *
 * `update_pages` only, and that is enforced here as well as in the issue
 * renderer. A before/after of a docs paragraph on a `consider_building` issue
 * would draw the evidence as if it were the ask.
 */
export interface EditCardMaker {
  readonly description: string;
  cardsFor(alert: AnalyzedItem, action: RecommendedAction): Promise<PageEditCard[]>;
}

/** A readable, stable path per card: the day, the page, and a hash of the card itself. */
export function cardPath(plan: PageEditPlan, html: string, now: Date): string {
  const slug =
    plan.path
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "page";
  return `${CARD_DIR}/${now.toISOString().slice(0, 10)}/${slug}-${sha1(html).slice(0, 8)}.png`;
}

export class CorpusEditCardMaker implements EditCardMaker {
  readonly description: string;

  constructor(
    private readonly index: CorpusIndex,
    private readonly files: FileStore,
    private readonly render: (html: string) => Promise<Buffer> = renderCardPng,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.description = `before/after cards from the corpus, ${files.description}`;
  }

  async cardsFor(alert: AnalyzedItem, action: RecommendedAction): Promise<PageEditCard[]> {
    const plans = buildPageEditPlans(action, alert.analysis.posthogRefs, this.index);
    const cards: PageEditCard[] = [];

    for (const plan of plans) {
      cards.push(toCard(plan, await this.imageFor(plan)));
    }
    return cards;
  }

  private async imageFor(plan: PageEditPlan): Promise<string | null> {
    const day = this.now();
    try {
      const html = renderCardHtml(plan, {
        fontCss: await loadFontCss(),
        renderedOn: day.toISOString().slice(0, 10),
      });
      const png = await this.render(html);
      const path = cardPath(plan, html, day);
      return await this.files.put(
        path,
        png,
        // The commit is a picture, so it has nothing for CI to check, and a
        // daily job that files three cards should not queue three builds.
        `Add a before/after card for ${plan.path} [skip ci]`,
      );
    } catch (error) {
      log.warn(
        `no picture for ${plan.url}: ${error instanceof Error ? error.message : error}. The issue gets the diff and the copy to paste.`,
      );
      return null;
    }
  }
}

/** Cards with no pictures: the text layers, for when there is nothing to render with. */
export class TextOnlyEditCardMaker implements EditCardMaker {
  readonly description: string;

  constructor(
    private readonly index: CorpusIndex,
    readonly reason: string,
  ) {
    this.description = `text-only cards (${reason})`;
  }

  async cardsFor(alert: AnalyzedItem, action: RecommendedAction): Promise<PageEditCard[]> {
    return buildPageEditPlans(action, alert.analysis.posthogRefs, this.index).map((plan) =>
      toCard(plan, null),
    );
  }
}

/** No cards at all, for the callers that have no corpus to build one from. */
export class NoEditCardMaker implements EditCardMaker {
  readonly description = "no before/after cards";

  async cardsFor(): Promise<PageEditCard[]> {
    return [];
  }
}

export function createEditCardMaker(config: Config, index: CorpusIndex): EditCardMaker {
  // A dry run renders the card and logs where the PNG would have gone, the
  // same way the disabled issue editor logs the edit it would have made: a dry
  // run that skipped the render would hide the half of this that can break.
  return new CorpusEditCardMaker(index, createFileStore(config));
}
