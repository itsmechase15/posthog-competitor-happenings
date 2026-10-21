# posthog-competitor-happenings

Daily Slack alerts when Mixpanel or Amplitude ships something, with what PostHog should do about it.

## Goal
Help PostHog marketing stay current on Mixpanel + Amplitude product moves. Success = people love getting the Slack messages and feel productive (not annoyed).

## Phase 1 (v1 daily ~7am PT)

### Sources
- Changelog RSS:
  - Amplitude: https://amplitude.com/releases/feed.xml
  - Mixpanel: https://docs.mixpanel.com/changelogs/rss.xml
- Blog / launch articles via sitemap diff for both competitors
- Newsletters via an AgentMail inbox (`AGENTMAIL_INBOX_ID`, optional until subscribed)
- Official X: `@mixpanel` and `@Amplitude_HQ` (last ~10 posts/day)

### Out of v1 daily flow
- Webinars/events, status/SDK feeds, LinkedIn, web UI, weekly digest, auto page edits
- PRs for page edits (Phase 3)

### The docs corpus
The `pages` table is the source of truth for what PostHog documents. It holds
around 3,800 pages: the prose under `/docs`, the compare pages, the product
marketing pages, the blog, the tutorials, and PostHog's own changelog. The
generated reference is left out – `/docs/api`, `/docs/open-api-spec`, and
`/docs/references` are 2,800 pages of one-per-endpoint and one-per-type stubs
that establish nothing about what the product does and skew a lexical index by
their sheer number.

Discovery is the union of the sitemap, `llms.txt`, the links the pages already
held carry, and the catalog, which pins the overview pages the bot routes to.
No single input decides what the corpus contains: a sitemap lags a launch, and
`llms.txt` is a subset curated for somebody else's purpose. In practice the
sitemap lists 13,100 URLs and `llms.txt` names 3,700, and the two overlap
partly – neither is a superset of the other.

Freshness is a content hash in two tiers: a page an analyst read in the last
three days is re-read every three days, the rest every fortnight, and a URL the
corpus has never held is read the run it turns up. Conditional requests keep
that affordable – posthog.com answers `If-None-Match` with a 304 and no body,
so a steady-state run costs round trips rather than downloads. A URL no source
has offered for two runs is retired, and so is one answering 404 or 410.

PostHog's own changelog is indexed as its own kind of evidence: proof something
shipped, and no proof at all that it is documented. PostHog ships several
things a week and the docs lag, so an analyst that cannot tell those apart will
either invent a gap or wave one away.

Pages that mention Mixpanel or Amplitude still have their claims extracted, for
the URL + claim a page action needs. The rewrite that goes with it is written
against the stored page, which is the same copy the check runs on.

