import { COMPETITORS } from "../config.js";
import { matchCapabilities, matchProducts } from "../posthog/products.js";
import type { Analysis, RecommendedAction, StoredItem } from "../types.js";
import { firstSentence } from "../util/text.js";

/**
 * Is a page edit about the thing that shipped?
 *
 * `update_pages` is the action that sends someone to edit posthog.com, and the
 * way it goes wrong is not a page that is fine: it is a page edit about
 * something else. A signal about scheduling an experiment stop turns into "and
 * while you are on the Amplitude compare page, answer their claim that PostHog
 * only shipped basic A/B testing in November 2025". Both sentences are about
 * Experiments, and only one is about this launch, so matching on the product
 * cannot tell them apart.
 *
 * What tells them apart is the vocabulary of the launch itself: what changed,
 * with the product it changed in taken out. "Schedule experiment stop" leaves
 * schedule and stop, which the A/B tangent never mentions.
 */

const WORD = /[a-z0-9]+/g;

/**
 * Words that appear in every competitor alert, so they discriminate nothing.
 * Stemmed at load, because the text they are compared against is.
 */
const GENERIC_WORDS = [
  "the", "and", "for", "but", "with", "from", "into", "this", "that", "these", "those",
  "when", "what", "which", "than", "then", "there", "here", "where", "while", "who",
  "you", "your", "they", "their", "them", "its", "it", "our", "we", "us",
  "are", "was", "were", "been", "being", "has", "have", "had", "does", "did",
  "can", "cannot", "could", "will", "would", "should", "must", "may", "might",
  "now", "new", "also", "just", "only", "still", "already", "yet", "not", "no",
  "all", "any", "one", "two", "more", "most", "some", "each", "every", "both",
  "let", "lets", "get", "gets", "got", "make", "makes", "made", "add", "adds", "added",
  "use", "uses", "used", "using", "say", "says", "said", "see", "sees", "need", "needs",
  "want", "wants", "give", "gives", "take", "takes", "put", "puts", "pick", "picks",
  "user", "users", "team", "teams", "customer", "customers", "people", "someone",
  "product", "products", "feature", "features", "capability", "capabilities",
  "page", "pages", "section", "sections", "line", "lines", "copy", "claim", "claims",
  "launch", "launches", "launched", "ship", "ships", "shipped", "release", "released",
  "announce", "announces", "announced", "available", "availability", "general",
  "support", "supports", "supported", "way", "ways", "thing", "things", "work", "works",
  "today", "instead", "without", "about", "because", "so", "why", "how", "same",
  "own", "out", "off", "over", "under", "before", "after", "again", "very", "much",
  "competitor", "competitors", "posthog", "compare", "comparison", "matrix", "row",
  "rows", "update", "updates", "updated", "edit", "edits", "fix", "fixes",
];

const STOPWORDS = new Set([
  ...GENERIC_WORDS,
  ...Object.values(COMPETITORS).map((competitor) => competitor.label),
].map((word) => stem(word.toLowerCase())));

/**
 * Fold a word to a stem crude enough to be predictable: schedule, schedules,
 * scheduled, and scheduling all have to land on the same token, and stopping
 * has to land on stop.
 */
export function stem(word: string): string {
  let stemmed = word;
  if (stemmed.length > 4 && stemmed.endsWith("ies")) {
    stemmed = `${stemmed.slice(0, -3)}y`;
  }
  for (const suffix of ["ing", "ed", "es", "s", "e"]) {
    if (stemmed.length > 4 && stemmed.endsWith(suffix)) {
      stemmed = stemmed.slice(0, -suffix.length);
      break;
    }
  }
  // "stopping" and "shipped" lose a doubled consonant that "stop" never had.
  return stemmed.replace(/([bdgklmnprt])\1$/, "$1");
}

/** Text as a space-padded run of stems, so a term can be matched whole. */
function stemmed(text: string): string {
  return ` ${(text.toLowerCase().match(WORD) ?? []).map(stem).join(" ")} `;
}

function isDiscriminating(token: string): boolean {
  return token.length >= 3 && !/^\d+$/.test(token) && !STOPWORDS.has(token);
}

/**
 * What one signal is about, in three tiers, sharpest first.
 *
 * `terms` and `phrases` are the launch. `productPhrases` is only the product
 * it happened in, which is too broad to judge a page edit by and is used only
 * when the launch left nothing sharper behind.
 */
export interface SignalTopic {
  /** Stems from the title and summary, minus the product's own vocabulary. */
  terms: string[];
  /** Stemmed keywords of the cross-product capabilities the signal touches. */
  phrases: string[];
  /** The PostHog products the signal is about, for the log line. */
  products: string[];
  /** Stemmed product vocabulary, the last resort. */
  productPhrases: string[];
}

/**
 * The topic of a signal, read from the title and the one-sentence summary.
 * Those two are the launch; key points and action details are commentary on
 * it, and letting them in would let a tangent widen the topic to cover itself.
 */
