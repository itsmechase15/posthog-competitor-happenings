import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createLogger } from "../log.js";
import type { PageKind, PostHogPage } from "../types.js";
import { titleFromUrl } from "../util/text.js";
import { sectionOf } from "./retrieval.js";

const log = createLogger("docs-workspace");

/** The name the analyst is told to start from. */
export const TOC_FILENAME = "TOC.md";
const PAGES_DIRNAME = "pages";

/**
 * What each kind of page is evidence of, stated on the page itself.
 *
 * The changelog line is the one that matters. PostHog ships things the docs
 * have not caught up with – it ships several a week – so a changelog entry is
 * proof the capability exists and no proof at all that it is documented, and
 * an analyst that cannot tell those apart will either invent a gap or wave one
 * away.
 */
export const EVIDENCE_LABEL: Record<PageKind, string> = {
  docs: "product documentation: what PostHog ships today",
  marketing: "marketing copy: written on some past date, not evidence about the product",
  changelog: "shipped, may be undocumented",
};

export interface DocsWorkspace {
  /** Absolute path the analyst runs in. */
  dir: string;
  /** Every page in the corpus, one line each, as written to `TOC.md`. */
  toc: string;
  /**
   * The same corpus as a list of its sections and their sizes. PostHog
   * publishes a few thousand pages, so the full list is too big to put in a
   * prompt; this is what goes in instead, with the full one a file read away.
   */
  outline: string;
  pageCount: number;
  /** The corpus URL a file holds, for reading an analyst's own file reads back. */
  urlForPath(path: string): string | undefined;
  /** Where a corpus URL was written, relative to `dir`. */
  pathForUrl(url: string): string | undefined;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "page"
  );
}

/** A stable, readable file path per URL: the docs section, then the rest of the path. */
function relativePathFor(url: string, taken: Set<string>): string {
  const section = sectionOf(url);
  let tail = url;
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const depth = section.split("/").length;
    tail = segments.slice(depth).join("-") || segments[segments.length - 1] || parsed.hostname;
  } catch {
    tail = slugify(url);
  }

  const base = `${PAGES_DIRNAME}/${slugify(section)}/${slugify(tail)}`;
  let candidate = `${base}.md`;
  let counter = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${counter}.md`;
    counter += 1;
  }
  taken.add(candidate);
  return candidate;
}

function day(date: Date): string {
  return date.getTime() === 0 ? "unknown" : date.toISOString().slice(0, 10);
}

/** One page as a file: what it is, where it came from, and its text. */
export function renderPageFile(page: PostHogPage): string {
  const title = page.title || titleFromUrl(page.url);
  return [
    "---",
    `url: ${page.url}`,
    `title: ${title}`,
    `kind: ${page.kind}`,
    `evidence: ${EVIDENCE_LABEL[page.kind]}`,
    `read: ${day(page.fetchedAt)}`,
    `last_changed: ${day(page.changedAt)}`,
    "---",
    "",
    `# ${title}`,
    "",
    page.text,
    "",
  ].join("\n");
}

interface TocEntry {
  path: string;
  page: PostHogPage;
}

const TOC_PREAMBLE = [
  "# PostHog docs workspace",
  "",
  "Every file opens with its source URL and what it is evidence of:",
  "",
  ...Object.entries(EVIDENCE_LABEL).map(([kind, label]) => `- \`${kind}\` ${label}`),
  "",
  "A page with no label is product documentation. Cite the `url` from the",
  "file's own header, never the file path.",
  "",
];

function groupBySection(entries: TocEntry[]): Map<string, TocEntry[]> {
  const bySection = new Map<string, TocEntry[]>();
  for (const entry of entries) {
    const section = sectionOf(entry.page.url);
    const group = bySection.get(section) ?? [];
    group.push(entry);
    bySection.set(section, group);
  }
  return bySection;
}

