import type { Action, Impact, RecommendedAction, SourceId } from "./types.js";

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
 * What the reader sees before the dash. "Consider enhancing" on its own names
 * nothing, so the feature becomes part of the label: "Consider enhancing
 * Experiments". The other three actions read fine without one.
 */
export function actionLabel(action: RecommendedAction): string {
  const label = ACTION_LABEL[action.type];
  if (action.type !== "consider_enhancing") return label;
  return action.feature ? `${label} ${action.feature}` : label;
}

export const SOURCE_LABEL: Record<SourceId, string> = {
  changelog: "changelog",
  blog: "blog",
  x: "X",
  newsletter: "newsletter",
};