export function signalTopic(title: string, summary: string): SignalTopic {
  const text = `${title}. ${summary}`;
  const products = matchProducts(text, 3);
  const capabilities = matchCapabilities(text);

  const productVocabulary = products.flatMap((product) => [
    product.label,
    ...(product.aliases ?? []),
    ...product.keywords,
  ]);
  const productStems = new Set(
    productVocabulary.flatMap((entry) => (entry.toLowerCase().match(WORD) ?? []).map(stem)),
  );

  const terms = [
    ...new Set(
      (text.toLowerCase().match(WORD) ?? [])
        .map(stem)
        .filter((token) => isDiscriminating(token) && !productStems.has(token)),
    ),
  ];

  return {
    terms,
    phrases: [
      ...new Set(capabilities.flatMap((capability) => capability.keywords).map(stemPhrase)),
    ],
    products: products.map((product) => product.label),
    productPhrases: [...new Set(productVocabulary.map(stemPhrase))].filter(Boolean),
  };
}

function stemPhrase(phrase: string): string {
  return stemmed(phrase).trim();
}

/**
 * Does this text speak to the launch? A capability the signal is about counts,
 * and so does any word the launch used that the product did not. When the
 * launch is the product itself – "Mixpanel ships session replay" leaves no
 * word behind once session and replay are the product's own – the product is
 * all there is to match on, so it is what gets matched.
 */
export function tiesToTopic(text: string, topic: SignalTopic): boolean {
  const haystack = stemmed(text);
  const hits = (needles: string[]): boolean =>
    needles.some((needle) => needle.length > 0 && haystack.includes(` ${needle} `));

  if (hits(topic.phrases) || hits(topic.terms)) return true;
  if (topic.phrases.length > 0 || topic.terms.length > 0) return false;
  // Nothing sharper exists, so an unjudgeable topic keeps the action rather
  // than dropping every page edit a signal like this could ever ask for.
  return topic.productPhrases.length === 0 || hits(topic.productPhrases);
}

/** How the log line names the topic an action missed. */
export function describeTopic(topic: SignalTopic): string {
  const named = topic.terms.slice(0, 4);
  if (named.length > 0) return named.join(", ");
  return topic.products.join(", ") || "this launch";
}

export interface TopicGuard {
  analysis: Analysis;
  /** What was dropped and why, for the run log. Empty when the model stayed on topic. */
  notes: string[];
}

/**
 * Drop `update_pages` actions that are not about this launch.
 *
 * A launch is not a licence to fix everything on the page it touches. Pricing,
 * an old A/B testing claim, a holdouts row: each may well be worth an edit, and
 * none of them is what this signal found, so a reader who opens the issue gets
 * work that has nothing to do with the alert they were reading.
 *
 * Dropping beats rewriting. There is no way to rewrite "answer their claim
 * about basic A/B testing" into a page edit about scheduling without inventing
 * the edit, and an alert with one honest action reads better than one with two
 * where the reader has to work out which to trust. An alert can end up with no
 * action at all, which is the right answer for a small lifecycle control no
 * PostHog page speaks to.
 */
export function enforceUpdatePagesTopic(analysis: Analysis, item: StoredItem): TopicGuard {
  const pageActions = analysis.actions.filter((action) => action.type === "update_pages");
  if (pageActions.length === 0) return { analysis, notes: [] };

  const topic = signalTopic(item.title, analysis.summary);
  const notes: string[] = [];
  const actions = analysis.actions.filter((action) => {
    if (action.type !== "update_pages") return true;
    if (tiesToTopic(actionText(analysis, action, pageActions.length), topic)) return true;
    notes.push(
      `dropped an update_pages action that is not about ${describeTopic(topic)}: "${firstSentence(action.detail, 120)}"`,
    );
    return false;
  });

  if (actions.length === analysis.actions.length) return { analysis, notes: [] };

  const openQuestions = [...analysis.openQuestions];
  if (actions.length === 0 && openQuestions.length < 3) {
    openQuestions.push(
      `No PostHog page in context is wrong or understated because of this, so this alert asks for no page edit. Worth checking whether any PostHog page should cover ${describeTopic(topic)} at all.`,
    );
  }

  return { analysis: { ...analysis, actions, openQuestions }, notes };
}

/**
 * The words one page action is judged on: its own detail, plus the suggested
 * edits when it is the only page action in the analysis. Suggested edits live
 * on `posthog_refs`, not on the action, so with two page actions there is no
 * telling which edit belongs to which, and only the detail is safe to read.
 */
function actionText(analysis: Analysis, action: RecommendedAction, pageActions: number): string {
  if (pageActions > 1) return action.detail;
  const edits = analysis.posthogRefs
    .map((ref) => ref.suggestedEdit)
    .filter((edit): edit is string => Boolean(edit));
  return [action.detail, ...edits].join(" ");
}
