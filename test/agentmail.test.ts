import { describe, expect, it } from "vitest";
import { COMPETITORS } from "../src/config.js";
import { messagesToItems, messagesUrl, routeMessage } from "../src/sources/agentmail.js";

const competitors = [COMPETITORS.mixpanel, COMPETITORS.amplitude];

describe("messagesUrl", () => {
  it("scopes the request to the inbox and lookback window", () => {
    const url = messagesUrl("inbox@fixture.invalid", new Date("2026-01-01T00:00:00Z"), 25);
    expect(url).toContain("/v0/inboxes/inbox%40fixture.invalid/messages");
    expect(url).toContain("limit=25");
    expect(url).toContain("after=2026-01-01T00%3A00%3A00.000Z");
  });
});

describe("routeMessage", () => {
  it("routes on the subject", () => {
    expect(routeMessage({ message_id: "m1", subject: "Mixpanel monthly" }, competitors)).toBe(
      "mixpanel",
    );
  });

  it("routes on the sender when the subject says nothing", () => {
    expect(
      routeMessage({ message_id: "m2", subject: "Product news", from: "news@amplitude.com" }, competitors),
    ).toBe("amplitude");
  });

  it("returns null for unrelated mail", () => {
    expect(routeMessage({ message_id: "m3", subject: "Your invoice" }, competitors)).toBeNull();
  });
});

describe("messagesToItems", () => {
  it("keeps only competitor mail and dedupes on message id", () => {
    const items = messagesToItems(
      [
        { message_id: "m1", subject: "Mixpanel monthly", timestamp: "2026-01-15T00:00:00Z" },
        { message_id: "m2", subject: "Your invoice" },
      ],
      competitors,
      "inbox@fixture.invalid",
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      competitor: "mixpanel",
      source: "newsletter",
      externalId: "m1",
    });
  });
});
