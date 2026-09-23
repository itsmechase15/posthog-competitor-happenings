import { describe, expect, it } from "vitest";
import { renderInline, renderMarkdown, splitLeadingHeading } from "../src/media/markdown.js";

/**
 * Enough markdown to lay a post out: what a PostHog draft uses, rendered as
 * the HTML the draft page is photographed from, and nothing it does not
 * recognize allowed to break the page.
 */

describe("renderInline", () => {
  it("renders emphasis, strong, code, and links", () => {
    expect(renderInline("Use **bold**, *italic*, `code`, and [a link](https://posthog.com/docs).")).toBe(
      'Use <strong>bold</strong>, <em>italic</em>, <code>code</code>, and <a href="https://posthog.com/docs">a link</a>.',
    );
  });

  it("escapes HTML, so a draft cannot put markup on the page", () => {
    expect(renderInline("a <script>alert(1)</script> & b")).toBe(
      "a &lt;script&gt;alert(1)&lt;/script&gt; &amp; b",
    );
  });

  it("leaves emphasis marks inside a code span alone", () => {
    expect(renderInline("call `posthog.capture(**event**)` now")).toBe(
      "call <code>posthog.capture(**event**)</code> now",
    );
  });

  it("renders a link with a scheme it does not trust as its text", () => {
    expect(renderInline("[x](javascript:alert)")).toBe("x");
  });

  it("does not read a snake_case word as emphasis", () => {
    expect(renderInline("set feature_flag_called and my_var_name")).toBe(
      "set feature_flag_called and my_var_name",
    );
  });
});

describe("renderMarkdown", () => {
  it("renders headings, paragraphs, lists, quotes, rules, and fences in order", () => {
    const html = renderMarkdown(
      [
        "# Title",
        "",
        "First paragraph",
        "continues here.",
        "",
        "## Second",
        "",
        "- one",
        "- two",
        "",
        "1. first",
        "2. second",
        "",
        "> quoted",
        "> lines",
        "",
        "---",
        "",
        "```js",
        "posthog.capture('<event>')",
        "```",
      ].join("\n"),
    );
    expect(html).toBe(
      [
        "<h1>Title</h1>",
        "<p>First paragraph continues here.</p>",
        "<h2>Second</h2>",
        "<ul><li>one</li><li>two</li></ul>",
        "<ol><li>first</li><li>second</li></ol>",
        "<blockquote><p>quoted lines</p></blockquote>",
        "<hr>",
        "<pre><code>posthog.capture('&lt;event&gt;')</code></pre>",
      ].join("\n"),
    );
  });

  it("renders a construct it does not know as an escaped paragraph", () => {
    expect(renderMarkdown("| a | b |\n|---|---|")).toBe("<p>| a | b | |---|---|</p>");
  });

  it("closes an unterminated fence at the end of the draft", () => {
    expect(renderMarkdown("```\ncode")).toBe("<pre><code>code</code></pre>");
  });

  it("handles Windows line endings", () => {
    expect(renderMarkdown("# A\r\n\r\nb")).toBe("<h1>A</h1>\n<p>b</p>");
  });
});

describe("splitLeadingHeading", () => {
  it("takes a leading h1 off as the title, so the page does not print it twice", () => {
    expect(splitLeadingHeading("# The headline\n\nBody starts here.")).toEqual({
      heading: "The headline",
      body: "Body starts here.",
    });
  });

  it("leaves a draft that opens with prose alone", () => {
    expect(splitLeadingHeading("Body first.\n\n## Then a heading")).toEqual({
      heading: null,
      body: "Body first.\n\n## Then a heading",
    });
  });
});
