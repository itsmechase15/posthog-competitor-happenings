import type { Action, Impact, SourceId } from "./types.js";

/**
 * Everything user-facing says "impact", never "severity". The old word only
 * survives in the legacy database column and in analyses written before the
 * rename.
 */
export const IMPACT_LABEL: Record<Impact, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

/** A glanceable dot in Slack, so impact reads before the word does. */
export const IMPACT_EMOJI: Record<Impact, string> = {
  low: ":large_blue_circle:",
  medium: ":large_yellow_circle:",
  high: ":red_circle:",
};

export const ACTION_LABEL: Record<Action, string> = {
  update_pages: "Update pages",
  new_compare_page: "New compare page",
  consider_building: "Consider building",
  consider_enhancing: "Consider enhancing",
};

export const SOURCE_LABEL: Record<SourceId, string> = {
  changelog: "changelog",
  blog: "blog",
  x: "X",
  newsletter: "newsletter",
};
