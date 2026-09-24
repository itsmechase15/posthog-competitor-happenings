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

## Say which kind of nothing, and name the pages

Recommending nothing is a normal answer and a useful one. What makes it useful
is the specifics, so the answer is a verdict rather than a sentence: a kind that
picks the title, one sentence that names the capability that shipped and what
PostHog does about it, and the docs pages it rests on.

- **None – PostHog already does this**, for a launch PostHog ships an answer
  to. It carries one to three docs pages, each checked against the corpus like
  any other quote.
- **None – not a product gap**, for pricing, plans, company news, or something
  PostHog chose not to build. The sentence says which.
- **None – the gap could not be confirmed**, for a claim that failed a check.
  It names the check, so a reader knows this is unsettled rather than answered.
- **None – dropped on review**, in the reviewer's own words, with the pages it
  read.
- **None – not analyzed this run**, when there was no key and nobody looked.

Generic copy in that slot is the failure this replaces. "Nothing here asks
anything of PostHog" is true of most launches and tells a reader nothing: it
names no capability, no page, and it reads like a bug. So the verdict is
structured, [`renderNoAction`](../src/analysis/noAction.ts) is the only thing
that renders it, and a test greps `src/` for the old lines and fails on a hit.

"PostHog already does this" is a claim about the product, so it is held to the
gap's own bar: the page is in the corpus, it is documentation, and the quote is
on the stored copy. A verdict left with no page that passes is downgraded to
"the gap could not be confirmed" naming the one that failed, never quietly kept.

## A not-a-gap note names the piece, then stops

Most of what a competitor publishes ships nothing. The note for one of those
says what the piece is and that it is not an announcement, in two sentences:

- Good: "This is a thought leadership article about whether to install
  Amplitude's SDK or send events from a warehouse. It's not an announcement of
  a new feature or product."
- Bad: "No impact on current PostHog products."
- Also bad: "...so PostHog's Experiments product has nothing to answer."

The bad lines are true and say nothing the good one did not. The first is vague
about the piece; the other two close on PostHog in a company's voice, when
naming the piece and saying it is not an announcement already covers it. The
prompt asks for the shape, and
[`trimNotAGapReason`](../src/analysis/noAction.ts) cuts the flourish off the
end of a sentence when one comes back anyway – only from the end, and only
where the sentence survives the cut, because cutting the middle out of
somebody's sentence is rewriting it. A test greps `src/` for the flourish so
code never writes it either.

PostHog's voice rules are for copy PostHog publishes. They apply to a page
rewrite and to a drafted article, not to this note, which is the bot talking
to a colleague.

## The last detail bullet says what they are selling

`key_points` are the two to four lines under **More detail**, and they are not
four of the same thing. The lines above the last are facts: what the piece is,
who wrote it, who it is for, what it claims only their tool does, what it
concedes. Each one is a fragment under 160 characters, which is what Slack
renders a bullet to.

The last line is the so-what, and it has a different job: it says what the
competitor is selling in this piece. The product or paid layer the argument
leads to, and what a reader has to accept to buy it, written so a PostHog
marketer can see what a piece positioned against it would have to answer.

- Good: "The argument lands on their SDK as the collection layer their
  analytics platform needs on top of the warehouse: session replay, heatmaps,
  and pre-login attribution exist only if their library is on the page, so a
  warehouse-first team installs it anyway. A PostHog answer has to say which of
  those PostHog gets from warehouse sources and which of them need posthog-js."
- Bad: "Closes by pointing at their install docs and their agent."
- Also bad: "A pitch for their analytics platform."

The two bad lines name the pitch and hand a marketer nothing to write against.
The good one is a brief. It runs longer than a fragment, so it gets the room:
`MAX_SO_WHAT_CHARS` in [`src/slack/message.ts`](../src/slack/message.ts) is 400
characters for the last bullet against 160 for the ones above it, the prompt
asks for the same numbers, and `MAX_KEY_POINT_CHARS` in
[`src/analysis/schema.ts`](../src/analysis/schema.ts) holds 800 so a so-what
written a little long arrives whole instead of stopping on the clause that made
it worth reading. One rich last line beats four thin ones: three key points
whose last line is a brief are better than four whose last line is a closer.

