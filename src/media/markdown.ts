/**
 * Enough markdown to lay a blog draft out as a page.
 *
 * The draft a `consider_publishing` action carries is markdown, because that
 * is what a PostHog post is written in, and the picture of it in the issue
 * has to be of the piece laid out rather than of the markup. A dependency
 * would render every construct there is; a post uses headings, paragraphs,
 * lists, quotes, links, emphasis, and the odd code span, and that is what this
 * renders. Anything it does not recognize comes out as a paragraph, escaped,
 * so a construct it has never seen is a plain line rather than a broken page.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A URL a link may point at. Anything else renders as its text. */
function safeHref(href: string): string | null {
  return /^(https?:\/\/|mailto:|\/|#)/i.test(href.trim()) ? escapeHtml(href.trim()) : null;
}

/**
 * Inline marks: code first, so nothing inside a span is read as emphasis, then
 * links, strong, and emphasis. Applied to text that has already been escaped,
 * so the marks are the only markup that comes out.
 */
export function renderInline(text: string): string {
  const codes: string[] = [];
  let html = escapeHtml(text).replace(/`([^`]+)`/g, (_match, code: string) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });

  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    const safe = safeHref(href.replace(/&amp;/g, "&"));
    return safe ? `<a href="${safe}">${label}</a>` : label || match;
  });
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>");
  html = html.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");

  return html.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => codes[Number(index)] ?? "");
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const UNORDERED = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;

/** The whole draft as HTML body content: blocks, in order. */
export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];

  const flush = (): void => {
    if (paragraph.length === 0) return;
    out.push(`<p>${renderInline(paragraph.join(" ").trim())}</p>`);
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;

    if (line.trim() === "") {
      flush();
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const marker = fence[1] as string;
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] as string).trim().startsWith(marker)) {
        code.push(lines[index] as string);
        index += 1;
      }
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const level = (heading[1] as string).length;
      out.push(`<h${level}>${renderInline(heading[2] as string)}</h${level}>`);
      continue;
    }

    if (RULE.test(line)) {
      flush();
      out.push("<hr>");
      continue;
    }

    if (UNORDERED.test(line) || ORDERED.test(line)) {
      flush();
      const ordered = ORDERED.test(line);
      const pattern = ordered ? ORDERED : UNORDERED;
      const items: string[] = [];
      while (index < lines.length) {
        const item = pattern.exec(lines[index] as string);
        if (!item) break;
        items.push(`<li>${renderInline(item[1] as string)}</li>`);
        index += 1;
      }
      index -= 1;
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    if (QUOTE.test(line)) {
      flush();
      const quoted: string[] = [];
      while (index < lines.length) {
        const part = QUOTE.exec(lines[index] as string);
        if (!part) break;
        quoted.push(part[1] as string);
        index += 1;
      }
      index -= 1;
      out.push(`<blockquote>${renderMarkdown(quoted.join("\n"))}</blockquote>`);
      continue;
    }

    paragraph.push(line.trim());
  }

  flush();
  return out.join("\n");
}

/**
 * The draft's own headline, when it opens with one, and the rest of it. A
 * draft that repeats its title as a first heading would otherwise render the
 * title twice, once from the action and once from the markdown.
 */
export function splitLeadingHeading(markdown: string): { heading: string | null; body: string } {
  const match = /^\s*#\s+(.+?)\s*\n+/.exec(markdown);
  if (!match) return { heading: null, body: markdown };
  return { heading: (match[1] as string).trim(), body: markdown.slice(match[0].length) };
}
