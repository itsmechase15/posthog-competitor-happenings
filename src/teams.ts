import { ACTION_OWNER } from "./labels.js";
import { productsForAction } from "./posthog/products.js";
import {
  findTeam,
  matchTeams,
  teamLabel,
  teamsOwningFeature,
  type PostHogTeam,
} from "./posthog/teams.js";
import { isContentAction, type RecommendedAction } from "./types.js";

/**
 * Which PostHog small teams an issue is for.
 *
 * PostHog does not have a product org and an engineering org, it has small
 * teams with their own pages, and each one owns particular features. So an
 * action about scheduling an experiment stop is for the Experiments team, and
 * one about routing events through a customer's own domain is for Ingestion.
 * "Product and Engineering" was the old answer and it named nobody.
 *
 * The model chooses, and everything else is the fallback for when it did not.
 * It is the only reader with the whole signal in front of it, and the prompt
 * gives it every team name and what each one owns, so a list it wrote wins
 * outright once each name has been found in the catalog. A team that is not on
 * /teams is dropped rather than mapped to something near it, which is why the
 * fallback has to be good: a reply that names only departments falls all the
 * way through it.
 *
 * Falling through, strongest first:
 *
 * 1. Who owns the feature the action names, and the products its own words are
 *    about. The app already knows which PostHog product a signal is about, and
 *    the catalog says who builds it.
 * 2. The team vocabulary in the action's own text, for a signal that names no
 *    product we recognize.
 * 3. A default, used only when both of those found nothing at all, so an issue
 *    never lands with nobody's name on it.
 */

/**
 * Three is the cap Chase set, and it is a real one: a list of teams that long
 * is the same as naming none of them. One or two is the normal answer.
 */
export const MAX_TEAMS = 3;

/**
 * Where an action goes when nothing else matched, and only then. Page work
 * belongs to Marketing, who own the compare and marketing pages. Product work
 * with no recognizable feature goes to Product Analytics, the team whose page
 * calls it "the OG product team" – a guess, but a named one somebody can
 * reroute, which is more than "Product" ever was.
 */
const DEFAULT_TEAM_NAMES: Record<"marketing" | "product", string> = {
  marketing: "Marketing",
  product: "Product Analytics",
};

/** The words one action is routed on: the feature it names and its detail. */
function actionText(action: RecommendedAction): string {
  return `${action.feature ?? ""} ${action.detail}`;
}

/** The model's own suggestions, minus anything that is not a real small team. */
function suggestedTeams(action: RecommendedAction): PostHogTeam[] {
  return (action.teams ?? [])
    .map((name) => findTeam(name))
    .filter((team): team is PostHogTeam => team !== undefined);
}

/**
 * The teams that own what this action is about: the feature it names first,
 * then the owners of the PostHog products its own words match. Reusing the
 * product matcher is the point – it is already tuned to read a signal, and the
 * catalog turns each product it finds into the team that builds it.
 */
function featureOwners(action: RecommendedAction): PostHogTeam[] {
  const features = [
    ...(action.feature ? [action.feature] : []),
    ...productsForAction(action).map((product) => product.label),
  ];
  return features.flatMap((feature) => teamsOwningFeature(feature));
}

function defaultTeams(action: RecommendedAction): PostHogTeam[] {
  const team = findTeam(DEFAULT_TEAM_NAMES[ACTION_OWNER[action.type]]);
  return team ? [team] : [];
}

/**
 * The teams one action is for, most involved first. Always at least one, never
 * more than three, and every one of them a team with a page on posthog.com.
 */
export function relatedTeams(action: RecommendedAction): PostHogTeam[] {
  const suggested = suggestedTeams(action);
  if (suggested.length > 0) return [...new Set(suggested)].slice(0, MAX_TEAMS);

  // A piece to publish is the blog's work first, whatever product it is about:
  // the team that owns the product it mentions is who checks the facts, and
  // goes second.
  const owners = isContentAction(action) ? teamsOwningFeature("Blog") : featureOwners(action);
  const derived = new Set([...owners, ...matchTeams(actionText(action), MAX_TEAMS)]);
  const teams = derived.size > 0 ? [...derived] : defaultTeams(action);
  return teams.slice(0, MAX_TEAMS);
}

/** The teams as an issue reads them: "Experiments, Feature Flags 🦫". */
export function relatedTeamsLabel(action: RecommendedAction): string {
  return relatedTeams(action).map(teamLabel).join(", ");
}