This matters most on a piece that ships nothing, and most of all next to a
`consider_publishing` action, where the so-what is the brief the draft was
written from.

## A piece to publish is a draft, in PostHog's blog voice

Once the product answer on a piece that ships nothing is None, the analyst asks
whether PostHog publishes anything on the same angle. Where it does not, the
answer is a `consider_publishing` action, and like a page edit it carries the
words rather than a request for them: `article_title` is the working headline
and `article_draft` is the whole piece in markdown.

The voice comes from PostHog's own posts. The corpus holds them under
`pages/blog/` and `pages/tutorials/`, and `ARTICLE_RULES` in
[`src/analysis/prompt.ts`](../src/analysis/prompt.ts) has the analyst open two
or three on a nearby topic and match how they are written before it writes a
word. Every claim about PostHog in the draft comes off a docs page opened this
run, the piece is PostHog's take rather than a rebuttal of theirs, and the
style rules above apply to all of it – it is the longest string the bot writes,
so it is where the slips happen.

[`articleProblem`](../src/analysis/article.ts) is the code half: a draft that
is missing, has no headline, runs under 300 words, or opens by describing the
post is dropped as a brief. `similarPieces` in the same file searches PostHog's
own writing for the headline and the ask, then judges each candidate by its
headline: the same piece is one whose title carries half of the draft title's
distinctive words, and a how-to never covers a piece that asks a question. A
match the analysis never opened drops the action and puts a **Marketing** line
under the None naming the page. Which is why the headline matters twice: it is
what a marketer decides on, and it is what the check reads, so it says what
question the piece answers. The issue stages the draft into a real posthog.com
blog post in a headless browser and photographs it, so it reads as the post it
would be, then carries the whole draft in a fence for an editor.

## The ask above that draft is a brief, not a retelling

The `detail` on a `consider_publishing` action is what a product marketer reads
under **Recommended action**, above the draft itself, so it answers what to
write, what it argues against, and what it stands on. It is prose first and
bullets after, and the split is where the reading changes from an argument to a
checklist.

The prose lead is one or two sentences. The first names the piece and the angle
and stands alone, because Slack shows that sentence and nothing else. The
second says why PostHog can own the angle, in what PostHog actually ships, and
it names the angle again as its subject instead of pointing back at it. Then it
stops. That much reads as a recommendation somebody made, and turning it into
bullets would take the argument out of it.

Every sentence in the brief names what it is about. "this", "that", "it", "both
sides", "the two halves", and "their" are allowed only where the noun they
stand for is in the same sentence, because the reader is a marketer opening the
issue cold and a pointer back to a sentence they have not read is a pointer to
nothing. Name the competitor too.

- Bad: "PostHog can own this because it ships both sides, warehouse sources and
  the SDK." Nothing in that sentence says what "this" is, and "both sides" is
  named after it is relied on.
- Good: "PostHog can own the warehouse-versus-SDK question because it ships
  both halves: data warehouse sources and the capture API on the warehouse
  side, and posthog-js on the SDK side."

The bullets carry the rest, because the rest is a list somebody works through.
Three of them, in this order, each led by a bold label copied exactly, so
nobody needs a legend for what a bullet is:

- **Product(s) highlighted** – the PostHog products the piece features, by the
  names the docs use, in the order the draft reaches them, each with the reader
  it is for.
- **Article positioning:** what the competitor is selling in this piece, which
  is the pitch the last key point named, opening with the competitor's name;
  then the stance the draft takes on it, opening with "The draft".
- **Content outline:** the draft's beats nested under it. Three to five, one
  line each, in the draft's order.

Beats, not the draft. A paragraph retelling the whole piece is what the bullets
replace, and the piece is already in `article_draft` and under **The draft** in
the issue.

