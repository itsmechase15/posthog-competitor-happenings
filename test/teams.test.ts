import { describe, expect, it } from "vitest";
import {
  findTeam,
  matchTeams,
  POSTHOG_TEAMS,
  teamLabel,
  teamsOwningFeature,
} from "../src/posthog/teams.js";
import { MAX_TEAMS, relatedTeams, relatedTeamsLabel } from "../src/teams.js";
import { ACTIONS, type RecommendedAction } from "../src/types.js";

const action = (overrides: Partial<RecommendedAction>): RecommendedAction => ({
  type: "consider_enhancing",
  detail: "A gap worth closing.",
  ...overrides,
});

const slugs = (value: RecommendedAction): string[] =>
  relatedTeams(value).map((team) => team.slug);

describe("the small team catalog", () => {
  it("only holds teams with a page on posthog.com/teams", () => {
    for (const team of POSTHOG_TEAMS) {
      expect(team.url).toBe(`https://posthog.com/teams/${team.slug}`);
      expect(team.slug).toMatch(/^[a-z0-9-]+$/);
      expect(team.name.trim()).toBe(team.name);
    }
    expect(new Set(POSTHOG_TEAMS.map((team) => team.slug)).size).toBe(POSTHOG_TEAMS.length);
  });

  it("carries the spirit animals PostHog's team pages show", () => {
    expect(findTeam("Marketing")?.emoji).toBe("🦆");
    expect(findTeam("Growth")?.emoji).toBe("🦦");
    expect(findTeam("Feature Flags")?.emoji).toBe("🦫");
  });

  it("leaves the emoji off a team that has not picked an animal", () => {
    expect(findTeam("Experiments")?.emoji).toBeUndefined();
    expect(findTeam("Ingestion")?.emoji).toBeUndefined();
    expect(teamLabel(findTeam("Experiments")!)).toBe("Experiments");
    expect(teamLabel(findTeam("Marketing")!)).toBe("Marketing 🦆");
  });

  it("finds a team however a model wrote its name", () => {
    for (const written of [
      "Feature Flags",
      "feature flags",
      "feature-flags",
      "the Feature Flags team",
      "Feature Flags 🦫",
    ]) {
      expect(findTeam(written)?.slug).toBe("feature-flags");
    }
    expect(findTeam("Wizard and Docs")?.slug).toBe("wizard-and-docs");
  });

  it("refuses a name that is not a small team", () => {
    for (const invented of ["Product", "Engineering", "Platform", "Core Engineering", ""]) {
      expect(findTeam(invented)).toBeUndefined();
    }
  });

  it("knows who owns a feature", () => {
    expect(teamsOwningFeature("Experiments").map((team) => team.slug)).toContain("experiments");
    expect(teamsOwningFeature("Session replay").map((team) => team.slug)).toContain("replay");
    expect(teamsOwningFeature("Managed reverse proxy").map((team) => team.slug)).toContain(
      "ingestion",
    );
  });

  it("reads a team's vocabulary out of a sentence", () => {
    expect(matchTeams("Route events through a subdomain the customer owns.", 1)[0]?.slug).toBe(
      "ingestion",
    );
    expect(matchTeams("The NPS survey response rate is the gap.", 1)[0]?.slug).toBe("surveys");
  });
});

describe("relatedTeams", () => {
  it("routes an action to the team that owns the feature it names", () => {
    expect(slugs(action({ feature: "Experiments" }))).toContain("experiments");
    expect(slugs(action({ feature: "Feature flags" }))).toContain("feature-flags");
    expect(slugs(action({ feature: "Session replay" }))).toContain("replay");
  });

  it("routes plumbing to the team that owns the plumbing, not to engineering", () => {
    const teams = slugs(
      action({
        detail: "Send events through a reverse proxy on a domain the customer owns.",
      }),
    );
    expect(teams).toContain("ingestion");
    expect(teams).not.toContain("product-analytics");
  });

  it("routes page work to Marketing", () => {
    expect(slugs(action({ type: "update_pages", detail: "The compare page is stale." }))).toContain(
      "marketing",
    );
    expect(
      slugs(action({ type: "new_compare_page", detail: "There is no page for this." })),
    ).toContain("marketing");
  });

  it("takes the model's suggestion when it names a real team", () => {
    expect(
      slugs(action({ teams: ["Editorial", "Marketing"], type: "update_pages", detail: "Write it up." })),
    ).toEqual(["editorial", "marketing"]);
  });

  it("throws away a suggested team that is not on posthog.com/teams", () => {
    const teams = slugs(
      action({ teams: ["Product", "Engineering"], feature: "Experiments" }),
    );
    expect(teams).toContain("experiments");
    for (const invented of ["product", "engineering"]) {
      expect(teams).not.toContain(invented);
    }
  });

  it("always names at least one team, and never more than three", () => {
    for (const type of ACTIONS) {
      const teams = relatedTeams(
        action({ type, detail: "An SDK, a reverse proxy, and an ingestion change." }),
      );
      expect(teams.length).toBeGreaterThanOrEqual(1);
      expect(teams.length).toBeLessThanOrEqual(MAX_TEAMS);
      expect(new Set(teams).size).toBe(teams.length);
    }
  });

  it("caps a model that suggests more teams than the issue can carry", () => {
    const teams = relatedTeams(
      action({ teams: ["Experiments", "Feature Flags", "Marketing", "Editorial", "Website"] }),
    );
    expect(teams.map((team) => team.slug)).toEqual(["experiments", "feature-flags", "marketing"]);
  });

  it("writes the teams the way an issue reads them, with the animal", () => {
    expect(relatedTeamsLabel(action({ teams: ["Experiments", "Feature Flags"] }))).toBe(
      "Experiments, Feature Flags 🦫",
    );
    expect(
      relatedTeamsLabel(action({ teams: ["Marketing", "Growth"], type: "update_pages" })),
    ).toBe("Marketing 🦆, Growth 🦦");
  });
});
