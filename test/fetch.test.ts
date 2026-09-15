import { describe, expect, it } from "vitest";
import { markdownLinks, markdownUrlFor, parseDocMarkdown } from "../src/posthog/fetch.js";

describe("markdownUrlFor", () => {
  it("asks for the markdown copy of a docs page, which reads better than the HTML", () => {
    expect(markdownUrlFor("https://posthog.com/docs/experiments")).toBe(
      "https://posthog.com/docs/experiments.md",
    );
  });

  it("leaves a markdown URL alone", () => {
    expect(markdownUrlFor("https://posthog.com/docs/experiments.md")).toBe(
      "https://posthog.com/docs/experiments.md",
    );
  });

  it("offers nothing for a page posthog.com does not serve as markdown", () => {
    expect(markdownUrlFor("https://posthog.com/pricing")).toBeNull();
    expect(markdownUrlFor("https://posthog.com/compare/mixpanel-vs-posthog")).toBeNull();
    expect(markdownUrlFor("https://mixpanel.com/docs/anything")).toBeNull();
  });
});

describe("markdownLinks", () => {
  it("resolves a page's own links, which is how discovery reaches an unlisted page", () => {
    const links = markdownLinks(
      "See [holdouts](/docs/experiments/holdouts.md) and [flags](https://posthog.com/docs/feature-flags).",
      "https://posthog.com/docs/experiments",
    );

    expect(links).toEqual([
      "https://posthog.com/docs/experiments/holdouts.md",
      "https://posthog.com/docs/feature-flags",
    ]);
  });

  it("ignores an in-page anchor, which points at no other page", () => {
    expect(markdownLinks("[setup](#setup)", "https://posthog.com/docs/x")).toEqual([]);
  });
});

describe("parseDocMarkdown", () => {
  /** A posthog.com docs page, chrome and all, as the .md endpoint serves it. */
  const live = `> AI agents: this is one page from PostHog's docs. Full index of Markdown docs for LLMs: https://posthog.com/llms.txt

# Experiments - Docs

Copy page

# Experiments - Docs

Experiments let you test a change against a control and find out whether it worked.

\`\`\`js
posthog.getFeatureFlag('my-experiment')
\`\`\`

See [holdouts](/docs/experiments/holdouts.md).`;

  const parsed = parseDocMarkdown(live, "https://posthog.com/docs/experiments");

  it("drops the banner, which would otherwise lead every excerpt on the site", () => {
    // It is on 3,400 pages and it is the first line of all of them, so without
    // this the analyst's first sentence about every page is the same sentence.
    expect(parsed.text).not.toContain("AI agents");
    expect(parsed.text).not.toContain("llms.txt");
  });

  it("drops the copy-page button and the title it prints twice", () => {
    expect(parsed.text).not.toContain("Copy page");
    expect(parsed.text.match(/Experiments - Docs/g)).toHaveLength(1);
  });

  it("opens on what the page actually says", () => {
    expect(parsed.text).toMatch(/^Experiments - Docs Experiments let you test a change/);
  });

  it("takes the title from the heading when there is no frontmatter", () => {
    expect(parsed.title).toBe("Experiments - Docs");
  });

  it("drops code blocks, so nobody reasons about a snippet instead of the product", () => {
    expect(parsed.text).not.toContain("getFeatureFlag");
  });

  it("keeps a link's words and reads its target off the source", () => {
    expect(parsed.text).toContain("See holdouts");
    expect(parsed.links).toEqual(["https://posthog.com/docs/experiments/holdouts.md"]);
  });

  it("prefers a frontmatter title when the page has one", () => {
    const withFrontmatter = parseDocMarkdown('---\ntitle: "Managing the lifecycle"\n---\n\nProse.');
    expect(withFrontmatter.title).toBe("Managing the lifecycle");
    expect(withFrontmatter.text).toBe("Prose.");
  });
});
