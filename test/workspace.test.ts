import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EVIDENCE_LABEL, renderPageFile, TOC_FILENAME, writeDocsWorkspace } from "../src/posthog/workspace.js";
import { page } from "./helpers.js";

const dirs: string[] = [];

async function workspaceDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "docs-workspace-"));
  dirs.push(dir);
  return join(dir, "corpus");
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const pages = [
  page({
    url: "https://posthog.com/docs/experiments/managing-lifecycle",
    title: "Managing the experiment lifecycle",
    text: "You stop an experiment by hand.",
    fetchedAt: new Date("2026-02-01T00:00:00Z"),
    changedAt: new Date("2026-01-15T00:00:00Z"),
  }),
  page({
    url: "https://posthog.com/compare/mixpanel-vs-posthog",
    title: "Mixpanel vs PostHog",
    kind: "marketing",
    text: "PostHog is the open-source alternative to Mixpanel.",
  }),
  page({
    url: "https://posthog.com/changelog/2026-01",
    title: "January changelog",
    kind: "changelog",
    text: "Experiments can now stop on a schedule.",
  }),
];

describe("renderPageFile", () => {
  it("opens with the URL to cite and what the page is evidence of", () => {
    const rendered = renderPageFile(pages[0]!);

    expect(rendered).toContain("url: https://posthog.com/docs/experiments/managing-lifecycle");
    expect(rendered).toContain(`evidence: ${EVIDENCE_LABEL.docs}`);
    expect(rendered).toContain("read: 2026-02-01");
    expect(rendered).toContain("last_changed: 2026-01-15");
    expect(rendered).toContain("You stop an experiment by hand.");
  });

  it("says a changelog entry is shipped but maybe undocumented", () => {
    // The distinction an analyst has to make: proof something exists, and no
    // proof at all that the docs mention it.
    expect(renderPageFile(pages[2]!)).toContain("evidence: shipped, may be undocumented");
  });

  it("says marketing copy is not evidence about the product", () => {
    expect(renderPageFile(pages[1]!)).toContain("not evidence about the product");
  });
});

describe("writeDocsWorkspace", () => {
  it("writes one file per page and a table of contents", async () => {
    const workspace = await writeDocsWorkspace(await workspaceDir(), pages);

    expect(workspace.pageCount).toBe(3);
    expect(await readdir(workspace.dir)).toContain(TOC_FILENAME);
    const toc = await readFile(join(workspace.dir, TOC_FILENAME), "utf8");
    expect(toc).toContain("Managing the experiment lifecycle");
    expect(toc).toContain("Mixpanel vs PostHog [marketing]");
  });

  it("reads an opened file back to the URL it holds, which is what the gate rests on", async () => {
    const workspace = await writeDocsWorkspace(await workspaceDir(), pages);
    const path = workspace.pathForUrl("https://posthog.com/docs/experiments/managing-lifecycle");

    expect(path).toBeDefined();
    expect(workspace.urlForPath(path!)).toBe(
      "https://posthog.com/docs/experiments/managing-lifecycle",
    );
    // However the agent wrote the path back at us.
    expect(workspace.urlForPath(`./${path}`)).toBe(
      "https://posthog.com/docs/experiments/managing-lifecycle",
    );
    expect(workspace.urlForPath(join(workspace.dir, path!))).toBe(
      "https://posthog.com/docs/experiments/managing-lifecycle",
    );
  });

  it("knows nothing about a path it did not write", async () => {
    const workspace = await writeDocsWorkspace(await workspaceDir(), pages);
    expect(workspace.urlForPath("pages/made/up.md")).toBeUndefined();
    expect(workspace.urlForPath("")).toBeUndefined();
  });

  it("rebuilds the directory, so a retired page cannot still be quoted", async () => {
    const dir = await workspaceDir();
    await writeDocsWorkspace(dir, pages);
    const second = await writeDocsWorkspace(dir, [pages[0]!]);

    expect(second.pageCount).toBe(1);
    expect(second.pathForUrl("https://posthog.com/compare/mixpanel-vs-posthog")).toBeUndefined();
  });

  it("leaves out a page with no text, which nobody could read", async () => {
    const workspace = await writeDocsWorkspace(await workspaceDir(), [
      ...pages,
      page({ url: "https://posthog.com/docs/empty", text: "  " }),
    ]);
    expect(workspace.pageCount).toBe(3);
  });

  it("gives two pages that slugify the same their own files", async () => {
    const workspace = await writeDocsWorkspace(await workspaceDir(), [
      page({ url: "https://posthog.com/docs/a/b-c", text: "one" }),
      page({ url: "https://posthog.com/docs/a/b_c", text: "two" }),
    ]);

    const paths = [
      workspace.pathForUrl("https://posthog.com/docs/a/b-c"),
      workspace.pathForUrl("https://posthog.com/docs/a/b_c"),
    ];
    expect(new Set(paths).size).toBe(2);
    expect(workspace.pageCount).toBe(2);
  });

  describe("the listing that goes in the prompt", () => {
    it("names every page when the corpus is small enough to list", async () => {
      const workspace = await writeDocsWorkspace(await workspaceDir(), pages);
      expect(workspace.toc).toContain("Managing the experiment lifecycle");
    });

    it("stays small on a corpus of a few thousand pages, where the full list cannot", async () => {
      // PostHog publishes roughly 3,700 pages worth holding. Listing them all
      // would cost more than every other part of the prompt put together.
      const many = Array.from({ length: 3_000 }, (_, n) =>
        page({
          url: `https://posthog.com/docs/section-${n % 40}/page-${n}`,
          title: `A documentation page about something number ${n}`,
          text: "Some prose about the product.",
        }),
      );
      const workspace = await writeDocsWorkspace(await workspaceDir(), many);

      expect(workspace.toc.length).toBeGreaterThan(60_000);
      expect(workspace.outline.length).toBeLessThan(10_000);
      // Still answers "is there a part of the docs about this at all", and
      // still points at the full list, which is one file read away.
      expect(workspace.outline).toContain("docs/section-7");
      expect(workspace.outline).toContain(TOC_FILENAME);
    });

    it("labels a section that is not product documentation", async () => {
      const workspace = await writeDocsWorkspace(await workspaceDir(), pages);
      expect(workspace.outline).toContain("`changelog` [changelog]");
      expect(workspace.outline).toContain("`compare` [marketing]");
    });
  });
});
