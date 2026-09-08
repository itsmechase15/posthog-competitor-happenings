import { findPostHogProduct } from "./posthog/products.js";
import type { Action, ActionOwner, Impact, RecommendedAction, SourceId } from "./types.js";

/**
 * Everything user-facing says "impact", never "severity". The old word only
 * survives in the legacy database column and in analyses written before the
 * rename.
 */
export const IMPACT_LABEL: Record<Impact, string> = {
  minor: "Minor",
  notable: "Notable",
  major: "Major",
};

/** A glanceable dot in Slack, so impact reads before the word does. */
export const IMPACT_EMOJI: Record<Impact, string> = {
  minor: ":large_blue_circle:",
  notable: ":large_orange_circle:",
  major: ":red_circle:",
};

export const ACTION_LABEL: Record<Action, string> = {
  update_pages: "Update pages",
  new_compare_page: "New compare page",
  consider_building: "Consider building",
  consider_enhancing: "Consider enhancing",
};

/**
 * Who owns each action. Marketing writes the pages, product decides what gets
 * built, so an alert that needs both is two pieces of work for two teams.
 */
export const ACTION_OWNER: Record<Action, ActionOwner> = {
  update_pages: "marketing",
  new_compare_page: "marketing",
  consider_building: "product",
  consider_enhancing: "product",
};

export function actionOwner(action: RecommendedAction): ActionOwner {
  return ACTION_OWNER[action.type];
}

/** An action title, kept in two pieces so Slack can link the product name. */
export interface ActionTitle {
  label: string;
  /** Present only when the title names a PostHog feature. `url` when we know its product page. */
  feature?: { label: string; url?: string };
}

/**
 * The title split at the feature, because Slack links the product name and
 * plain text cannot. "Consider enhancing" on its own names nothing, so the
 * feature is part of the title; the other three actions read fine without one.
 * A feature we recognize gets PostHog's own casing, so "feature flags" from a
 * model still reads as "Feature flags".
 */
export function actionTitleParts(action: RecommendedAction): ActionTitle {
  const label = ACTION_LABEL[action.type];
  if (action.type !== "consider_enhancing" || !action.feature) return { label };
  const product = findPostHogProduct(action.feature);
  return { label, feature: { label: product?.label ?? action.feature, url: product?.url } };
}

/** The whole title as one string, for everywhere that cannot carry a link. */
export function actionLabel(action: RecommendedAction): string {
  const { label, feature } = actionTitleParts(action);
  return feature ? `${label} ${feature.label}` : label;
}

export const SOURCE_LABEL: Record<SourceId, string> = {
  changelog: "changelog",
  blog: "blog",
  x: "X",
  newsletter: "newsletter",
};