```markdown
**Consider publishing** – Publish a PostHog take on whether you need an SDK or
can send events from your warehouse – Amplitude has one and PostHog's blog has
nothing on the choice. PostHog can own the warehouse-versus-SDK question
because it ships both halves: data warehouse sources and the capture API on the
warehouse side, and posthog-js with session replay on the SDK side.

- **Product(s) highlighted** – data warehouse sources and the capture API, for
  teams that already have a pipeline; then session replay, surveys, and
  experiments, for what needs posthog-js on the page.
- **Article positioning:** Amplitude says an SDK is the one layer a warehouse
  cannot replace. The draft takes no side: the draft names what the warehouse
  answers on its own and what it does not.
- **Content outline:**
  - What warehouse sources and the capture API already answer.
  - The three things that need posthog-js on the page, and why.
  - A person join resolves at query time, so flags and experiments never see it.
  - The hybrid setup most teams land on, and when warehouse-only is right.
```

The model writes those line breaks as `\n` inside the JSON string, and
`buildIssueBody` keeps them: the label shares a line with the prose lead, and
every markdown block the detail wrote below it keeps its own blank line, so the
bullets render as bullets and the nested beats as sub-bullets rather than as a
paragraph GitHub might not break up. A `detail` of one paragraph renders
exactly as it always did.

The three labels live in `BRIEF_LABELS` in
[`src/analysis/brief.ts`](../src/analysis/brief.ts), which both prompts ask for
and `buildIssueBody` renders. An issue filed under an older prompt is
re-rendered on every review, so `normalizeBriefLabels` rewrites the labels it
was written with – `Position against:`, `Lead with:`, `Draft covers:` – into
these. It moves the label and nothing else: the words after it are the
recommendation, and a rename invents none of them.

## A length budget shortens a string, never the analysis

Every cap on what a model writes is a rendering budget: how much of a field
Slack, an issue, or a page has room for. None of them is a fact about the
reply, so none of them refuses one.

They used to. Each was a `max` in the Zod schema, so a single field over its
cap failed the parse, `analyzeItems` dropped the item, and the alert said
**None – not analyzed this run** with a restatement of the competitor's post
under it. That happened on 2026-09-23: a `consider_publishing` action whose
`detail` ran about a thousand characters against a cap of 900 cost the whole
analysis, after three minutes of reading four thousand docs pages.

Now `capText` and `capList` in
[`src/analysis/schema.ts`](../src/analysis/schema.ts) cut the string at a word
boundary, or keep the first entries of the list, and log which field was cut
and by how much. Everything else the reply said survives. The same helpers
read the reviewer's verdict and the rewrite, because a long reason should cost
a long comment rather than a skipped review.

Two things follow. The budgets are generous – `detail` is 2,000 characters,
three or four paragraphs, and a key point is 800 against the 400 the prompt
asks the last one to stay under – so a cut is a line in the log worth reading
rather than a daily event. And the prompts state them, so a reply written to the rule
is never cut at all: a model told "under 2,000 characters" writes under it, and
a model told nothing discovers the limit by losing a sentence.

The related rule: a field holds what it is for. A draft belongs in
`article_draft`, and a `consider_publishing` action whose `detail` carries a
markdown heading and a post's worth of prose after it has the draft moved
across on the way in, with what sat above it kept as the detail. Nothing is
written that the model did not write – the alternative is a truncated post
filed as a recommendation, or an action dropped for having no draft when the
reply contained one.

## Open questions are questions

The heading says "Open questions", so every line under it asks something. What
used to land there was the doubt written down as a note:

- Bad: "Whether Headless is generally available on every Mixpanel plan."
- Bad: "Whether PostHog users writing agent code want a typed Python client."
- Good: "Is Headless generally available on every Mixpanel plan, or gated to
  Enterprise?"
- Good: "Do we know whether PostHog users writing agent code want a typed
  Python client?"

The note and the question hold the same fact. Only one of them hands a reader
something to go and settle, which is the entire job of the section: a person
reads it looking for what nobody has answered yet.

A sentence of context after the question mark is welcome – the page nobody
opened, the check that failed – as long as the question leads, because the
first line is what gets scanned.

