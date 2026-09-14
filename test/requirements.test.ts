import { describe, expect, it } from "vitest";
import {
  checkEnv,
  formatReport,
  isDirectSupabaseHost,
  isFailing,
  REQUIREMENTS,
} from "../src/setup/requirements.js";

const FULL = {
  DATABASE_URL: "postgresql://user:pw@aws-0-us-west-1.pooler.supabase.com:5432/postgres",
  CURSOR_API_KEY: "key_live",
  SLACK_BOT_TOKEN: "xoxb-000",
  X_BEARER_TOKEN: "bearer",
  AGENTMAIL_API_KEY: "am_key",
  AGENTMAIL_INBOX_ID: "someone@agentmail.to",
  GITHUB_TOKEN: "ghs_000",
};

describe("checkEnv", () => {
  it("passes a fully configured environment", () => {
    const report = checkEnv(FULL);
    expect(report.missingRequired).toHaveLength(0);
    expect(report.missingSources).toHaveLength(0);
    expect(isFailing(report, true)).toBe(false);
  });

  it("names every required secret an empty environment is missing", () => {
    const report = checkEnv({});
    const names = report.missingRequired.map((requirement) => requirement.name);
    expect(names).toEqual(["DATABASE_URL", "CURSOR_API_KEY", "SLACK_BOT_TOKEN"]);
    expect(isFailing(report, false)).toBe(true);
  });

  it("treats a missing source as a warning, not a failure", () => {
    const report = checkEnv({ ...FULL, X_BEARER_TOKEN: "", AGENTMAIL_API_KEY: "" });
    expect(report.missingRequired).toHaveLength(0);
    expect(report.missingSources.map((requirement) => requirement.name)).toEqual([
      "X_BEARER_TOKEN",
      "AGENTMAIL_API_KEY",
    ]);
    expect(isFailing(report, false)).toBe(false);
    expect(isFailing(report, true)).toBe(true);
  });

  it("only asks for the inbox id once the newsletter source is switched on", () => {
    const withoutKey = checkEnv({ ...FULL, AGENTMAIL_API_KEY: "", AGENTMAIL_INBOX_ID: "" });
    expect(withoutKey.missingSources.map((requirement) => requirement.name)).not.toContain(
      "AGENTMAIL_INBOX_ID",
    );

    const withKey = checkEnv({ ...FULL, AGENTMAIL_INBOX_ID: "" });
    expect(withKey.missingSources.map((requirement) => requirement.name)).toContain(
      "AGENTMAIL_INBOX_ID",
    );
  });

  it("accepts the webhook as a delivery path, and says what it costs", () => {
    const report = checkEnv({ ...FULL, SLACK_BOT_TOKEN: "", SLACK_WEBHOOK_URL: "https://hooks" });
    expect(report.missingRequired).toHaveLength(0);
    expect(report.warnings.join(" ")).toContain("SLACK_WEBHOOK_URL");
  });

  it("does not demand a database for a dry run", () => {
    const report = checkEnv({ CURSOR_API_KEY: "k", SLACK_BOT_TOKEN: "xoxb", DRY_RUN: "true" });
    expect(report.missingRequired).toHaveLength(0);
  });

  it("catches Supabase's IPv6-only direct host before Actions does", () => {
    expect(isDirectSupabaseHost("postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres")).toBe(
      true,
    );
    expect(isDirectSupabaseHost(FULL.DATABASE_URL)).toBe(false);

    const report = checkEnv({
      ...FULL,
      DATABASE_URL: "postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
    });
    expect(report.warnings.join(" ")).toContain("Session pooler");
  });

  it("tells the reader where to get and put anything missing", () => {
    const text = formatReport(checkEnv({}), false);
    expect(text).toContain("DATABASE_URL");
    expect(text).toContain("Session pooler");
    expect(text).toContain("Settings → Secrets and variables → Actions");
    expect(text).toContain("Never paste a secret");
  });

  it("gives every requirement a way to get the value", () => {
    for (const requirement of REQUIREMENTS) {
      expect(requirement.howToGet.length, requirement.name).toBeGreaterThan(0);
      expect(requirement.purpose.length, requirement.name).toBeGreaterThan(0);
    }
  });
});
