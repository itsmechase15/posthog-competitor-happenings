import { collapseWhitespace, sentences } from "../util/text.js";

/**
 * Open questions, kept as questions.
 *
 * The section is called "Open questions" and a reader scans it for the things
 * nobody has settled, so an item that reads as a statement makes them work out
 * what is being asked. "Whether Headless is generally available on every
 * Mixpanel plan" is a note somebody left themselves; "Is Headless generally
 * available on every Mixpanel plan?" is the same content as a question a
 * person can go and answer.
 *
 * Every string that can reach the section passes through here: the analyst's
 * own `open_questions`, the questions the gate and the docs check add, and the
 * issue body one last time on the way out. An item that is already a question
 * survives untouched, which is what makes running it three times harmless.
 */

/** A question leads. Context sentences after it are welcome, and optional. */
export function isQuestion(text: string): boolean {
  const [lead] = sentences(text);
  return Boolean(lead?.endsWith("?"));
}

/**
 * Auxiliaries worth inverting on. Enough to turn the statements a model
 * actually writes into questions, and short enough that it never has to guess:
 * every word here makes a question when it moves in front of its subject.
 */
const AUXILIARIES = new Set([
  "is",
  "are",
  "was",
  "were",
  "has",
  "have",
  "had",
  "can",
  "could",
  "will",
  "would",
  "should",
  "does",
  "do",
  "did",
  "must",
  "may",
  "might",
]);

/**
 * Words that start a clause of their own. An auxiliary after one of these
 * belongs to that clause rather than to the sentence, so "whether the page
 * that is linked covers this" is left for the wrapper: inverting on its "is"
 * would produce a sentence nobody wrote.
 */
const SUBORDINATORS = new Set([
  "that",
  "which",
  "who",
  "whom",
  "whose",
  "when",
  "where",
  "while",
  "because",
  "since",
  "if",
  "whether",
  "after",
  "before",
]);

/** First words worth lowercasing when they move behind a verb. Anything else may be a name. */
const FUNCTION_WORDS = new Set([
  "the",
  "a",
  "an",
  "this",
  "that",
  "these",
  "those",
  "it",
  "they",
  "we",
  "you",
  "there",
  "his",
  "her",
  "our",
  "their",
  "its",
  "any",
  "every",
  "some",
  "no",
  "nothing",
  "someone",
  "somebody",
  "anyone",
  "most",
  "many",
  "both",
  "each",
]);

const QUESTION_WORDS = new Set([
  "what",
  "why",
  "how",
  "which",
  "when",
  "who",
  "whom",
  "whose",
  "where",
]);

/** How far into a clause an auxiliary can sit and still be the sentence's own. */
const MAX_SUBJECT_WORDS = 7;

/** Nothing shorter than this is a question; it is a fragment somebody left behind. */
const MIN_QUESTION_WORDS = 3;

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Lowercase a leading function word, and leave anything that could be a name alone. */
function openClause(clause: string): string {
  const [first, ...rest] = clause.split(" ");
  if (!first) return clause;
  return FUNCTION_WORDS.has(first.toLowerCase())
    ? [first.toLowerCase(), ...rest].join(" ")
    : clause;
}

function withoutTrailingStop(text: string): string {
  return text.replace(/[.!;:,]+$/, "").trim();
}

/**
 * Move the auxiliary in front of its subject, the way English asks a question.
 * Null when the clause has no auxiliary of its own, which is where the
 * wrappers below take over rather than guessing at do-support.
 */
function inverted(clause: string): string | null {
  const words = clause.split(" ");
  const limit = Math.min(words.length - 1, MAX_SUBJECT_WORDS);

  for (let index = 1; index <= limit; index += 1) {
    const word = (words[index] as string).toLowerCase();
    if (SUBORDINATORS.has(word)) return null;
    if (!AUXILIARIES.has(word)) continue;

    const subject = words.slice(0, index).join(" ");
    const rest = words.slice(index + 1).join(" ");
    if (!subject || !rest) return null;
    return `${capitalize(word)} ${openClause(subject)} ${rest}?`;
  }
  return null;
}

/** One statement, as the question it was standing in for. */
function ask(statement: string): string {
  const body = withoutTrailingStop(statement);
  if (!body) return statement;

  const words = body.split(" ");
  const first = (words[0] as string).toLowerCase();

  // "Whether X" and "It is unclear whether X" are the shapes a model reaches
  // for when it means to ask something, so they are the ones worth inverting.
  const hedged = body.match(
    /^(?:it (?:is|'s) )?(?:unclear|unknown|not clear|an open question|uncertain)\s+(?:whether|if)\s+(.+)$/i,
  );
  const clause = hedged?.[1] ?? (first === "whether" ? words.slice(1).join(" ") : null);
  if (clause) return inverted(clause) ?? `Do we know whether ${openClause(clause)}?`;

  if (QUESTION_WORDS.has(first)) {
    // "What does Mixpanel charge" is already a question missing its mark;
    // "What Mixpanel charges" is a noun phrase and needs asking about.
    const second = (words[1] ?? "").toLowerCase();
    return AUXILIARIES.has(second)
      ? `${body}?`
      : `Do we know ${[first, ...words.slice(1)].join(" ")}?`;
  }

  return inverted(body) ?? `Can someone check: ${openClause(body)}?`;
}

/**
 * One open question, question-shaped. Null for a fragment too short to be
 * asking anything, which is the only thing here that is dropped rather than
 * rewritten.
 *
 * A question buried behind its own context is moved to the front instead of
 * being wrapped in a second one: the first line is what a reader scans.
 */
export function asQuestion(raw: string): string | null {
  const text = collapseWhitespace(raw);
  if (!text || text.split(" ").length < MIN_QUESTION_WORDS) return null;

  const parts = sentences(text);
  const lead = parts[0];
  if (!lead) return null;
  if (lead.endsWith("?")) return parts.join(" ");

  const asked = parts.findIndex((part) => part.endsWith("?"));
  if (asked > 0) {
    return [parts[asked], ...parts.filter((_, index) => index !== asked)].join(" ");
  }

  return [ask(lead), ...parts.slice(1)].join(" ");
}

/** A whole "Open questions" list: every item a question, and each one once. */
export function asQuestions(items: string[]): string[] {
  const seen = new Set<string>();
  const questions: string[] = [];

  for (const item of items) {
    const question = asQuestion(item);
    if (!question) continue;
    const key = question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    questions.push(question);
  }
  return questions;
}
