import { describe, expect, it } from "vitest";
import { MAX_TEAMS, relatedTeams, relatedTeamsLabel } from "../src/teams.js";
import { ACTIONS, type RecommendedAction } from "../src/types.js";

const action = (overrides: Partial<RecommendedAction>): RecommendedAction => ({
  type: "consider_enhancing",
  detail: "A gap worth closing.",
  ...overrides,
});

describe("relatedTeams", () => {
  it("routes page work to marketing", () => {
    expect(relatedTeams(action({ type: "update_pages", detail: "The compare page is stale." }))).toEqual([
      "marketing",
    ]);
    expect(
      relatedTeams(action({ type: "new_compare_page", detail: "There is no page for this." })),
    ).toEqual(["marketing"]);
  });

  it("routes building and enhancing to product", () => {
    expect(relatedTeams(action({ type: "consider_building" }))).toEqual(["product"]);
    expect(relatedTeams(action({ type: "consider_enhancing", feature: "Experiments" }))).toEqual([
      "product",
    ]);
  });

  it("adds engineering when the action is about the plumbing", () => {
    for (const detail of [
      "Add an SDK flag for this.",
      "Route ingestion through a subdomain the customer owns.",
      "Document the DNS records a CNAME setup needs.",
      "Expose it on the public API.",
      "Give self-hosted deployments the same path.",
    ]) {
      expect(relatedTeams(action({ detail }))).toEqual(["product", "engineering"]);
    }
  });

  it("reads the feature as well as the detail", () => {
    expect(relatedTeams(action({ feature: "SDKs", detail: "PostHog has no equivalent." }))).toEqual([
      "product",
      "engineering",
    ]);
  });

  it("does not call every word that contains one of them infrastructure", () => {
    for (const detail of [
      "Rapid experiment iteration is the gap.",
      "The page understates the libraries PostHog publishes for capital markets.",
      "Proxies of engagement are not the point here.",
    ]) {
      expect(relatedTeams(action({ detail }))).toEqual(["product"]);
    }
  });

  it("always names at least one team, and never more than three", () => {
    for (const type of ACTIONS) {
      const teams = relatedTeams(action({ type, detail: "An SDK and API and ingestion change." }));
      expect(teams.length).toBeGreaterThanOrEqual(1);
      expect(teams.length).toBeLessThanOrEqual(MAX_TEAMS);
      expect(new Set(teams).size).toBe(teams.length);
    }
  });

  it("writes the teams the way an issue reads them", () => {
    expect(relatedTeamsLabel(action({ type: "update_pages", detail: "Fix the SDK page." }))).toBe(
      "Marketing, Engineering",
    );
  });
});
