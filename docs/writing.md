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
honest gap is that experiments stop by hand, not that "PostHog cannot schedule
anything". When the docs in context do not settle it, the doubt goes in
`open_questions` instead of becoming an invented gap. Impact does not move for
it: it is rated on what the competitor shipped, not on what could be checked on
PostHog's side. See [How impact is rated](#how-impact-is-rated).

## How impact is rated

Impact answers one question: what did this post ship?

- **Minor** – a post with no new feature and no enhancement in it. Company
  news, culture, hiring, pricing copy, a recap of things already shipped.
- **Notable** – an enhancement of a feature they already had. A new option,
  setting, or control on it, scheduling, a raised limit, a new platform for it.
- **Major** – a brand-new feature they did not have before, including anything
  that opens a new product surface for them.

Rate the post on the strongest thing it ships. A brand-new feature wrapped in
recap copy is major, and an enhancement wrapped in recap copy is notable, so
fluff never pulls the label down. Nothing else moves it: not how strategic the
launch feels, not whether PostHog has a gap here, not how loudly it was written
up.

Worked examples. Amplitude scheduling an experiment stop is notable, because
Experiments already existed and this is a new control on it. Mixpanel serving
events through a customer's own domain is major, because they had no such
capability before. A post about a new office is minor.

`SYSTEM_RULES` in [`src/analysis/prompt.ts`](../src/analysis/prompt.ts) states
the rule to the model, `IMPACT_MEANING` in
[`src/labels.ts`](../src/labels.ts) is the one-line version the GitHub issue
prints next to each level, and `impactOf` in
[`src/analysis/fallback.ts`](../src/analysis/fallback.ts) approximates it for a
run with no `CURSOR_API_KEY`.

## Lead an action with the work

Slack shows the first sentence of an action and nothing else, under the bold
action title. That sentence is the recommendation, so it says what to do.

For `consider_enhancing` and `consider_building`, name the change first and the
gap second:

- Good: "Add a scheduled end time on experiments so a test can stop on its own
  – flags already schedule changes, experiments stop by hand."
- Bad: "PostHog schedules flag changes, but an experiment still has to be
  stopped by hand."

The bad line is true, and as evidence it belongs in the issue. As the only line
a reader sees, it says what PostHog does not do and leaves them to work out
what is being asked for.

For `update_pages` and `new_compare_page`, name the page and the update:

- Good: "On the PostHog vs Amplitude experiments compare, say Amplitude can
  schedule an experiment stop and PostHog stops by hand."
- Bad: "The compare page is out of date."

The bad line names no page, so nobody can open it. `posthog_refs` carries the
URL and the suggested edit, but Slack does not show refs.

[`enforceActionLead`](../src/analysis/lead.ts) is the backstop. When a product
action opens with the gap it puts the ask in front of it, and when a page
action opens without naming a page it leads with the cited page and its
suggested edit. It only reorders what the model already wrote.

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

## A page edit carries the words to put on the page

"Update the pricing section to mention scheduled stops" is not a page edit. It
is a request for one, and it hands whoever opens the issue the reading of the
page, the writing, and the guess at what voice the page is in. The analyst had
the page open. The analyst writes the copy.

So every `update_pages` action carries `proposed_text` on the ref for the page
it fixes: the exact words that should sit there, ready to paste. `claim` is
what the page says today, quoted and checked against the stored copy;
`proposed_text` is what should say it instead.

- Good: "Amplitude schedules an experiment to stop on a date you pick. PostHog
  experiments stop when you stop them, so a fixed-length test needs someone to
  end it."
- Bad: "Mention that Amplitude now schedules stops."
- Also bad: "This section should say Amplitude schedules stops now."

The second and third are notes about the edit. The first is the edit. It also
matches the page it goes on – same voice, same sentence length, same names for
things – because copy that reads as if it came from somewhere else is a rewrite
somebody has to rewrite. `suggested_edit` stays the one line saying what is
wrong, which the issue prints under the rewrite as the reason for it.

[`rewriteProblem`](../src/analysis/rewrite.ts) is what tells the two apart, and
[`checkPageEdit`](../src/analysis/evidence.ts) will not file an action whose
rewrite fails it. It rejects copy that opens on an editing verb, copy that
talks about "this page" or what the copy "should say", copy too short to stand
where a paragraph stands, marketing filler the style guide rules out, and copy
the page already carries. A failed check drops the action into an open question
like every other failed check: there is no writing the copy for a page we could
not read.

The GitHub issue prints the pair – **On the page today**, then **Replace it
with** – so the edit is a decision rather than an assignment. Slack shows the
first 200 characters under the page name and leaves the rest to the issue.

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
fine. And a notable or major impact buys nothing here: impact says what the
competitor shipped, not that a PostHog page is wrong, and plenty of real
launches are `consider_enhancing` or `consider_building` only.

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
- [`rewriteProblem`](../src/analysis/rewrite.ts) decides whether an
  `update_pages` action came back with the copy for the page or with another
  instruction, and `checkPageEdit` in
  [`src/analysis/evidence.ts`](../src/analysis/evidence.ts) drops the ones that
  did not.
- [`enforceActionLead`](../src/analysis/lead.ts) runs last, on the actions that
  survived, and makes each one open with the work it asks for, because that
  sentence is the whole recommendation in Slack.
- `sanitizeCopy` in [`src/util/text.ts`](../src/util/text.ts) rewrites em
  dashes as spaced en dashes and curly quotes as straight ones. It runs over
  every model string in `normalizeAnalysis`, and again over every Slack text
  node on the way out, so a model slip cannot ship.
- Tests in [`test/slack.test.ts`](../test/slack.test.ts) and
  [`test/analysis.test.ts`](../test/analysis.test.ts) assert the punctuation of
  the rendered message.

The prompt and the sanitizer are the two places to change when the handbook
changes.
