# Design note: index PostHog's product surface before recommending anything

Status: **proposal, awaiting Chase's approval. No behavior in this repo changes with this file.**

## Why now

Issue [#44](https://github.com/itsmechase15/posthog-competitor-happenings/issues/44):
Mixpanel shipped First-Party Domains (route tracking through a subdomain you
own). Opus wrote "Consider enhancing Managed reverse proxy" from world
knowledge. Its own issue body says "No PostHog ingestion or proxy docs are in
context for this signal". Reproduced against `main` today:

```
matchProducts(firstPartyDomainsText)   -> []
matchCapabilities(...)                 -> []
docUrlsForText(...)                    -> []
findProductByName("Managed reverse proxy") -> undefined
```

Three separate faults, one launch:

1. **Catalog gap.** `POSTHOG_PRODUCTS` (`src/posthog/products.ts:37`) has 15
   entries, none for ingestion, proxies, or anything under
   [platform.md](https://posthog.com/platform.md) that is not a "Tool". The
   real page, `/docs/advanced/proxy`, is in posthog.com's sitemap (13,082 URLs,
   3,442 under `/docs/`), so the indexer treats it as a priority 6 candidate
   behind everything else, and even once indexed it can never reach the
   prompt: `gatherDocsContext` only reads the URLs `docUrlsForText` returns,
   and that function only knows catalog URLs.
2. **No guard for a named-but-unknown feature.** `verifyAgainstDocs`
   (`src/analysis/verify.ts:53`) retypes `consider_building` when a docs page
   contradicts it, and flags gap claims with no docs behind them. A
   `consider_enhancing` whose `feature` is not in the catalog, with zero docs
   in context, passes through unchanged. `buildIssueLabels`
   (`src/github/issue.ts:65`) then falls back to `action.feature` and mints a
   `product:managed-reverse-proxy` label for a product the app never verified.
3. **Docs and marketing pages share one pool.** The claims index includes
   `/docs/` (`src/posthog/index.ts:27`), so `/docs/migrate/mixpanel`,
   `/docs/cdp/sources/mixpanel`, and `/docs/data-warehouse/sources/amplitude`
   are indexed as "PostHog.com pages that mention Mixpanel", the section the
   prompt labels marketing copy. And because docs URLs are in context, the
   model may cite one with a `suggested_edit`; nothing in `relevance.ts`,
   `lead.ts`, or `issue.ts` stops an `update_pages` action from landing on a
   docs page.

## A. Product-doc indexing strategy

### Principle: a synced catalog, not a crawl

Coverage comes from syncing the catalog to PostHog's own machine-readable
lists, then keeping per-run caps exactly where they are.

| Source | What it gives us | How it is used |
| --- | --- | --- |
| `https://posthog.com/platform.md` | The 17 official Tools, with product URLs | Every Tool is a `POSTHOG_PRODUCTS` entry |
| `https://posthog.com/llms.txt` | ~1,545 docs links grouped under ~70 `##` headings (before the API reference) | Headings are the checklist. Each heading maps to a product, a platform surface, or is explicitly out of scope |
| `https://posthog.com/pricing.md` | Plans, free tiers, per-product pricing | One `Pricing and plans` platform entry, because competitors ship plan changes ("Experiments now on Free and Growth plans") |
| llms.txt `## Advanced`, `## Data`, `## Privacy`, `## Settings`, `## SDKs and Libraries` | The plumbing platform.md leaves implicit | Platform surface entries (below) |

Every URL added is opened and checked, as `products.ts` already requires.
Redirects found today and to fix while there: `/data-stack` and
`/data-warehouse` both land on `/context-warehouse`; `/docs/llm-analytics`
lands on `/docs/ai-observability`; `/docs/max-ai` lands on `/docs/posthog-ai`.

### What belongs where

**`POSTHOG_PRODUCTS`** gains a `kind: "product" | "platform"` field. Both kinds
can be named as an action's `feature`, matched from a signal, linked in Slack,
and used to scope an issue. The distinction only changes wording and labels.

- `kind: "product"`: the platform.md Tools. Present today: Product analytics,
  Web analytics, Session replay, Feature flags, Experiments, Error tracking,
  Surveys, Logs, Data warehouse, CDP (today "Data pipelines"), AI
  observability (today "LLM analytics"), PostHog AI (today "Max AI"). Missing
  today: **Endpoints, Workflows, Customer analytics, Replay Vision, Support**.
  Also keep Revenue analytics, Alerts, Notebooks: they have docs sections and
  competitors ship against them, even though platform.md does not list them
  as Tools.
- `kind: "platform"`: surfaces a competitor launch lands on that are not a
  product. Each gets a label PostHog uses, keywords, and 2 to 4 docs:
  - **Reverse proxy and ingestion domains** – `/docs/advanced/proxy`
    (the managed reverse proxy lives on this page),
    `/docs/advanced/proxy/managed-reverse-proxy`,
    `/docs/health-checks/no-reverse-proxy`, `/docs/advanced/content-security-policy`
  - **Data management and ingestion** – `/docs/data`, `/docs/data/event-filtering`,
    `/docs/data/ingestion-warnings`, `/docs/how-posthog-works/ingestion-pipeline`
  - **SDKs, API, and MCP** – `/docs/libraries`, `/docs/api`,
    `/docs/model-context-protocol`
  - **Privacy and compliance** – `/docs/privacy` and its GDPR / HIPAA / EU
    cloud children
  - **Access control and settings** – `/docs/settings/access-control`,
    `/docs/settings/activity-logs`
  - **Pricing and plans** – `/pricing` (markdown at `/pricing.md`)
  - **Self-driving / agents** – `/docs/self-driving`, because both competitors
    are shipping agents and plugins (Mixpanel's Claude Code plugin, 2026-08-24)

**`POSTHOG_CAPABILITIES`** stays what it is: cross-product behaviors that
qualify a gap rather than name a product (Scheduling, Alerting, Automation).
Add **Ad-blocker resilience** pointing at the proxy docs, so a signal that
never says "proxy" still pulls the page that answers it, the same way
Scheduling pulls the flags page for an Experiments signal.

**Out of scope for the catalog** (explicitly, so nobody wonders): the
`## Optional` API reference (~2,000 pages), tutorials, handbook, blog,
customers, per-framework SDK pages beyond the libraries overview, self-host
internals, community questions.

Size: `CANONICAL_DOC_URLS` grows from 35 to roughly 90 to 100 URLs.
`candidatePriority` already pins them at priority 0, and `POSTHOG_MAX_PAGES`
is 60 per run with half reserved for refresh, so the new set is fully indexed
in two daily runs and then refreshed at about 7 pages a day. No cap changes
are required; bumping `maxUrls` in `docUrlsForText` from 6 to 8 is optional
and can wait for evidence.

### Keyword matching for first-party domain signals

`matchProducts` (`products.ts:303`) is substring scoring over each entry's
`keywords`, with the first keyword weighted x3. The Reverse proxy entry's
keywords, most specific first:

```
"reverse proxy", "managed proxy", "first-party domain", "first party domain",
"custom domain", "tracking domain", "ingestion domain", "cname", "ad blocker",
"adblock", "tracking protection", "content blocker", "subdomain", "tls certificate",
"proxy"
```

Against the Mixpanel text this scores on "first-party domain" (x3), "subdomain"
(x3), "cname", "ad blocker", "tracking protection", "tls certificate", so the
proxy page is the first docs URL in context. "domain" alone stays out: it is
too common. The same launch would also match `Data management and ingestion`
weakly, which is correct and harmless.

Two more things `focusTerms` in `docs.ts` needs so the excerpt is about the
right part of the page: the proxy page is 15 KB and its managed-proxy section
is not the lead sentence, so the entry's keywords must include the words that
section uses ("managed", "cname", "dns", "certificate") or the excerpt will
be about nginx.

### Optional later: llms.txt-driven drift check

Not a crawler and not an auto-writer. A script, `scripts/check-catalog.ts`,
run in CI weekly or by hand:

1. Fetch platform.md and llms.txt.
2. Fail when a platform.md Tool has no catalog entry, when an llms.txt `##`
   heading (outside the out-of-scope list) maps to no entry, or when a catalog
   URL 404s or redirects.
3. Print the diff. A human adds the entry.

That is how "a new PostHog product cannot be missed" is met without indexing
1,500 pages, and it also catches the URL rot found above.

## B. Analysis and recommendation rules

**Current behavior.** The prompt (`src/analysis/prompt.ts`) already says to
check the docs before any product or page action, forbids gap claims with no
excerpt behind them, and, when no docs are in context, asks for lower impact
and an open question (`prompt.ts:46`). `verifyAgainstDocs` enforces two
things after the model: `consider_building` with a covering docs page becomes
`consider_enhancing`, and a gap claim with no docs gets an open question. Two
holes remain.

### Rule 1: every action is matched to catalog entries before it ships

Add a second, post-model docs pass in `analyzeItems` (`src/analysis/analyze.ts`):

1. For each action with a `feature`, resolve it with `findProductByName`.
2. If it resolves and that entry's docs are not already in context, fetch them
   (bounded: at most 2 entries, 3 URLs each, reusing `gatherDocsContext`'s
   fetch-and-store path) and run `verifyAgainstDocs` with the merged set.
3. If it does not resolve, the action is **unverified** (Rule 2).

The signal-side match (`docUrlsForText`) is kept as is; this pass exists for
the case where the model names a product the signal text did not point at.

### Rule 2: no confident `consider_enhancing` with zero docs behind it

In `verify.ts`, a `consider_enhancing` whose `relevantDocs` is empty after
Rule 1:

- keeps its type and its detail, and gets one appended sentence: "No PostHog
  docs for &lt;feature&gt; were in context, so what PostHog ships here is
  unverified." (this mirrors how `consider_building` corrections work today:
  nothing deleted, a correction appended);
- pushes an open question naming the docs to check;
- caps the alert's impact at `notable` (a `major` needs verified evidence);
- is logged as a correction note, so the run log shows how often this fires.

`buildIssueLabels` stops minting `product:` labels from a `feature` the
catalog does not recognize. `actionTitleParts` already leaves unknown features
unlinked, which is right.

**Decision for Chase (D1):** keep the unverified action with the caveat (above,
recommended), drop it and leave the alert with the summary and open questions,
or add a fourth "verify" action type. The third option touches `ACTIONS`,
`ACTION_LABEL`, `ACTION_OWNER`, the Slack layout, and the issue templates, so
it is the most invasive and I do not recommend it for now.

**Decision for Chase (D2):** should Slack show the caveat? Today Slack shows
the first sentence of `detail` only, so the appended sentence lands in the
issue, not Slack. Options: leave Slack clean (recommended: the issue carries
the caveat and the open question), or suffix the bold title with "(unverified)".

### Rule 3: docs excerpts are evidence for product decisions only

One prompt paragraph, stated once under the existing "Check the docs" block:

> The docs section is evidence about what PostHog ships. Use it to decide
> between consider_building and consider_enhancing and to judge whether a
> marketing page understates PostHog. It is never a page to edit: an
> update_pages or new_compare_page action targets PostHog's compare pages and
> marketing pages about Mixpanel or Amplitude, and its posthog_refs with a
> suggested_edit must be those pages. Do not ask anyone to update a
> posthog.com/docs page.

The heading in product issues (`issue.ts:126`, "PostHog pages for context")
becomes "PostHog docs checked (evidence, not pages to edit)" so a reader
does not act on it as a to-do.

## C. Page-update actions are marketing actions

### Target set, tightened

`update_pages` and `new_compare_page` may only target posthog.com pages that
talk about a competitor and that marketing owns:

- `/compare/*` (76 pages in the sitemap today)
- `/blog/*` posts that name Mixpanel or Amplitude
- product marketing pages (`/experiments`, `/feature-flags`, `/product-*`, `/customers/*`)
- `/pricing`

Never `/docs/*`. The one honest edge is `/docs/migrate/mixpanel` and
`/docs/migrate/migrate-from-amplitude`, which are docs that are about
competitors.

**Decision for Chase (D3):** are the migration docs a marketing target?
Recommended: no. They stay in the claims index as context (the model may
still read them under "pages that mention Mixpanel") but cannot be the page
an `update_pages` action edits. If yes, they become the single allowed
`/docs/` prefix.

### Enforcement, not just prompt text

A small `isMarketingTarget(url)` helper next to `isDocsRef` (`issue.ts:91`),
used in three places that today accept any cited URL:

1. `enforcePageTargets` in `src/analysis/relevance.ts`, run right after
   `enforceUpdatePagesTopic`: an `update_pages` whose only cited pages with a
   `suggested_edit` are docs URLs is dropped with a log note and an open
   question ("the docs say X; if a marketing page understates it, name that
   page"). Suggested edits on docs refs are stripped so they cannot resurface.
2. `pageToName` in `src/analysis/lead.ts:56` picks the page to open the Slack
   sentence with. It must skip docs refs, or "On Deploy a reverse proxy: ..."
   becomes the Slack line.
3. `pagesSection` in `issue.ts` for marketing issues lists only marketing
   targets under "PostHog pages to update"; docs refs, if any, move to a
   "Docs checked" subsection with no edits.

The claims indexer keeps `/docs/` so migration and sources pages can still
surface as context, but `PostHogClaim` gains a `kind: "marketing" | "docs"`
flag (derived from the URL, no migration needed) and the prompt renders the
two under separate sub-headings so the model stops reading docs as copy.

### Where product-doc update lists belong

Not in `update_pages`, and not today. When PostHog decides to enhance a
feature, the enhance issue is the place: a later-phase section "Docs that
would change if this ships", derived from the same `relevantDocs` the action
was verified against. Cheap once Rule 1 exists, because those URLs are already
on the issue. It is listed under Phase 2 so it cannot be confused with the
marketing action.

## D. Concrete changes

### Phase 1 (now): four PRs, in this order

1. **Catalog sync** – `src/posthog/products.ts`, `test/products.test.ts`,
   `README.md` (product list). Add `kind`; add Endpoints, Workflows, Customer
   analytics, Replay Vision, Support; rename LLM analytics to AI observability,
   Data pipelines to CDP, Max AI to PostHog AI, keeping the old names as
   aliases; fix the three redirected URLs; add the seven platform entries and
   the Ad-blocker resilience capability. Tests: the First-Party Domains text
   yields `/docs/advanced/proxy` first; "Experiments and Feature Flags: Now on
   Free and Growth plans" yields pricing plus Experiments; every catalog URL is
   unique and absolute. No cap changes.
2. **Verify against the named feature** – `src/analysis/analyze.ts`,
   `src/analysis/verify.ts`, `src/posthog/docs.ts` (new `docsForProducts`),
   `src/github/issue.ts` (label fallback), `test/verify.test.ts`,
   `test/analysis.test.ts`. Implements Rules 1 and 2. Test: replay issue #44's
   reply against an empty docs set and assert the caveat, the open question,
   the impact cap, and no `product:` label; replay it with the proxy page in
   context and assert the action is left alone and cites the page.
3. **Marketing targets only** – `src/analysis/relevance.ts` (or a new
   `src/analysis/targets.ts` if `relevance.ts` gets long), `src/analysis/lead.ts`,
   `src/analysis/prompt.ts`, `src/github/issue.ts`, `src/posthog/index.ts`,
   `src/types.ts` (`PostHogClaim.kind`), tests alongside. Implements Rule 3
   and section C. Test: an `update_pages` with a suggested edit on
   `/docs/advanced/proxy` only is dropped; the same with a `/compare/` ref is
   kept and the Slack sentence names the compare page.
4. **Docs** – `PLAN.md` (Index PostHog.com and Verify sections), `README.md`,
   `docs/writing.md`. States the catalog rule, the unverified rule, and that
   docs are never an `update_pages` target.

Each PR is independently shippable and testable with `npm test` (today 18
files pass). PR 2 and PR 3 both touch `analyze.ts` and `issue.ts`, so they
land in order.

### Phase 2 (later, each its own PR)

5. `scripts/check-catalog.ts` plus a weekly workflow: the llms.txt and
   platform.md drift check from section A.
6. Fetch docs as Markdown (`url + ".md"`) in `fetchDoc` and the indexer for
   `/docs/` URLs: cleaner prose than cheerio over the HTML, and the excerpt
   picker gets real paragraphs. Keep HTML for everything else.
7. "Docs that would change if this ships" section on `consider_enhancing` and
   `consider_building` issues (section C).
8. Optional: one model retry with the Rule 1 docs merged into the prompt when
   the first reply named a product the signal did not point at. Costs a second
   model call on those items only.

### Decisions needed from Chase

- **D1** Unverified enhance: keep with caveat (recommended) / drop / new action type.
- **D2** Slack surface for unverified: issue only (recommended) / title suffix.
- **D3** Migration docs as marketing targets: no (recommended) / yes.
- **D4** Product labels: "Reverse proxy" as the catalog label (recommended,
  PostHog's own docs title is "Deploy a reverse proxy", and "managed" is one
  option on that page) vs "Managed reverse proxy" as Opus wrote it.
- **D5** Data warehouse product URL: platform.md still links `/data-warehouse`,
  which redirects to `/context-warehouse`. Link the redirect target or keep
  the platform.md URL.

## E. Non-goals

- No crawl of posthog.com, no indexing of the ~2,000 API reference pages,
  tutorials, handbook, or community pages.
- No automatic catalog edits. The drift check reports; a person adds entries.
- No `update_pages` or `new_compare_page` that targets a `/docs/` page, and no
  Slack line that reads "update the Managed reverse proxy doc".
- No docs-to-update lists on today's issues. That is Phase 2, on product
  issues only, after an enhance decision.
- No new action type in Phase 1 (unless D1 says otherwise).
- No change to per-run caps, the Slack layout, or the one-issue-per-action
  rule.