The catalog is now a route into the corpus rather than the boundary of it. It
does three jobs: naming (a model writes "A/B testing", an issue has to say
"Experiments"), routing (an action names a product, the product names the pages
a correction should cite), and boosting (an overview page outranks a guide that
uses the same words). It tracks the Tools section of
[posthog.com/platform.md](https://posthog.com/platform.md), plus the platform
surfaces that sit under all of them and still get shipped against by name:
[Advanced / proxy](https://posthog.com/docs/advanced/proxy) is the one that
keeps coming up, because Mixpanel calls it First-Party Domains and nobody calls
it a reverse proxy. A product missing from the catalog used to be a
recommendation with nothing to check it against, which is how "PostHog has no
managed reverse proxy" gets shipped when PostHog has run one for years; now it
is a recommendation nobody gave a nickname, and the coverage gate still reads
the docs for it. Renamed products keep their old names as aliases, so a model
writing "LLM analytics" still lands on AI observability.

### One analyst run, with the corpus under it
Every run writes the corpus to `.docs-workspace/` as markdown, one file per
page plus a table of contents, and the analyst gets read-only tools over it:
read, grep, glob, list. A BM25 search pre-loads the ten best excerpts for the
launch, capped at four per docs section. The files it opens are recorded from
its own tool calls, not from its account of itself.

The full page list is 540KB, far too much for a prompt, so the prompt carries
the corpus as its sections and their sizes and tells the analyst to grep the
full list on disk. That still answers the question the list is there for – is
there a part of the docs about this at all – which is the difference between
"PostHog has no consent controls" and "there is a privacy section, let me read
it".

There is no second model pass that reads the first reply and corrects it. A
model shown its own unsupported claim argues for it better rather than going to
check.

### Verify before recommending
Every recommendation is a claim about what PostHog ships, so every product
action carries its evidence and every part of it is checked against the stored
corpus: the gap in one line, the docs page it was read off, and a quote from
that page. The page has to be in the corpus, it has to be product documentation
rather than marketing copy or a changelog entry, and the quote has to be on the
stored copy.

Then the corpus is searched again with the gap's own words, and the action is
dropped when the docs answer it on a page the analysis never opened. That is
the check the others cannot do: every other check asks whether the evidence
offered is real, and this one asks whether it was the relevant evidence.

Where the docs show an adjacent capability the action says so and recommends
only the real gap: Amplitude scheduling an experiment stop meets
[scheduled flag changes](https://posthog.com/docs/feature-flags/scheduled-flag-changes)
and [manual experiment lifecycle](https://posthog.com/docs/experiments/managing-lifecycle),
so the honest gap is "flags schedule, experiments still stop by hand".

Pricing and packaging are not capability gaps, "document this" is not an
action, and a compare page PostHog already publishes is not one to write.
Anything that fails becomes an open question and opens no GitHub issue – a
failed check is never a correction, because there is no way to rewrite a claim
whose basis we cannot find without inventing one. Impact does not move for it:
impact is about what the competitor shipped, not about what could be checked on
PostHog's side.

### Review every action once
The gate above drops what it cannot check. It cannot catch the other failure: a
recommendation whose evidence is real, whose quote is on the page, and which is
still wrong about what PostHog ships – because the page it read was not the page
that answers it, or because the gap sentence claims more than the quote carries.
Only reading more of the docs catches that.

So once an action's GitHub issue is open, a **different model** reads the same
corpus and returns one of three verdicts:

- **agree** – it stands. A comment says who reviewed it, why, and which pages
  they opened, and the issue gets `review:agreed`. The body is untouched
- **revise** – there is real work here and part of what was written is wrong in
  a fixable way. The analyst's own model rewrites that one action, text-only,
  from the reviewer's list of changes and the pages either model read. On a
  product action the rewrite may change the detail, the gap, the evidence page,
  the quote, and the feature; on an `update_pages` action it rewrites
  `proposed_text`, the copy that goes on the page, and gets an excerpt of that
  page so the voice comes from the page rather than from the model. Impact moves
  only when the reviewer said the label is wrong, and the type only between
  `consider_building` and `consider_enhancing`, never into `update_pages` or
  `new_compare_page`. Then the whole evidence chain runs again on the result –
  `verifyAgainstDocs`, `enforcePageTargets`, `enforceUpdatePagesTopic`,
  `gateActions`, `enforceActionLead` – with coverage counted as the analyst's
  reads plus the reviewer's. That chain includes `rewriteProblem`, so a rewritten
  page edit has to be copy rather than a note about copy on exactly the terms the
  analyst's did. A rewrite that survives is PATCHed onto the issue with a
  recomputed title and labels and a before/after comment, and gets
  `review:revised`. One that does not is thrown away: the original issue stands,
  the comment says what the reviewer wanted and why the rewrite could not be
  confirmed, and the label is `review:unconfirmed`. There is no second attempt,
  because a claim we cannot check cannot be corrected without inventing the
  correction
- **drop** – PostHog already does this, and the reviewer can name the pages that
  show it. The issue is closed as not planned with `review:dropped`, and the
  action is left out of the Slack alert

This is not the guess-then-fix pass the analyst deliberately does not have. That
pass shows one model its own claim and asks it to check itself, which buys a
better-argued guess. This is a different model, shown somebody else's claim, with
the corpus underneath it, and the result re-checked by code rather than by
another model, once. Take away any one of those and it is the forbidden pass.

Where it sits matters as much as what it does. It runs **after** the issues are
opened, so a verdict has somewhere to write itself and the whole exchange lives
in the issue's own history, and **before** the Slack post, so a dropped action is
simply absent from the message. Slack is never edited after it goes out. An alert
whose every action was dropped shows **None – dropped on review** with the
reviewer's own reasons and the pages it read, and the closed issue carries the
same verdict as an `## Outcome` section above its body.

It runs once per action, four ways over: the review is a function call after
create rather than an `issues: opened` workflow, an edit never calls the
reviewer, every verdict stamps the issue `review-pass:done` in the same PATCH
that carries its own label and the entry point refuses an issue carrying it, and
the verdict is stored on the analysis row as
`analysis.issues[i].review = { verdict, model, at, reason }` so a retry of a post
that failed finds it already done.

Cost is one reviewer run per filed action and one rewrite per action that needed
correcting. `REVIEW_MAX_PER_RUN` caps it at 12 for the whole run; past that an
action is filed as written with `review:skipped`. A `REVIEW_MODEL` the Cursor SDK
turns down lands in the same place: skipped, labelled, and the analyst's version
filed. A dry run reviews and rewrites and writes nothing, so the payload shows
what the alert would say and the log shows what the issue edits would have been.

### Analysis
- Cursor SDK, model `claude-opus-5`
- Impact `minor | notable | major` = **label only** (not a post gate – every new signal can Slack)
- Impact is decided by one question: what did the post ship?
  - **major** – a brand-new feature the competitor did not have before, including anything that opens a new product surface for them
  - **notable** – an enhancement of a feature they already had: a new option, setting, or control, scheduling, a raised limit, a new platform for it, polish
  - **minor** – a published post with no new feature and no enhancement in it: company news, culture, hiring, pricing copy, recaps of things already shipped
  Rate the post on the strongest thing it ships, so a new feature wrapped in
  recap copy is still major and fluff never pulls the label down. Nothing else
  moves it: not how strategic it feels, not whether PostHog has a gap, not how
  thin the source text is. Worked examples: a scheduled experiment stop on
  Experiments they already ship is notable; first-party domains, a capability
  they never offered, is major; a post about a new office is minor
- Zero to three recommended actions, most important first. One signal often
  needs two, e.g. a stale page to fix and a feature gap to close. Zero is a
  normal answer, and it says which answer: a kind, one sentence about this
  launch, and the docs pages under it, as
  `analysis.noAction = { kind, reason, evidence }`. `already_covered` names what
  PostHog ships and carries the pages that show it, checked against the corpus
  the way a gap claim is and downgraded to `unverified` when they fail;
  `not_a_gap` is pricing or company news; `unverified` is a claim no check could
  confirm; `dropped_on_review` is the reviewer closing everything; `unanalyzed`
  is a run with no key. Rendered once, in
  [`src/analysis/noAction.ts`](./src/analysis/noAction.ts), for Slack and for
  the GitHub issue a reviewer closed. A `not_a_gap` note for a piece that
  ships nothing says what the piece is and that it is not an announcement of
  a new feature or product, and stops there: the flourish about PostHog's
  product that used to close it is cut by `trimNotAGapReason` when it comes
  back anyway. The five action types:
  - update pages (existing compare/content)
  - new compare page
  - consider building (PostHog has nothing like this)
  - consider enhancing (related feature; gap). Names the PostHog feature to
    enhance, so the line reads "Consider enhancing Experiments – ..." rather
    than a label with a vague gap after it. Enhancing means reaching parity
    with what the competitor shipped, or beating it
  - consider publishing (marketing content, not product). For a piece that
    ships nothing, once the product verdict is None: PostHog's blog,
    tutorials, and newsletter have nothing on the same angle, so here is the
    piece, drafted in PostHog's blog voice. Sits next to `noAction` rather
    than replacing it, so `noAction` is set whenever there is no *product*
    action. Where PostHog already covers the angle, the None carries
    `noAction.marketing` naming the page instead. See
    [The marketing question](#the-marketing-question)
- Action copy focuses on the gap / why PostHog has nothing like it – not generic "why care"
- Update pages has a bar of its own. PostHog marketing, product marketing, and
  compare pages are only worth editing when one of these holds:
  1. a PostHog page is now wrong or misleading, e.g. it says the competitor
     cannot do something they now do, or claims a parity this launch breaks
  2. PostHog has an adjacent capability the docs confirm, and the page
     understates it or reads as if PostHog does not have it
  3. the competitor's own compare page claims PostHog does not do something
     PostHog does do, and PostHog's page does not answer it
  "Customers might ask", a missing feature-matrix row, and "the page could be
  stronger" are not reasons. When no page is wrong, understated, or
  contradicted, update pages is left out and the other actions carry the alert
- Update pages also has to be about the competitor product update in the signal
  that found it. A launch is not a licence to fix the rest of the page it
  touches: a signal about scheduling an experiment stop does not get to ask
  someone to answer an old "basic A/B testing" claim, quote new pricing, or add
  a holdouts row. Same page, different topic. A small launch often needs no page
  edit at all, and a notable impact is not a reason for one –
  `enforceUpdatePagesTopic` in [`src/analysis/relevance.ts`](./src/analysis/relevance.ts)
  drops a page action whose detail and suggested edit never touch the launch's
  own vocabulary, which can leave an alert with no action, and that is fine
- Update pages carries the copy, not the instruction. The ref for the page it
  fixes holds `claim`, the words on the page today, and `proposed_text`, the
  exact words that should replace them, written in that page's own voice and
  ready to paste. "Update the pricing section to mention scheduled stops" is a
  job with the writing left in it, so `checkPageEdit` in
  [`src/analysis/evidence.ts`](./src/analysis/evidence.ts) will not file an
  action without a rewrite, and `rewriteProblem` in
  [`src/analysis/rewrite.ts`](./src/analysis/rewrite.ts) rejects one that opens
  on an editing verb, talks about "this page" or what the copy "should say",
  is too short to stand where a paragraph stands, uses marketing filler the
  style guide rules out, or repeats what the page already carries. The issue
  prints **On the page today** and **Replace it with** as a pair; Slack shows
  the first 200 characters under the page it goes on
- Update pages and new compare page only ever target a page marketing writes:
  a compare page, a product marketing page, a blog post, pricing. Never a
  `/docs/` page. The docs are the evidence an action is checked against, and a
  model that asks for one to be edited has turned its own evidence into the
  job. `isMarketingTarget` in [`src/posthog/pages.ts`](./src/posthog/pages.ts)
  is the rule, enforced when the page action is judged, when its Slack sentence
  is shaped, and when the issue lists the pages to update. The claims indexer
  still reads the docs, and product issues still cite them: reading a page and
  editing it are not the same permission
- A consider enhancing or consider building issue also carries **Docs that would
  change if this ships** – the docs pages that action was verified against, read
  as the pages someone has to rewrite the day PostHog does this. Nothing new is
  fetched for it
- For reason 3, the competitor's own comparison pages about PostHog go into the
  analysis context: `comparePages` in [`src/config.ts`](./src/config.ts), read
  once per competitor per run by [`src/competitor/compare.ts`](./src/competitor/compare.ts).
  Today that is https://amplitude.com/compare/posthog and
  https://mixpanel.com/compare/posthog. It is their sales copy, so it is never
  evidence about PostHog's product: the docs settle that, as above
- Copy follows the PostHog [docs style guide](https://posthog.com/handbook/wizard-and-docs/docs-style-guide)
  and [tone of voice](https://posthog.com/handbook/brand/tone). En dash with
  spaces, never an em dash. See [docs/writing.md](./docs/writing.md)
- "Severity" is gone from everything user-facing; the scale itself stays
  `minor | notable | major`. Reads still accept a `low | medium | high` reply
  or row and map it back, and the legacy `analyses.severity` column keeps
  getting the impact token so this needed no migration

### Slack
One short, pretty message per new signal, in this order and nothing else:

1. Feature image – changelog/blog image, tweet image, or a screenshot of the feature page. Never posted without one
2. **What you need to KNOW** – the one sentence on what changed, under the
   heading. No unlabeled line above it. The source hangs off the end as a link
   named for what you land on: `changelog`, `article` for anything published on
   the competitor's own site, `tweet`, `newsletter`. Same four tags in the
   footer and in the issue, and only a newsletter goes unlinked, because its
   URL is a thread in our own inbox
3. **Impact** – Minor / Notable / Major, right under the sentence. Same three
   words as before, rated by what the post shipped
4. **More detail** – a few short bullets that elaborate, clearly separate from the KNOW sentence
5. **Recommended action(s)** – a heading, then each action stacked in its own
   block: bold title on one line, one short sentence under it, then a link to
   that action's own issue ("Access GitHub issue #12"). No single issue link
   stands for the whole alert. That sentence leads with the work: the change to
   make for consider enhancing and consider building, the page and the update
   for update pages and new compare page. An update pages action adds one
   quoted line under that sentence: the start of the exact new copy, named for
   the page it goes on, with the rest in the issue
6. Small footer – competitor · source · model · source link

PostHog page citations, one-line suggested edits, and open questions are not in
Slack. They live in the issue, and so does the whole rewrite.

### GitHub issues
Moved into the daily flow from Phase 2, because Slack got short and the detail
had to go somewhere.

One issue per **recommended action**, not per alert, in this repo, opened
before the Slack post so every action has something to link. Three actions is
three issues, because marketing owns update pages and new compare page while
product owns consider building and consider enhancing.

Title is competitor + feature + the action. Each body is scoped to its own
action and reads in that order: what you need to know, more detail, then the
recommended action, then everything the action stands on – the gap, the teams,
the whole impact scale with each level's meaning next to it, the docs, open
questions, source links – and the feature image. Open questions are written as
questions, because the section exists for what somebody has to go and settle.
Marketing's issues carry the PostHog pages
to update, each photographed before and after (see below); product's carry only
the docs that back that action, without the edits or the compare-page copy. A
product issue with no docs to cite says why – PostHog has no page describing
something PostHog does not ship – rather than leaving the section looking
broken next to the docs that would change if the work lands. Neither lists the
sibling actions: each one is its own issue. Labelled by competitor, source,
impact, action, owner, and the PostHog product when the action names one. Uses the
`GITHUB_TOKEN` Actions provides; with no token the run skips issue creation and
keeps posting.

### Show a page edit, do not describe it
`update_pages` only, one pair of screenshots per page the action names. Each
section is headed with the page's title and path, one line saying what the edit
does, two shots of the page stacked – it as it reads today, then the same page
with the proposed copy in it – the same edit as a `diff`, and the replacement
copy whole in a fence somebody pastes from. Every layer stands on its own.

Taken off the live page, and publishing nothing. A headless browser opens it,
shoots the window, puts the copy into that tab's own DOM, and shoots the window
again from the same scroll offset; the tab is thrown away, no form is
submitted, and the caption under the after shot says so. The copy goes in
highlighted, because two shots of the same page of prose leave the reader
hunting for the sentence that moved, and the thumbnail is often all they see.
The highlight is in the after shot only. The line is found by
its text, folded to letters and digits the way the evidence gate folds it, in
the deepest block that holds all of it, so a redesign does not break it and a
table of contents cannot win against the prose. posthog.com hydrates after it
loads, so nothing is marked on the page until the DOM stops changing.

This replaced a card drawn from the stored corpus text. A card of a paragraph
is a text mock of a page, and the page is what somebody is being asked to edit.
The corpus is still what the claim is checked against, which happens long
before any of this; a line the live page no longer has drops the pictures and
adds one line to the issue saying the page has moved on, because that is news
the person opening it needs and there is nothing honest to photograph.

GitHub Issues renders an image from a URL and nothing else, so both PNGs are
committed to `artifacts/update-pages/<date>/` here and the body embeds their
raw URLs. Each name is a hash of the page, both sides of the edit, and the day:
a re-run the same morning reuses the pair, a run next week photographs the page
as it is then, and a rewrite gets its own pair. If one of the two will not
commit, both are dropped.

Every step gives up quietly. No browser, a page that will not load, a bot check
served instead of it, no token, a dry run, a refused commit: the issue is filed
in text, saying the same thing in words. A dry run still takes both shots to a
temp directory and logs the paths. `SKIP_PAGE_VISUALS=true` turns it off. A
revise re-photographs, because the copy is what a revise changes.

### The marketing question
The product verdict is not the last word on a piece that ships nothing. After
`no_action` says a post is thought leadership, an explainer, a practice piece,
or an event write-up, the analyst asks whether PostHog publishes anything on
the same angle, searching `/blog`, `/tutorials`, `/newsletter`, `/founders`,
and `/product-engineers` in the corpus – the newsletter and the two editorial
sections were added to the corpus for this – and answers one of three ways:
PostHog already has a similar piece (a marketing line under the None, with the
page), nothing here is worth a piece (the same line, no page), or a
`consider_publishing` action carrying `article_title` and `article_draft`.

The draft is the deliverable. The analyst opens two or three real PostHog posts
on a nearby topic first and matches how they are written, every claim about
PostHog comes off a docs page it opened this run, and the piece is PostHog's
take rather than a rebuttal. Between 300 and 1,800 words, and a draft under 300
is dropped as a brief by `articleProblem` in
[`src/analysis/article.ts`](./src/analysis/article.ts).

The gate judges the two sides apart. A piece PostHog already published, on a
page the analysis never opened, is dropped, and the None gets the marketing
line naming it – the coverage check, for content. "Already published" is
judged by headline, not by body: the page's own title has to carry at least
half of the draft title's distinctive words, and two of them, and a how-to
(`/tutorials/`, or a title opening "How to") never covers a piece that asks a
question. Same reader question, not same product area – a Django tutorial that
installs the SDK is not a piece on whether to, and the three body-search
matches that blocked the Amplitude SDK piece on 2026-09-23 are the regression
test. A
piece the analyst read past is kept, and the issue names the nearby pieces so a
marketer compares first. No block on the content side ever reaches the product
verdict, `update_pages` keeps its own bar, and impact stays what the post
shipped. Slack shows the product None first and the action under it, with the
working title quoted. The issue reads news, impact, ask, then the
draft – staged into a real posthog.com
blog post in the same headless browser the page before/after uses, with the
post's headline, body, byline, and tables of contents swapped for the draft's,
a "Proposed draft · not published" stamp above the headline, and the page
photographed a screen at a time; captioned with the post it was staged on and
that nothing was published; committed to `artifacts/consider-publishing/`; and
the whole draft in a fence under the pictures. It has to look like posthog.com,
because that is where the decision is about – a generic reading column was
tried and rejected. The review pass reviews it like any other action, the
writer returns the whole draft again on a revise, and a dropped piece becomes a
marketing line under the None.

A private channel first; a PostHog channel later. Whichever it is, the id lives
in `SLACK_CHANNEL_ID`, never in the code.

### Plan: a publishing brief a marketer reads without guessing

Status: planned, not implemented. Prompt, docs, and tests only, plus one
label constant and one rename at render time. Nothing here touches the draft,
the pictures, the More-detail so-what from #103, or the issue order from #101.

#### The problem, in Chase's words

Live issue [#104](https://github.com/itsmechase15/posthog-competitor-happenings/issues/104),
2026-09-23. The Recommended action read:

```markdown
**Consider publishing** – Publish a PostHog take on whether you need posthog-js or can send events from your warehouse, because PostHog's blog has nothing on that choice today. PostHog can own this because it ships both sides: data warehouse sources with hundreds of connectors plus the capture API, and the SDK that captures session replay, autocapture, and heatmaps.

- Position against: the pitch that a vendor SDK is the one layer a warehouse cannot replace. PostHog's version does not argue for a side. It says which questions warehouse tables answer on their own, which ones need something on the page, and why.
- Lead with: data warehouse sources and the capture API for teams that already have a pipeline, then session replay, autocapture, heatmaps, feature flags, and experiments for what needs the SDK. Use data warehouse metrics in experiments to show the two halves working together.
- Draft covers:
  - What warehouse sources and the capture API already answer, including money and entitlement data.
  - What needs the SDK on the page: replay recordings, rage and dead clicks, heatmaps, and campaign properties on first visit.
  - …
```

Two complaints, quoted:

1. "PostHog can own this because it ships both sides" – he has no idea what
   "this" refers to. Vague antecedents are banned.
2. "Lead with:" before the colon is confusing – he cannot tell if it means
   "the suggested article should open with…" or something else: products to
   feature in the pitch, the Slack headline, and so on.

The ask: make every `consider_publishing` Recommended action clear enough that
a marketer or editor opening the issue knows exactly what to do without
guessing.

#### Where the words come from

None of those strings is written by code. `SYSTEM_RULES` in
[`src/analysis/prompt.ts`](./src/analysis/prompt.ts) (the `For
consider_publishing, "detail" is the brief` rule, added in #103) gives the
model a worked example that contains, verbatim, "PostHog can own this because
it ships both sides", "Position against:", "Lead with:", and "Draft covers:".
The analyst copied the example's shape faithfully. So the fix is the example,
and the rule the example demonstrates.

What the prompt meant by each label, read off the rule itself:

| Label as filed | What the rule asked for | Why it confuses |
| --- | --- | --- |
| `Position against:` | "how PostHog should position the piece against what the competitor is selling, which is the pitch you named in the last key point" | Names neither whose pitch nor that the sentence after it is the draft's stance |
| `Lead with:` | "which PostHog products the piece leads with, by the names the docs use" | Drops both nouns. Chase's guess, "the article leads with that", was the intended reading and the label gave him no way to know |
| `Draft covers:` | "the draft, with its beats nested under that bullet" | Least ambiguous of the three, still a fragment with no article and no order |

Two more places matter, or the fix does not hold:

- The rewrite prompt in [`src/review/prompt.ts`](./src/review/prompt.ts) may
  replace `detail` on a revise (`mergeRevision` in `src/review/schema.ts`
  applies `revision.detail`), and it carries `ARTICLE_RULES` but no brief
  shape at all. A revised piece would come back in whatever shape the writer
  felt like.
- `recommendedActionSection` in [`src/github/issue.ts`](./src/github/issue.ts)
  re-renders the stored `detail` on every PATCH, including a revise of an
  issue filed under the old prompt. #104 itself is that case.

#### The rules the copy has to follow

Three rules, each stated once in the prompt and once in `docs/writing.md`, and
each with a test that greps for it.

1. **Every sentence names what it is about.** "this", "that", "it", "both
   sides", "the two halves", and "their" are allowed only when the noun they
   stand for is in the same sentence. The reader is a marketer opening the
   issue cold, so a pointer back to a sentence they may not have read is a
   pointer to nothing. The second sentence of the lead names the angle again,
   as its subject, and names the halves:
   - Bad: "PostHog can own this because it ships both sides, warehouse sources
     and the SDK."
   - Good: "PostHog can own the warehouse-versus-SDK question because it ships
     both halves: data warehouse sources and the capture API on the warehouse
     side, and posthog-js on the SDK side."
   Name the competitor too: "Amplitude says", never "their pitch".
2. **A bullet label says what the bullet is.** Three labels, fixed, bold,
   copied exactly, in this order, so nobody needs a legend:
   - `**The pitch the draft answers:**` – first sentence is what the
     competitor is selling in this piece, opening with the competitor's name
     (it is the pitch the last key point named). Second sentence is the stance
     the draft takes on it, opening with "The draft".
   - `**PostHog products the draft leads with, in order:**` – the PostHog
     products the draft features, by the names the docs use, in the order the
     draft reaches them, each with the reader it is for.
   - `**What the draft covers, in order:**` – three to five beats nested under
     it, one line each, in the draft's own order.
   The labels live in one constant so the prompt that asks for them, the
   renderer that prints them, and the tests that check them cannot drift.
3. **Slack is untouched.** The first sentence of `detail` stays the one Slack
   shows, under `MAX_ACTION_CHARS`, leading with the piece to write and the
   angle. Everything above applies from the second sentence on.

#### Before and after, on #104

Before is quoted above. After, in the new shape – the first sentence is
unchanged, so the Slack line is unchanged:

```markdown
## Recommended action
**Consider publishing** – Publish a PostHog take on whether you need posthog-js or can send events from your warehouse, because PostHog's blog has nothing on that choice today. PostHog can own the warehouse-versus-SDK question because it ships both halves: data warehouse sources with hundreds of connectors and the capture API on the warehouse side, and posthog-js, which captures session replay, autocapture, and heatmaps, on the SDK side.

- **The pitch the draft answers:** Amplitude says a vendor SDK is the one layer a warehouse cannot replace. The draft picks no side: it says which questions warehouse tables answer on their own, which need something on the page, and why.
- **PostHog products the draft leads with, in order:** data warehouse sources and the capture API, for teams that already have a pipeline; then session replay, autocapture, heatmaps, feature flags, and experiments, for what needs posthog-js on the page; then data warehouse metrics in experiments, to show the two halves working together.
- **What the draft covers, in order:**
  - What warehouse sources and the capture API already answer, including money and entitlement data.
  - What needs posthog-js on the page: replay recordings, rage and dead clicks, heatmaps, and campaign properties on first visit.
  - A person join resolves at query time, so feature flags, experiments, and surveys never see it, and warehouse properties are the fix.
  - Experiment metrics can read a warehouse table directly, so exposure stays client-side while the outcome stays in the warehouse.
  - When warehouse-only is the right call, and the hybrid setup most teams land on.
```

Read as a marketer: the second sentence says which question PostHog can own
and what the two halves are; the first bullet says whose argument the draft
is responding to and what the draft's stance is; the second says which
PostHog products the article features first; the third is the outline. No
label needs the prompt to explain it.

#### Steps, in order, each feeding the next

1. **Put the three labels in one place.** New file `src/analysis/brief.ts`,
   no imports, exporting `BRIEF_LABELS = { pitch, products, covers }` with the
   three strings above, and `LEGACY_BRIEF_LABELS` mapping `"Position
   against:"`, `"Lead with:"`, and `"Draft covers:"` onto them.
   *Why:* the prompt, the renderer, the docs test, and the fixtures all need
   the same strings, and #103 showed what happens when a label exists only
   inside a prose example. *Feeds:* steps 2, 4, and 6 import from here rather
   than retyping the labels.

2. **Restate the brief rule to the analyst, with the fixed example.** In
   `src/analysis/prompt.ts`, lift the `For consider_publishing, "detail" is
   the brief` block out of `SYSTEM_RULES` into `export const
   PUBLISHING_BRIEF_RULES`, the way `ARTICLE_RULES` and `PAGE_REWRITE_RULES`
   already are, interpolate it back where it was, and rewrite it to:

   ```text
   - For consider_publishing, "detail" is the brief a marketer acts on. It is prose first and bullets after, with the line breaks written as \n inside the JSON string. The piece itself goes in "article_draft" and never in "detail", which is neither long enough to hold it nor where anything looks for it.
     1. A prose lead of one or two sentences, with no bullets in it. The first names the piece to write and the angle, and stands alone, because Slack shows that sentence and nothing else. The second says why PostHog can own the angle, in what PostHog actually ships, and it names the angle again as its subject rather than pointing back at it: "PostHog can own the warehouse-versus-SDK question because it ships both halves: data warehouse sources and the capture API on the warehouse side, and posthog-js on the SDK side." Then stop – the lead is the ask and the reason, and nothing else belongs in it.
     2. Every sentence in the brief says what it is about. "this", "that", "it", "both sides", "the two halves", and "their" are allowed only when the noun they stand for is in the same sentence, because the reader is a marketer opening the issue cold. "PostHog can own this because it ships both sides" fails twice – nothing in the sentence says what "this" is or what the sides are – and it is the sentence this rule exists for. Name the competitor: "Amplitude says", never "their pitch".
     3. Then a blank line and three markdown bullets, each starting with "- " and a bold label copied exactly from this list, in this order. The label says what the bullet is, so nobody needs a legend:
       - "**${BRIEF_LABELS.pitch}**" – what the competitor is selling in this piece, which is the pitch you named in the last key point, opening with the competitor's name; then the stance the draft takes on it, opening with "The draft".
       - "**${BRIEF_LABELS.products}**" – the PostHog products the draft features, by the names the docs use, in the order the draft reaches them, each with the reader it is for.
       - "**${BRIEF_LABELS.covers}**" – the draft's beats nested under the bullet as lines starting with two spaces and "- ". Three to five beats, one line each, in the draft's own order.
     Beats, not the draft. A paragraph retelling the whole piece is what the bullets replace, and the piece is already in "article_draft".
     Worked example, line breaks and all: "Publish a PostHog take on whether you need an SDK or can send events from your warehouse – Amplitude has one and PostHog's blog has nothing on the choice. PostHog can own the warehouse-versus-SDK question because it ships both halves: data warehouse sources and the capture API on the warehouse side, and posthog-js with session replay on the SDK side.\n\n- **The pitch the draft answers:** Amplitude says the SDK is the one layer a warehouse cannot replace. The draft picks no side: it names what the warehouse covers and what it does not.\n- **PostHog products the draft leads with, in order:** data warehouse sources and the capture API, for SQL-first teams; then session replay, surveys, and experiments, for what needs posthog-js on the page.\n- **What the draft covers, in order:**\n  - What warehouse sources and the capture API already answer.\n  - The three things that need posthog-js on the page, and why.\n  - A person join resolves at query time, so flags and experiments never see it.\n  - The hybrid setup most teams land on, and when warehouse-only is right."
   ```

   The `consider_publishing` line under "That opening sentence leads with the
   work" keeps its Good and Bad; its closing sentence becomes "The pitch, the
   PostHog products, and the draft's beats go in the labelled bullets under
   it, never in this sentence."
   *Why:* the model writes what the example shows, and today the example is
   the bug. *Feeds:* step 3 reuses the constant unchanged, and step 6 greps
   the prompt for these exact sentences.

3. **Give the rewrite prompt the same rule.** In `src/review/prompt.ts`, add
   `PUBLISHING_BRIEF_RULES` to the existing import from
   `../analysis/prompt.js` and append it next to `ARTICLE_RULES` in the
   `contentWork` branch of `buildRewritePrompt`. The `For a piece to publish
   it names the piece and the angle` clause stays as it is.
   *Why:* a revise may rewrite `detail`, and a writer told nothing about the
   shape hands back whatever it likes, so the analyst-side fix would last
   until the first revise. *Feeds:* step 6 asserts the rule is in the rewrite
   prompt for a content action and absent for a product one.

4. **Rename legacy labels at render time.** In `src/github/issue.ts`,
   `recommendedActionSection` runs the `rest` block through a small
   `normalizeBriefLabels(rest)` that, on a line opening `- `, replaces a
   `LEGACY_BRIEF_LABELS` key (with or without `**`) or an unbolded
   `BRIEF_LABELS` value with the bold new label. Nothing else on the line
   moves.
   *Why:* stored analyses written under the old prompt are re-rendered on
   every PATCH, #104 among them, and a label rename invents no words, which
   is the line `enforceActionLead` and `asQuestions` already stand on. It is
   also the backstop for a model that drifts back to the old labels.
   *Feeds:* step 6 renders the #104 detail through `buildIssueBody` and
   expects the three new labels and none of the old.

5. **Say it in the docs.** In `docs/writing.md`, rewrite the section "The
   ask above that draft is a brief, not a retelling": keep the prose-then-
   bullets split and the reason for it, add the antecedent rule with the same
   Bad and Good pair as the prompt, replace the labels paragraph with the
   three labels and what each means, and swap the fenced example for the
   worked example in step 2 (with real line breaks). Add one line under
   "Where this is enforced" naming `BRIEF_LABELS` in `src/analysis/brief.ts`
   and the render-time rename. In this file, one sentence at the end of "The
   marketing question" pointing at this section. In `AGENTS.md`, one sentence
   in the `consider_publishing` house rule: the brief's labels live in
   `src/analysis/brief.ts`, and a sentence in it never points at a noun
   outside itself.
   *Why:* the docs test reads `docs/writing.md`, and an agent that opens
   `AGENTS.md` first should not reintroduce "Position against:" from memory.
   *Feeds:* step 6's `docs/writing.md` tests assert the new section text.

6. **Tests, in `test/publishing.test.ts` unless named otherwise.**
   - Update `keeps the ask and the reason as prose, and starts the bullets
     after them`: expect the new second-sentence example and the sentence
     "names the angle again as its subject rather than pointing back at it".
   - Update `asks the bullets for the positioning, the products, and the
     draft's beats`: expect each of the three `BRIEF_LABELS` values inside
     the prompt's bullet rule and inside the worked example (as
     `\\n\\n- **The pitch the draft answers:**` and `- **What the draft
     covers, in order:**\\n  - What warehouse sources`).
   - New `states the antecedent rule, with the sentence it exists for`:
     expect `"PostHog can own this because it ships both sides" fails twice`
     and `Name the competitor: "Amplitude says", never "their pitch"`.
   - New `never shows the model a vague lead as the good example`: the
     prompt contains `can own this because` exactly once, and that once is
     the Bad line `"PostHog can own this because it ships both sides" fails
     twice`; it contains neither `- Position against:` nor `- Lead with:` nor
     `- Draft covers:`. Same assertions against `docs/writing.md` in the
     `docs/writing.md` describe block, alongside its updated `states the
     split` test.
   - Update the `brief` fixture to the new shape (the step 2 worked example,
     real newlines), and with it `keeps the prose lead on the label's line
     and the bullets in a block of their own`, `gives a list its own block
     even when the model left no blank line before it`, and `shows Slack the
     first sentence of a brief and none of the bullets` (Slack assertion adds
     `not.toContain("The pitch the draft answers")`).
   - New `renames the labels a brief filed under the old prompt used`: render
     the #104 detail, verbatim from the Before block, through
     `buildIssueBody` and expect `- **The pitch the draft answers:** the
     pitch that a vendor SDK`, `- **PostHog products the draft leads with, in
     order:** data warehouse sources`, `- **What the draft covers, in
     order:**\n  - What warehouse sources`, and none of the three old labels.
     Also assert the lead sentence is untouched, since the rename never
     reaches prose.
   - New in `test/review.prompt.test.ts`: `buildRewritePrompt` for a
     `consider_publishing` action contains `**The pitch the draft answers:**`
     and the antecedent rule; for a `consider_building` action it does not.
   - `test/limits.test.ts` needs no change: its `LONG_DETAIL` fixture carries
     no labels.
   *Why:* the label strings are prose the model copies, and the only thing
   that stops them drifting again is a test that fails when they do.

#### Done when

- `npm run typecheck && npm test` pass with the tests above in place.
- `rg -n "Position against:|Lead with:|Draft covers:|own this because|ships both sides" src docs AGENTS.md README.md` returns only the quoted Bad lines
  and the `LEGACY_BRIEF_LABELS` keys.
- Optional confirmation with a key: `SKIP_POSTHOG_INDEX=true DRY_RUN=true
  npm run run -- --url https://amplitude.com/blog/amplitude-sdk-or-not` prints
  a brief whose second sentence names the angle and whose bullets carry the
  three labels, with the Slack payload showing only the first sentence.

#### Not in this change

- No code check for vague antecedents in prose. Detecting "this" is cheap;
  fixing it means writing the referent in, which is inventing the
  recommendation, and dropping the action over it would lose a true
  recommendation for a style slip. The prompt states the rule with the
  offending sentence as the Bad example, the tests grep for it, and the review
  pass stays "do not revise for style".
- No change to `article_draft`, the staged pictures, the so-what key point,
  the issue section order, or the Slack message. If a run shows the model
  ignoring the labels after this lands, the next step is the same render-time
  rename widened to cover the new variant, not a second model pass.

### Storage
Supabase Postgres (`DATABASE_URL`). The project ref lives with the secret, not here.
Tables: `items`, `analyses`, `pages`, `claims` (already migrated).

### Runtime
TypeScript on GitHub. Cron via GitHub Actions (~7am PT).

### Env / secrets
- `DATABASE_URL`
- `SLACK_WEBHOOK_URL`
- `CURSOR_API_KEY` (for Cursor SDK analysis)
- `GITHUB_TOKEN` (free inside Actions; needs `issues: write`)
- Optional: AgentMail API, `X_BEARER_TOKEN` if Actions cannot use other X access
- Optional, all with defaults in [`src/config.ts`](./src/config.ts):
  `REVIEW_MODEL` (`claude-fable-5-1`), `UPDATER_MODEL` (`CURSOR_MODEL`),
  `REVIEW_MAX_PER_RUN` (12), `SKIP_REVIEW` for a local run, and
  `SKIP_PAGE_VISUALS` where there is no Chromium

## Taking it to PostHog marketing
1. Prove it in a private channel, with a screenshot
2. Ship this app repo
3. Open issue/PR in https://github.com/PostHog/marketing linking the app + setup notes (that repo is planning hub, not deploy)
