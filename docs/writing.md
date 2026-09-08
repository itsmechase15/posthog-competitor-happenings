# How this bot writes

Every string this bot posts is PostHog copy, so it follows the handbook. These
two pages are the standing constraints, and they win over anything here:

- [Docs style guide](https://posthog.com/handbook/wizard-and-docs/docs-style-guide)
- [Tone of voice](https://posthog.com/handbook/brand/tone)

What that means for a Slack alert, which is short and read at a glance:

- Write like a smart friend explaining what happened, not a company trying to
  impress. Clear beats clever.
- Address the reader as "you". Active voice, present tense, concise.
  Contractions are fine.
- No em dash. When a line needs a dash, it is an en dash with a space either
  side: `PostHog experiments stop manually – there is no end time`. A hyphen is
  not a dash.
- Oxford comma, American English spelling, straight quotes and apostrophes.
- No "simply", "just", "easily", "obviously", "of course", or "clearly".
- No hedging: helps you to, empowers, enables you to unlock, leverage,
  streamline, robust, best-in-class, holistic, seamless, synergy.
- Simple words. Use, not utilize. Explain jargon or drop it.
- No emojis in prose. The impact dot is a label, not prose, so it stays.

## Check the docs before recommending anything

A recommendation is a claim about what PostHog ships, so it is checked against
the product docs before it is written, not after someone reads it in Slack.
Before any `consider_enhancing`, `consider_building`, or `update_pages` action,
the canonical docs for the products the signal touches go in the prompt, and an
action may only say PostHog cannot do something when a docs excerpt in front of
the model shows that gap. Compare pages are marketing copy written on a past
date, so a thin blurb, or its silence, proves nothing about the product today.
When the docs show an adjacent capability, the action says so and recommends
only the part that is genuinely missing: Amplitude scheduling an experiment
stop meets [scheduled flag
changes](https://posthog.com/docs/feature-flags/scheduled-flag-changes) and
[manual experiment
lifecycle](https://posthog.com/docs/experiments/managing-lifecycle), so the
honest line is "PostHog schedules flag changes, but an experiment still has to
be stopped by hand", not "PostHog cannot schedule anything". When the docs in
context do not settle it, the action drops to `update_pages` or a lower impact
and the doubt goes in `open_questions` instead of becoming an invented gap.

## Where this is enforced

- [`src/analysis/prompt.ts`](../src/analysis/prompt.ts) states the rules to the
  model, with both handbook URLs, so the copy is right when it is written.
- [`src/posthog/products.ts`](../src/posthog/products.ts) holds the canonical
  docs URL per product, and [`src/posthog/docs.ts`](../src/posthog/docs.ts)
  puts the relevant ones in the prompt.
- [`verifyAgainstDocs`](../src/analysis/verify.ts) reconciles the reply with
  those docs: a `consider_building` the docs contradict becomes
  `consider_enhancing` against the product that already exists, and a gap claim
  with no docs page behind it gets one, or an open question saying it was never
  verified.
- `sanitizeCopy` in [`src/util/text.ts`](../src/util/text.ts) rewrites em
  dashes as spaced en dashes and curly quotes as straight ones. It runs over
  every model string in `normalizeAnalysis`, and again over every Slack text
  node on the way out, so a model slip cannot ship.
- Tests in [`test/slack.test.ts`](../test/slack.test.ts) and
  [`test/analysis.test.ts`](../test/analysis.test.ts) assert the punctuation of
  the rendered message.

The prompt and the sanitizer are the two places to change when the handbook
changes.
