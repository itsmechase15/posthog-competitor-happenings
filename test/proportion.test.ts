import { describe, expect, it } from "vitest";
import {
  budgetFor,
  countWords,
  describeProportion,
  isOutsized,
  measureEdit,
  MIN_GROWTH_WORDS,
  proportionProblem,
} from "../src/analysis/proportion.js";
import type { PostHogRef } from "../src/types.js";

/** Three short paragraphs, which is the page the rule exists for. */
const SHORT_PAGE = `Flat rate CDN

Serve your static assets from the edge without paying per request. One rate a month, whatever the traffic does.

Assets are cached at every location and purged when you deploy, so a release is live everywhere within seconds.

Turn it on from the project settings. There is nothing to configure and nothing to size.`;

const CLAIM = "One rate a month, whatever the traffic does.";

/** A sentence and a bit, which is what a page this short can carry. */
const SHORT_EDIT =
  "One rate a month, whatever the traffic does. A competitor now bundles the same delivery into their platform fee, and this stays a single line on your bill.";

/** The same point, made at four times the length. This is the mistake. */
const LONG_EDIT = `One rate a month, whatever the traffic does. A competitor has moved their own CDN onto a flat rate, bundling delivery into the platform fee they already charge for compute and databases.
Their rate covers the first terabyte of transfer each month and meters everything after it at a per-gigabyte price that changes by region, with a separate rate for requests served from cache and another for requests that miss it.
Teams on their older metered plan keep those terms until renewal, and their migration guide asks you to move workloads one project at a time so the two billing models never overlap.
Before that change they charged per request on every tier, which made a busy static site cost more than the compute serving it, and they published a calculator to work out which of the two plans came out cheaper.`;

const ref = (overrides: Partial<PostHogRef> = {}): PostHogRef => ({
  url: "https://posthog.com/compare/mixpanel-vs-posthog",
  claim: CLAIM,
  proposedText: SHORT_EDIT,
  ...overrides,
});

describe("countWords", () => {
  it("counts runs of non-space, and nothing at all in an empty string", () => {
    expect(countWords("one two  three\nfour")).toBe(4);
    expect(countWords("   ")).toBe(0);
  });
});

describe("budgetFor", () => {
  it("gives a short page the floor, so one honest sentence always fits", () => {
    expect(budgetFor(40)).toBe(MIN_GROWTH_WORDS);
    expect(budgetFor(0)).toBe(MIN_GROWTH_WORDS);
  });

  it("gives a long page a fifth of itself", () => {
    expect(budgetFor(1_000)).toBe(200);
  });
});

describe("measureEdit", () => {
  it("credits the edit with the line it replaces, because that is what the page gives back", () => {
    const size = measureEdit(SHORT_PAGE, CLAIM, SHORT_EDIT);
    expect(size.replacedWords).toBe(countWords(CLAIM));
    expect(size.addedWords).toBe(size.proposedWords - size.replacedWords);
    expect(isOutsized(size)).toBe(false);
  });

  it("counts a trim as adding nothing rather than as a negative", () => {
    const size = measureEdit(SHORT_PAGE, SHORT_EDIT, CLAIM);
    expect(size.addedWords).toBe(0);
    expect(isOutsized(size)).toBe(false);
  });

  it("calls a competitive write-up on a short page what it is", () => {
    const size = measureEdit(SHORT_PAGE, CLAIM, LONG_EDIT);
    expect(size.addedWords).toBeGreaterThan(size.budgetWords);
    expect(isOutsized(size)).toBe(true);
  });

  it("lets the same copy through on a page with the room for it", () => {
    const long = `${SHORT_PAGE}\n${"Every asset is served from the location nearest the person asking for it, and the cache is warmed on deploy so the first visitor after a release waits no longer than the tenth. ".repeat(
      20,
    )}`;
    expect(isOutsized(measureEdit(long, CLAIM, LONG_EDIT))).toBe(false);
  });
});

describe("proportionProblem", () => {
  it("says nothing about an edit the page can carry", () => {
    expect(proportionProblem(ref(), { text: SHORT_PAGE })).toBeNull();
  });

  it("names both lengths, so the open question can be acted on", () => {
    const problem = proportionProblem(ref({ proposedText: LONG_EDIT }), { text: SHORT_PAGE });
    expect(problem).toContain("proportional to the page");
    expect(problem).toContain(`page of ${countWords(SHORT_PAGE)}`);
    expect(problem).toContain("or leave the page alone");
  });

  it("judges nothing when there is no stored page to measure against", () => {
    expect(proportionProblem(ref({ proposedText: LONG_EDIT }), undefined)).toBeNull();
  });

  it("judges nothing when no copy was proposed, which is a different complaint", () => {
    expect(proportionProblem(ref({ proposedText: undefined }), { text: SHORT_PAGE })).toBeNull();
  });
});

describe("describeProportion", () => {
  it("gives a reviewer the numbers rather than asking it to picture the page", () => {
    const line = describeProportion({ text: SHORT_PAGE }, ref({ proposedText: LONG_EDIT }));
    expect(line).toContain(`the page runs about ${countWords(SHORT_PAGE)} words`);
    expect(line).toContain("over the");
  });

  it("says so when the copy is within what the page carries", () => {
    expect(describeProportion({ text: SHORT_PAGE }, ref())).toContain("within the");
  });
});
