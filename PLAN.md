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
- Newsletters via AgentMail inbox `chasemccaskill@agentmail.to` (optional until subscribed)
- Official X: `@mixpanel` and `@Amplitude_HQ` (last ~10 posts/day)

### Out of v1 daily flow
- Webinars/events, status/SDK feeds, LinkedIn, web UI, weekly digest, auto page edits
- PRs for page edits (Phase 3)

### Index PostHog.com
Index PostHog.com pages that mention Mixpanel or Amplitude. Cite URL + claim + suggested edit when relevant.

Alongside those, keep a bounded list of canonical product docs indexed: one
overview page per product in [`src/posthog/products.ts`](./src/posthog/products.ts)
plus the lifecycle, scheduling, and rollout pages competitors keep shipping
against. Not a crawl of posthog.com – the docs for the products a signal names,
capped per run.

That catalog tracks the Tools section of
[posthog.com/platform.md](https://posthog.com/platform.md), plus the platform
surfaces that sit under all of them and still get shipped against by name:
[Advanced / proxy](https://posthog.com/docs/advanced/proxy) is the one that
keeps coming up, because Mixpanel calls it First-Party Domains and nobody calls
it a reverse proxy. A surface missing from the catalog is a recommendation with
nothing to check it against, which is how "PostHog has no managed reverse
proxy" gets shipped when PostHog has run one for years. Renamed products keep
their old names as aliases, so a model writing "LLM analytics" still lands on
AI observability.

### Verify before recommending
Every recommendation is a claim about what PostHog ships, so it is checked
against the product docs first. Before any consider enhancing / consider
building / update pages action, the canonical docs for the products the signal
touches go into the analysis context, and an action may only say PostHog cannot
do something when a docs excerpt shows that gap – a compare-page blurb, or its
silence, is not evidence. Where the docs show an adjacent capability the action
says so and recommends only the real gap: Amplitude scheduling an experiment
stop meets [scheduled flag changes](https://posthog.com/docs/feature-flags/scheduled-flag-changes)
and [manual experiment lifecycle](https://posthog.com/docs/experiments/managing-lifecycle),
so the honest gap is "flags schedule, experiments still stop by hand". When the
docs do not settle it, the action drops to update pages and the doubt goes in
open questions. Impact does not move for it: impact is about what the
competitor shipped, not about what could be checked on PostHog's side.
`verifyAgainstDocs` enforces this after the model replies, so a contradicted
"PostHog has nothing like this" cannot ship.

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
- One to three recommended actions, most important first. One signal often
  needs two, e.g. a stale page to fix and a feature gap to close:
  - update pages (existing compare/content)
  - new compare page
  - consider building (PostHog has nothing like this)
  - consider enhancing (related feature; gap). Names the PostHog feature to
    enhance, so the line reads "Consider enhancing Experiments – ..." rather
    than a label with a vague gap after it. Enhancing means reaching parity
    with what the competitor shipped, or beating it
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
2. **What you need to KNOW** – the one sentence on what changed, under the heading. No unlabeled line above it
3. **Impact** – Minor / Notable / Major, right under the sentence. Same three
   words as before, rated by what the post shipped
4. **More detail** – a few short bullets that elaborate, clearly separate from the KNOW sentence
5. **Recommended action(s)** – a heading, then each action stacked in its own
   block: bold title on one line, one short sentence under it, then a link to
   that action's own issue ("Access GitHub issue #12"). No single issue link
   stands for the whole alert. That sentence leads with the work: the change to
   make for consider enhancing and consider building, the page and the update
   for update pages and new compare page
6. Small footer – competitor · source · model · source link

PostHog page citations, suggested edits, and open questions are not in Slack.
They live in the issue.

### GitHub issues
Moved into the daily flow from Phase 2, because Slack got short and the detail
had to go somewhere.

One issue per **recommended action**, not per alert, in this repo, opened
before the Slack post so every action has something to link. Three actions is
three issues, because marketing owns update pages and new compare page while
product owns consider building and consider enhancing.

Title is competitor + feature + the action. Each body is scoped to its own
action: that action in full, the summary, key points, the whole impact scale
with each level's meaning next to it, open questions,
source links, and the feature image. Marketing's issues carry the PostHog pages
to update (url, claim, suggested edit); product's carry only the docs that back
that action, without the edits or the compare-page copy. Neither lists the
sibling actions: each one is its own issue. Labelled by competitor, source,
impact, action, owner, and the PostHog product when the action names one. Uses the
`GITHUB_TOKEN` Actions provides; with no token the run skips issue creation and
keeps posting.

Chase personal Slack first; PostHog channel later.

### Storage
Supabase Postgres (`DATABASE_URL`). Project ref `hapeyljmsclryifyhqdr`.
Tables: `items`, `analyses`, `pages`, `claims` (already migrated).

### Runtime
TypeScript on GitHub. Cron via GitHub Actions (~7am PT).

### Env / secrets
- `DATABASE_URL`
- `SLACK_WEBHOOK_URL`
- `CURSOR_API_KEY` (for Cursor SDK analysis)
- `GITHUB_TOKEN` (free inside Actions; needs `issues: write`)
- Optional: AgentMail API, `X_BEARER_TOKEN` if Actions cannot use other X access

## Handoff to Joe (PostHog Marketing Lead)
1. Prove on Chase Slack + screenshot
2. Ship this app repo
3. Open issue/PR in https://github.com/PostHog/marketing linking the app + setup notes (that repo is planning hub, not deploy)
