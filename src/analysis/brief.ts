import { SPACED_EN_DASH } from "../util/text.js";

/**
 * The three labels on a `consider_publishing` brief.
 *
 * They are prose the model copies, so they live here rather than only inside a
 * worked example: the analyst prompt asks for them, the rewrite prompt asks for
 * them again so a revise cannot wipe the shape, the issue renderer prints them,
 * and the tests grep for them. A label that exists in one example and nowhere
 * else is the mistake this file replaces.
 *
 * What each one is for, in the order a marketer reads them: which PostHog
 * products the piece features, whose argument the piece answers and where the
 * draft stands on it, then the draft's beats.
 */
export const BRIEF_LABELS = {
  products: "Product(s) highlighted",
  positioning: "Article positioning:",
  outline: "Content outline:",
} as const;

/** The order the bullets go in, which is the order they are read in. */
export const BRIEF_LABEL_ORDER = [
  BRIEF_LABELS.products,
  BRIEF_LABELS.positioning,
  BRIEF_LABELS.outline,
] as const;

/**
 * Labels briefs were filed under before these, mapped onto the ones above.
 *
 * Two generations of them: the shipped prompt's `Position against:`, `Lead
 * with:`, and `Draft covers:`, which is what issue #104 carries, and the
 * longer labels drafted while this was being planned, in case anything was
 * filed under those. A stored analysis is re-rendered on every PATCH, so an
 * issue opened under an old prompt reads in the new labels the next time a
 * review touches it.
 */
export const LEGACY_BRIEF_LABELS: Readonly<Record<string, string>> = {
  "Position against:": BRIEF_LABELS.positioning,
  "The pitch the draft answers:": BRIEF_LABELS.positioning,
  "Lead with:": BRIEF_LABELS.products,
  "PostHog products the draft leads with, in order:": BRIEF_LABELS.products,
  "Draft covers:": BRIEF_LABELS.outline,
  "What the draft covers, in order:": BRIEF_LABELS.outline,
};

/**
 * One brief bullet, written the way the prompt asks for it: the label in bold,
 * then what the bullet says. A label that already ends in a colon carries its
 * own punctuation; `Product(s) highlighted` does not, so it takes a dash.
 */
export function briefBullet(label: string, rest: string): string {
  const head = `**${label}**`;
  if (rest === "") return `- ${head}`;
  return label.endsWith(":") ? `- ${head} ${rest}` : `- ${head}${SPACED_EN_DASH}${rest}`;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every label a stored brief may carry, longest first so no prefix wins early. */
const KNOWN_LABELS: ReadonlyArray<readonly [string, string]> = [
  ...Object.entries(LEGACY_BRIEF_LABELS),
  ...Object.values(BRIEF_LABELS).map((label) => [label, label] as const),
].sort(([a], [b]) => b.length - a.length);

/** `- `, `* `, or `+ ` at the start of a line, with whatever indent it has. */
const BULLET_OPENER = /^(\s*)[-*+][ \t]+/;

/**
 * Rewrite the labels on a brief's bullets into the current ones.
 *
 * A rename invents no words, which is the line the rest of the pipeline
 * already stands on: it moves nothing on the line but the label, and it leaves
 * prose alone, so the lead sentence a marketer reads in Slack is untouched. It
 * is also the backstop for a model that drifts back to a label it saw in an
 * older example.
 */
export function normalizeBriefLabels(detail: string): string {
  return detail
    .split("\n")
    .map((line) => {
      const opener = BULLET_OPENER.exec(line);
      if (!opener) return line;

      const indent = opener[1] ?? "";
      const body = line.slice(opener[0].length);

      for (const [from, to] of KNOWN_LABELS) {
        // The label as stored: bold or bare, and followed by whatever
        // separator the writer put between it and the rest of the bullet.
        const match = new RegExp(
          `^(?:\\*\\*\\s*)?${escapeForRegExp(from)}(?:\\s*\\*\\*)?[ \\t]*[:\\u2013\\u2014-]?[ \\t]*`,
        ).exec(body);
        if (!match) continue;
        return `${indent}${briefBullet(to, body.slice(match[0].length).trim())}`;
      }
      return line;
    })
    .join("\n");
}
