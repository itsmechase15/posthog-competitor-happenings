import { ACTION_OWNER } from "./labels.js";
import type { RecommendedAction, Team } from "./types.js";

/**
 * Which PostHog teams an issue is for.
 *
 * This is a built-in map, not a lookup: PostHog's real team list is not
 * something this app can read yet, and a specific team guessed wrong routes
 * the issue to nobody. So it stays coarse and honest – the action type decides
 * the team that owns the work, and one keyword rule adds engineering when the
 * action is plainly about how data gets in rather than what the product does.
 *
 * When there is a team list to route against, this file is the one to change:
 * `relatedTeams` is the only thing the issue builder calls.
 */

/** How a team is written in an issue. The label slug is the lowercase key. */
export const TEAM_LABEL: Record<Team, string> = {
  marketing: "Marketing",
  product: "Product",
  engineering: "Engineering",
};

/**
 * Three is the cap Chase set, and it is a real one: a list of teams that long
 * is the same as naming none of them. Today nothing reaches it.
 */
export const MAX_TEAMS = 3;

/**
 * Words that make an action infrastructure work: SDKs, ingestion, hosting, the
 * plumbing a launch lands in. Matched on whole words against the action's
 * feature and detail, so "rapid" is not an API and "libraries" is not a
 * library. Anything vaguer than this belongs to the owning team alone.
 */
const ENGINEERING_PATTERNS: RegExp[] = [
  /\bsdks?\b/,
  /\bapis?\b/,
  /\bingest(?:ion|ing)?\b/,
  /\bpipelines?\b/,
  /\bproxy\b/,
  /\bself[-\s]host(?:ed|ing)?\b/,
  /\binfra(?:structure)?\b/,
  /\bwebhooks?\b/,
  /\bdns\b/,
  /\bcname\b/,
];

/** Whether the action reads as plumbing rather than product or page work. */
export function isEngineeringWork(action: RecommendedAction): boolean {
  const text = `${action.feature ?? ""} ${action.detail}`.toLowerCase();
  return ENGINEERING_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * The teams one action is for, most relevant first. Always at least one: the
 * owner of the action type – marketing for page work, product for building and
 * enhancing – so an issue never lands with nobody's name on it.
 */
export function relatedTeams(action: RecommendedAction): Team[] {
  const teams: Team[] = [ACTION_OWNER[action.type]];
  if (isEngineeringWork(action)) teams.push("engineering");
  return teams.slice(0, MAX_TEAMS);
}

/** The teams as an issue reads them: "Marketing, Engineering". */
export function relatedTeamsLabel(action: RecommendedAction): string {
  return relatedTeams(action)
    .map((team) => TEAM_LABEL[team])
    .join(", ");
}
