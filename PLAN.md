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
docs do not settle it, the action drops to update pages or a lower impact and
the doubt goes in open questions. `verifyAgainstDocs` enforces this after the
model replies, so a contradicted "PostHog has nothing like this" cannot ship.

### Analysis
- Cursor SDK, model `claude-opus-5`
- Impact `minor | notable | major` = **label only** (not a post gate – every new signal can Slack)
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
3. **Impact** – Minor / Notable / Major, right under the sentence
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
action: that action in full, the summary, key points, impact, open questions,
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