[`asQuestions`](../src/analysis/questions.ts) is the enforcement.
`SYSTEM_RULES` asks the analyst for questions, `normalizeAnalysis` shapes what
comes back, and `buildIssueBody` shapes it once more on the way out, so an
analysis stored before any of this still renders as questions. It inverts the
verb where English lets it ("whether Headless is generally available" becomes
"Is Headless generally available?"), wraps the clause where it does not ("Do we
know whether …?"), moves a buried question to the front, and drops a fragment
too short to be asking anything. The two places that add their own questions –
`gateActions` when a check drops an action, and `verifyAgainstDocs` when a gap
claim has no page behind it – write them as questions already, so the shaping
has nothing to do.

## An issue reads news, detail, ask

A GitHub issue is read by somebody who was not in the channel, so it opens the
way the news does: **What you need to know**, then **More detail**, whose last
bullet says what the competitor is selling, then **Impact**, then **Recommended
action**, which keeps whatever markdown the ask wrote under its opening line.
The ask makes sense only after the launch does, and how much the launch matters
is part of the launch. Everything the ask stands on follows it – the gap, the
teams, the docs, the open questions, the sources – in the order somebody
checking the ask would want them.

The two docs sections under it are about different days, and they say so:

- **What PostHog's docs say today** is what the recommendation was checked
  against. On a product action it is often empty, and empty is the expected
  answer rather than a broken check: PostHog documents what PostHog ships, so a
  capability PostHog does not ship has no page to cite. The copy says that, and
  points at **The gap this closes** for the page the gap itself was read off.
- **Docs that would change if this ships** is the other day. Those are the
  pages somebody rewrites after the work lands, and they are never evidence for
  it.

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

## And proportional to the page it lands on

A page that *could* carry more is not a page that *should* be edited. The
second question, after "is this page wrong?", is "how much does this page
need?", and the answer is a ratio rather than a length: what the edit adds has
to be proportional to what is already there. A page of two or three short
paragraphs takes one or two sentences. It does not take a competitive write-up.

The case that showed why was a competitor moving one of its products onto a
flat rate. The page it touched ran three short paragraphs, and the
recommendation was four more on their new tiers, their overage rules, and how
their old plan used to work. Every sentence of it was true and every existing
check passed: the page was real, the quoted line was on it, the copy was copy
rather than a note about the edit. It was simply too much, and the page it
landed on would have read as a page about them.

So it is measured. [`proportion.ts`](../src/analysis/proportion.ts) counts the
words on the stored page and the words the edit adds on top of the line it
replaces, and an edit may add a fifth of the page's own length, or 60 words,
whichever is more. The floor is there so a short page can still take the one
honest sentence it sometimes needs; the ratio is there so a long page can take
a paragraph. Over the line, `checkPageEdit` drops the action like any other
failed check, and the open question says what a shorter edit would be worth.

Nothing shortens the copy on its own. Picking which two of somebody's four
sentences survive is writing the recommendation rather than checking it, which
is the same reason no failed evidence check is ever turned into a correction.
What can ask for the short version is the review pass: the reviewer is shown
how long the page is and how much the copy adds to it, and "this is three times
the page" is a revise asking for two sentences, or a drop when there is no
short version worth making.

The prompts carry the same rule in the same numbers, so copy written to the
rule passes the check rather than discovering it: `PAGE_REWRITE_RULES` states
it to the analyst and to the review's writer, and the `update_pages` section of
`SYSTEM_RULES` says what to cut first. Their pricing tiers, their rollout
history, and the rest of their launch post are theirs to publish. One fact,
named in the fewest words that make the point, is the edit.

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

## A rewrite is held to the same rules

Once an action's issue is open, a second model reads the docs and can ask for the
action to be revised. The rewrite that follows is copy that lands in a GitHub
issue and in Slack, so it follows everything above, and the rules it can break
are caught the same way the analyst's are.

`STYLE_RULES` and `PAGE_REWRITE_RULES` in
[`src/analysis/prompt.ts`](../src/analysis/prompt.ts) are the one statement each
of the handbook and of the rule above, and every prompt that needs them carries
them: the analysis, and the rewrite the review pass asks for. Stating them once
is the point. A reviewer that says the copy on a compare page is wrong sends the
rewrite to a model that has to be held to the same bar the analyst was, or the
review becomes a way around it.

For an `update_pages` action the rewrite **is** the copy, so the review's writer
gets `PAGE_REWRITE_RULES`, the current copy, and an excerpt of the page it is
rewriting – its voice has to come from somewhere. It writes `proposed_text` back,
and [`rewriteProblem`](../src/analysis/rewrite.ts) judges it through the same
`checkPageEdit` the analyst's copy went through. An instruction, a note about the
page, or a restatement of what the page already says is refused, the original
issue stands, and the label is `review:unconfirmed`.

What is not left to the prompt: `mergeRevision` in
[`src/review/schema.ts`](../src/review/schema.ts) drops a `feature` the product
catalog does not know rather than letting a made-up product name reach a title or
a label, refuses a type change that is not a swap between the two product
actions, refuses an impact change the reviewer did not ask for, and drops copy
for a page the analysis never cited or that marketing does not write. It does not
judge whether the copy is copy: that is `rewriteProblem`'s job, so there is one
judge of it rather than two that can disagree. Then `checkAction` in
[`src/analysis/analyze.ts`](../src/analysis/analyze.ts) runs the whole chain
again, `sanitizeCopy` included, so a rewrite reaches an issue only if it would
have been allowed to be written that way in the first place.

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
- [`proportionProblem`](../src/analysis/proportion.ts) measures what is left
  against the page it goes on, and drops the write-up that a short page cannot
  carry. It is the only check here that can fail copy nothing is wrong with.
- [`asQuestions`](../src/analysis/questions.ts) makes every open question a
  question, in `normalizeAnalysis` and again in the issue body.
- `buildIssueBody` in [`src/github/issue.ts`](../src/github/issue.ts) keeps the
  markdown an ask was written in: the action label shares a line with the lead,
  and every block the detail wrote below it – a brief's **Content outline:**
  beats, most of all – keeps a blank line of its own so it renders as one. It
  runs a brief's bullets through `normalizeBriefLabels` in
  [`src/analysis/brief.ts`](../src/analysis/brief.ts) on the way out, so a
  brief filed under an older prompt carries today's labels.
- [`enforceActionLead`](../src/analysis/lead.ts) runs last, on the actions that
  survived, and makes each one open with the work it asks for, because that
  sentence is the whole recommendation in Slack.
- [`src/analysis/noAction.ts`](../src/analysis/noAction.ts) is the one renderer
  for an alert that recommends nothing. `gateActions` reads the verdict off
  what it blocked, the reviewer's drops write their own, and Slack and the
  closed issue both render the same title, sentence, and links. Its
  `trimNotAGapReason` cuts the product flourish off a not-a-gap note on the
  way in, and its **Marketing** line carries the second answer under the
  first.
- [`src/analysis/article.ts`](../src/analysis/article.ts) judges a piece to
  publish: whether there is a draft, whether it is long enough to be one, and
  whether PostHog already published it on a page nobody opened.
- [`src/review/`](../src/review/) reviews every action after its issue is open:
  `prompt.ts` states the bar for agreeing, revising, and dropping, `schema.ts`
  bounds what a rewrite may change, and `apply.ts` re-runs the checks above on
  the result and throws away a rewrite that fails them.
- `capText` and `capList` in [`src/analysis/schema.ts`](../src/analysis/schema.ts)
  hold every model string to the budget the surfaces have room for by
  shortening it and logging, so no cap can cost an analysis.
- `sanitizeCopy` in [`src/util/text.ts`](../src/util/text.ts) rewrites em
  dashes as spaced en dashes and curly quotes as straight ones. It runs over
  every model string in `normalizeAnalysis`, and again over every Slack text
  node on the way out, so a model slip cannot ship.
- Tests in [`test/slack.test.ts`](../test/slack.test.ts) and
  [`test/analysis.test.ts`](../test/analysis.test.ts) assert the punctuation of
  the rendered message.

The prompt and the sanitizer are the two places to change when the handbook
changes.
