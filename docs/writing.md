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
context do not settle it, the action keeps a lower impact and the doubt goes in
`open_questions` instead of becoming an invented gap.

## Only ask for a page edit when the page is wrong

`update_pages` sends someone to edit PostHog's marketing, product marketing, or
compare pages, so it needs a reason a reader can act on. One of these has to
hold, and the action says which:

1. The page is now wrong or misleading. It says the competitor cannot do
   something they now do, or claims a parity or an advantage this launch
   breaks.
2. PostHog has an adjacent capability the docs confirm, and the page
   understates it or reads as if PostHog does not have it.
3. The competitor's own compare page claims PostHog does not do something
   PostHog does do, and PostHog's page does not answer that claim.

"Customers might ask about this", a feature matrix with no row for it, and "the
page could be stronger" are not page errors, and they are the ones that used to
fill the action up. When nothing in context is wrong, understated, or
contradicted, `update_pages` is left out and the other actions carry the alert.
It is also not the fallback for a gap the docs could not settle: an unverified
gap is an open question, not a page edit.

## And only about the thing that shipped

All three reasons are about *this* launch. A launch is not a licence to fix the
rest of the page it touches, so a page edit has to be about the competitor
product update in the signal that found it.

Amplitude shipping a scheduled experiment stop is the case that showed why.
"On the PostHog versus Amplitude experiments section, answer their claim that
PostHog only launched basic A/B testing in November 2025" is a fair thing to
want and the wrong thing to put in that alert: it is about A/B testing
maturity, not about stopping an experiment on a schedule. Pricing, holdouts,
and a matrix row on some other capability go the same way. Same page, different
topic, and whoever opens the issue gets work that has nothing to do with the
alert they were reading.

Two things follow. A small launch often needs no page edit at all – unless a
PostHog compare or docs page already discusses the capability, or claims
something this launch makes wrong, silence about a small lifecycle control is
fine. And a notable or major impact buys nothing here: plenty of real launches
are `consider_enhancing` or `consider_building` only.

[`enforceUpdatePagesTopic`](../src/analysis/relevance.ts) enforces it after the
model replies. It reads the topic out of the signal title and the summary the
model just wrote, takes out the product's own vocabulary – both the launch and
the tangent are "about Experiments", so the product cannot tell them apart –
and keeps what is left: schedule, stop, end date. A page action whose detail
and suggested edit never touch that vocabulary is dropped, not rewritten, and
an alert can end up with no action at all.

Reason 3 needs their copy in front of the model, so
[`src/competitor/compare.ts`](../src/competitor/compare.ts) reads the
`comparePages` in [`src/config.ts`](../src/config.ts) once per competitor per
run – today https://amplitude.com/compare/posthog and
https://mixpanel.com/compare/posthog – and quotes what they say about PostHog.
That is their sales copy, so it never settles what PostHog ships. The docs do.

## Where this is enforced

- [`src/analysis/prompt.ts`](../src/analysis/prompt.ts) states the rules to the
  model, with both handbook URLs, so the copy is right when it is written.
- [`src/posthog/products.ts`](../src/posthog/products.ts) is the one place that
  knows PostHog's products: their names, the page an action title links, and
  the docs a recommendation is checked against.
  [`src/posthog/docs.ts`](../src/posthog/docs.ts) puts the relevant docs in the
  prompt.
- [`src/competitor/compare.ts`](../src/competitor/compare.ts) reads the
  competitors' own comparison pages, so a claim that PostHog does not do
  something can be answered rather than guessed at.
- [`verifyAgainstDocs`](../src/analysis/verify.ts) reconciles the reply with
  those docs: a `consider_building` the docs contradict becomes
  `consider_enhancing` against the product that already exists, and a gap claim
  with no docs page behind it gets one, or an open question saying it was never
  verified.
- [`enforceUpdatePagesTopic`](../src/analysis/relevance.ts) runs next and drops
  a page edit that is not about the launch. It only ever removes an
  `update_pages` action: the other three types are left exactly as written.
- `sanitizeCopy` in [`src/util/text.ts`](../src/util/text.ts) rewrites em
  dashes as spaced en dashes and curly quotes as straight ones. It runs over
  every model string in `normalizeAnalysis`, and again over every Slack text
  node on the way out, so a model slip cannot ship.
- Tests in [`test/slack.test.ts`](../test/slack.test.ts) and
  [`test/analysis.test.ts`](../test/analysis.test.ts) assert the punctuation of
  the rendered message.

The prompt and the sanitizer are the two places to change when the handbook
changes.