/**
 * The whole corpus as one list, grouped by section, written to disk.
 *
 * The failure this prevents is not "could not find the page" – it is not
 * knowing the page exists to look for. A list of every page is the difference
 * between "PostHog has no consent controls" and "there is a privacy section,
 * let me read it".
 */
export function renderToc(entries: TocEntry[]): string {
  const bySection = groupBySection(entries);
  const lines = [
    ...TOC_PREAMBLE,
    `${entries.length} pages, one file each, grouped by the section of the site they sit in.`,
    "",
  ];

  for (const section of [...bySection.keys()].sort()) {
    const group = (bySection.get(section) ?? []).sort((a, b) =>
      a.page.url.localeCompare(b.page.url),
    );
    lines.push(`## ${section} (${group.length})`);
    for (const entry of group) {
      const title = entry.page.title || titleFromUrl(entry.page.url);
      const label = entry.page.kind === "docs" ? "" : ` [${entry.page.kind}]`;
      // Title and path only. The URL to cite is in the file's own header,
      // which has to be opened anyway to quote from it.
      lines.push(`- ${title}${label} \`${entry.path}\``);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * The corpus as its sections: what each one is called, how many pages it
 * holds, and the directory they are in.
 *
 * This is what a prompt can afford. Listing four thousand page titles would
 * cost more than every other part of the prompt put together, and most of it
 * would be about products the launch has nothing to do with. A list of
 * sections still answers the question that matters – is there a part of the
 * docs about this at all – and the full list is one `read` away.
 */
export function renderOutline(entries: TocEntry[]): string {
  const bySection = groupBySection(entries);
  const lines = [
    `${entries.length} pages in ${bySection.size} sections. \`${TOC_FILENAME}\` lists every page by name; this is the shape of it.`,
    "",
  ];

  for (const section of [...bySection.keys()].sort()) {
    const group = bySection.get(section) ?? [];
    const kinds = new Set(group.map((entry) => entry.page.kind));
    const label = kinds.has("docs") && kinds.size === 1 ? "" : ` [${[...kinds].sort().join(", ")}]`;
    const dir = `${PAGES_DIRNAME}/${slugify(section)}/`;
    lines.push(`- \`${section}\`${label} ${group.length} pages in \`${dir}\``);
  }

  return lines.join("\n");
}

/**
 * Write the corpus to disk as markdown, one file per page, with a table of
 * contents.
 *
 * The directory is rebuilt each run rather than updated: a file left behind
 * for a page that has since been retired is a page the analyst can still
 * quote, which is the one thing the corpus is supposed to prevent.
 */
export async function writeDocsWorkspace(
  dir: string,
  pages: PostHogPage[],
): Promise<DocsWorkspace> {
  const root = resolve(dir);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  const taken = new Set<string>();
  const entries: TocEntry[] = [];
  const byPath = new Map<string, string>();
  const byUrl = new Map<string, string>();
  const madeDirs = new Set<string>();

  for (const page of [...pages].sort((a, b) => a.url.localeCompare(b.url))) {
    if (page.text.trim().length === 0) continue;
    const path = relativePathFor(page.url, taken);
    const absolute = join(root, path);
    const parent = dirname(absolute);
    if (!madeDirs.has(parent)) {
      await mkdir(parent, { recursive: true });
      madeDirs.add(parent);
    }
    await writeFile(absolute, renderPageFile(page), "utf8");
    entries.push({ path, page });
    byPath.set(path, page.url);
    byUrl.set(page.url, path);
  }

  const toc = renderToc(entries);
  await writeFile(join(root, TOC_FILENAME), toc, "utf8");

  log.info(`docs workspace: wrote ${entries.length} pages and a table of contents to ${root}`);

  return {
    dir: root,
    toc,
    outline: renderOutline(entries),
    pageCount: entries.length,

    urlForPath(path) {
      if (!path) return undefined;
      const candidate = isAbsolute(path) ? relative(root, path) : path.replace(/^\.\//, "");
      return byPath.get(candidate.split(sep).join("/"));
    },

    pathForUrl(url) {
      return byUrl.get(url);
    },
  };
}
