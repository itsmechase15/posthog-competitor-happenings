import { Agent } from "@cursor/sdk";
import type { Config } from "../config.js";
import type { Store } from "../db/store.js";
import { createLogger } from "../log.js";
import type { Analysis, AnalyzedItem, PostHogClaim, StoredItem } from "../types.js";
import type { Analyzer } from "./analyzer.js";
import { FALLBACK_MODEL, heuristicAnalysis } from "./fallback.js";
import { buildAnalysisPrompt } from "./prompt.js";
import { parseAnalysis } from "./schema.js";

const log = createLogger("analysis");

/** How many indexed claims to put in front of the model per competitor. */
const CLAIMS_PER_PROMPT = 8;
/** Claims from any single page, so one long comparison page cannot crowd out the rest. */
const CLAIMS_PER_PAGE = 2;
const ANALYSIS_ATTEMPTS = 2;

/**
 * Spread the claim budget across pages. `getClaims` ranks by page importance
 * then paragraph length, which otherwise returns the same page eight times.
 */
export function diversifyClaims(claims: PostHogClaim[], limit: number): PostHogClaim[] {
  const perUrl = new Map<string, number>();
  const picked: PostHogClaim[] = [];

  for (const claim of claims) {
    const used = perUrl.get(claim.url) ?? 0;
    if (used >= CLAIMS_PER_PAGE) continue;
    perUrl.set(claim.url, used + 1);
    picked.push(claim);
    if (picked.length === limit) break;
  }

  return picked;
}

class CursorAnalyzer implements Analyzer {
  constructor(
    readonly model: string,
    private readonly apiKey: string,
    private readonly runtime: "local" | "cloud",
  ) {}

  async analyze(item: StoredItem, claims: PostHogClaim[]): Promise<Analysis> {
    const prompt = buildAnalysisPrompt(item, claims);
    let lastError: unknown;

    for (let attempt = 1; attempt <= ANALYSIS_ATTEMPTS; attempt += 1) {
      try {
        const run = await Agent.prompt(prompt, {
          apiKey: this.apiKey,
          model: { id: this.model },
          ...(this.runtime === "cloud"
            ? { cloud: { repos: [] } }
            : // No repo to reason about: text in, JSON out.
              { tools: [], local: { cwd: process.cwd() } }),
        });

        if (run.status !== "finished") {
          throw new Error(`agent run ${run.status}: ${run.error?.message ?? "no detail"}`);
        }
        if (!run.result) throw new Error("agent run returned no text");

        return parseAnalysis(run.result);
      } catch (error) {
        lastError = error;
        log.warn(
          `analysis attempt ${attempt}/${ANALYSIS_ATTEMPTS} failed for ${item.url}`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    throw lastError instanceof Error ? lastError : new Error("analysis failed");
  }
}

class HeuristicAnalyzer implements Analyzer {
  readonly model = FALLBACK_MODEL;

  async analyze(item: StoredItem, claims: PostHogClaim[]): Promise<Analysis> {
    return heuristicAnalysis(item, claims);
  }
}

export function createAnalyzer(config: Config): Analyzer {
  if (!config.cursorApiKey) {
    log.warn(
      "CURSOR_API_KEY is not set — falling back to a heuristic summary that does not assess the change",
    );
    return new HeuristicAnalyzer();
  }
  return new CursorAnalyzer(config.cursorModel, config.cursorApiKey, config.cursorRuntime);
}

/**
 * Analyze each new item against the PostHog claims we have indexed for its
 * competitor. A failed analysis drops that item and leaves the rest alone.
 */
export type { Analyzer };

export async function analyzeItems(
  items: StoredItem[],
  store: Store,
  analyzer: Analyzer,
): Promise<AnalyzedItem[]> {
  const claimsByCompetitor = new Map<string, PostHogClaim[]>();
  const analyzed: AnalyzedItem[] = [];

  for (const item of items) {
    let claims = claimsByCompetitor.get(item.competitor);
    if (!claims) {
      const ranked = await store.getClaims(item.competitor, CLAIMS_PER_PROMPT * 4);
      claims = diversifyClaims(ranked, CLAIMS_PER_PROMPT);
      claimsByCompetitor.set(item.competitor, claims);
    }

    try {
      const analysis = await analyzer.analyze(item, claims);
      analyzed.push({ item, analysis, model: analyzer.model });
      log.info(`analyzed ${item.competitor}/${item.source} "${item.title}" → ${analysis.action}`);
    } catch (error) {
      log.error(
        `giving up on ${item.url}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return analyzed;
}
