# posthog-competitor-happenings

Daily Slack alerts when Mixpanel or Amplitude ships something, with what PostHog should do about it.

One run, every morning around 7am PT: read the competitors' changelogs, blogs, X accounts and newsletters, keep only what is genuinely new, ask a model what PostHog should do about each one, open a GitHub issue per recommended action, and post a short Slack message that links each of them. Nothing gets posted twice, and nothing gets posted as raw JSON.

**Why:** competitor launches are easy to miss and expensive to miss. A compare page that says Amplitude cannot do something they shipped last week is worse than no compare page, and nobody finds that by reading changelogs on a Tuesday. This reads them every day and turns each one into work someone can pick up.

**New here?** [Setup](#setup) is the checklist. Coding agents should read [AGENTS.md](./AGENTS.md) first, which is the same checklist with the rules about handling keys. [PLAN.md](./PLAN.md) has the scope and phasing.

## Contents

- [What a message looks like](#what-a-message-looks-like)
- [How a day runs](#how-a-day-runs)
- [Where the signals come from](#where-the-signals-come-from)
- [How a recommendation is made](#how-a-recommendation-is-made)
- [Delivery: Slack and GitHub issues](#delivery-slack-and-github-issues)
- [Setup](#setup)
- [Try it without any secrets](#try-it-without-any-secrets)
- [Commands](#commands)
- [The workflows](#the-workflows)
- [Environment reference](#environment-reference)
- [Data model](#data-model)
- [Test plan](#test-plan)
- [Handoff to PostHog](#handoff-to-posthog)

## What a message looks like

Every alert has the same parts, in this order:

1. **A divider and a header**, always first: `Amplitude · Schedule experiment stop`. Slack collapses consecutive messages from the same bot, so without a break the second alert of a morning reads as more of the first one. The line and the title say where one ends and the next starts. Both blocks are built by `alertBreakBlocks` in [`src/slack/message.ts`](./src/slack/message.ts), and nothing else depends on them, so the break can come back out in one edit.
2. **A feature image**, first under the break. The changelog or blog post's own image if it has one, a launch tweet's image, otherwise a screenshot of the feature page – of the entry itself when a changelog puts every release on one page.
3. **What you need to KNOW** – the heading carries the one sentence on what changed, and the source hangs off the end of it as a linked `changelog`, `post`, or `tweet`. The footer links the source too, but that is the last line of the message: this one is where you can open the change as soon as you have read what happened, without going through the issue to find it. A newsletter gets no link, because the only URL it has is a thread in our own inbox.
4. **Impact** – `minor`, `notable`, or `major`, right under that sentence. A label, not a gate: everything new gets a message.
5. **More detail** – two to four short bullets that elaborate on the sentence. Its own heading, so it never reads as a second summary.
6. **Recommended action(s)** – a heading, then each action stacked under it: a bold title on its own line, exactly one short sentence below, and a link to that action's own GitHub issue. That sentence leads with the work: "Consider enhancing" opens with the change to make and "Update pages" opens with which page and what it should say, because it is the only line the reader gets. [`docs/writing.md`](./docs/writing.md) has the good and bad shapes. Each action is its own block, so Slack leaves space between them and none of it reads as a dense bullet list on a phone. An alert often needs two: a stale page to fix and a feature gap to close. "Consider enhancing" names the PostHog feature to enhance, because the label on its own names nothing, and links that feature to its product page when [`src/posthog/products.ts`](./src/posthog/products.ts) has a checked URL for it.
7. **A small footer** – competitor, source, the model that analyzed it, and a link to the source.

There is no single issue link for the whole alert. Three actions means three issues and three links, one under each action, because the work lands on different desks: marketing owns the page actions, product owns building and enhancing.

PostHog page citations, suggested edits, and open questions are deliberately not in Slack. They are in the issue, which is where someone actually does the work. [`artifacts/slack-test-message.md`](./artifacts/slack-test-message.md) is a real rendered example.

The copy follows PostHog's [docs style guide](https://posthog.com/handbook/wizard-and-docs/docs-style-guide) and [tone of voice](https://posthog.com/handbook/brand/tone), which are standing constraints on anything this bot posts. [`docs/writing.md`](./docs/writing.md) has the short version and says where each rule is enforced. The one to know: dashes are en dashes with a space either side, never em dashes.

## How a day runs

GitHub Actions runs [`.github/workflows/daily.yml`](./.github/workflows/daily.yml) on a cron. One job, about twenty minutes, and it does this:

1. **Refresh the PostHog.com index.** Read `posthog.com`'s sitemap, keep the marketing and docs pages worth citing, and fetch a budgeted slice of them. The canonical product docs in [`src/posthog/products.ts`](./src/posthog/products.ts) are added by hand and sorted first, because they are what a recommendation gets checked against. That catalog tracks the Tools section of [posthog.com/platform.md](https://posthog.com/platform.md), plus the platform surfaces that sit under all of them and still get shipped against by name – [Advanced / proxy](https://posthog.com/docs/advanced/proxy) most of all, because Mixpanel calls it First-Party Domains and nobody calls it a reverse proxy. A surface the catalog does not carry is a recommendation with nothing to check it against. Pages that name Mixpanel or Amplitude have their competitor-mentioning paragraphs stored as `claims`, tagged with the section heading they came from. Half the budget refreshes pages we already know, half reaches ones we have never read, so the comparison pages stay current without starving the tail.
2. **Collect candidates.** Changelog RSS for both competitors, blog posts discovered by diffing each sitemap, the last ten posts from each X account, and newsletters from the AgentMail inbox. A source that is unconfigured or throwing is logged and skipped – one broken feed never takes down the run.
3. **Keep only what is new.** Dedupe against `items` on `(competitor, source, external_id)`. Sitemaps bump `lastmod` on site-wide re-renders, so blog novelty is decided by URL, not by date.
4. **Fill in the body.** A sitemap only gives a URL, so new blog items get their article fetched for a real title and body before analysis.
5. **Analyze against the docs.** Each new item goes to `claude-opus-5` through the Cursor SDK, with PostHog's own docs in front of it. [How a recommendation is made](#how-a-recommendation-is-made) is the detail.
6. **Illustrate and file.** Find the feature image, then open one GitHub issue per recommended action, each carrying the long detail for its own job. Both are stored alongside the verdict, so a retry re-posts the same picture and links the same issues instead of opening a second set.
7. **Post.** One Block Kit message per item to `#posthog-competitor-happenings`, then `analyses.slack_posted_at` is stamped so a retry cannot double-post. A post that fails is left unstamped, and the next run picks it up again for up to three days – an item is only ever deduped once, so without that a Slack blip would lose the message for good.

Impact is a label, not a gate. Every new item gets a message; `minor`, `notable`, and `major` just set expectations before you read it.

Two caps keep a bad morning from becoming a flood: `MAX_ITEMS_PER_SOURCE` (8) on what one competitor and source can contribute, and `MAX_ITEMS_PER_RUN` (12) on Slack messages from one run.

## Where the signals come from

Four sources, all in [`src/sources/`](./src/sources), all optional except the first two.

**Changelogs.** The RSS feeds at [docs.mixpanel.com/changelogs](https://docs.mixpanel.com/changelogs/rss.xml) and [amplitude.com/releases](https://amplitude.com/releases/feed.xml). No key, no account. This is the source that carries most days.

**Blogs.** Each competitor's sitemap, diffed run over run, filtered to `/blog/` paths. New URLs get their article fetched for a title and body. No key.

**X.** The last ten posts from `@mixpanel` and `@Amplitude_HQ`, which is where a launch often lands before the changelog catches up, and where the launch image usually is. Needs `X_BEARER_TOKEN`, an app bearer token from [developer.x.com](https://developer.x.com). Unset, the source is skipped with a log line and the run carries on.

**Newsletters.** Product update emails go to an [AgentMail](https://agentmail.to) inbox that exists only for this. Mail is read over the API, not IMAP, so the daily job needs nothing but a key.

To set it up:

1. Create an inbox in the AgentMail dashboard. You get an address like `name@agentmail.to`. Historically this ran on `chasemccaskill@agentmail.to`.
2. Copy an API key from the same dashboard into `AGENTMAIL_API_KEY`, and the address into the `AGENTMAIL_INBOX_ID` variable.
3. Subscribe that address to both competitors' product update lists: Mixpanel's and Amplitude's blog and product newsletters, from the signup forms on their own sites. Then open the inbox and click through the confirmation mail, since most of them double opt-in.

Each run asks the API for up to 50 messages newer than `LOOKBACK_DAYS`, and keeps only the ones whose subject, preview, or sender names a competitor – `routeMessage` in [`src/sources/agentmail.ts`](./src/sources/agentmail.ts). Anything else in that inbox is ignored rather than alerted on, so signup confirmations and the rest of the noise cost nothing. A newsletter item links back to its own thread in AgentMail, which is why it is the one source whose KNOW line carries no public link.

## How a recommendation is made

Each new item goes to `claude-opus-5` through the Cursor SDK with three kinds of context: the claims indexed for that competitor, which find stale marketing copy; the canonical docs for the products the signal touches, which are the only evidence for what PostHog actually ships; and the competitor's own comparison page about PostHog, read fresh once per competitor per run, which is where a claim that PostHog cannot do something turns up.

The reply is parsed into a fixed shape – impact, a one-sentence summary, key points, one to three actions, citations limited to URLs the model was actually given, and any open questions – and then three guards run over it.

**Actions come in four types**, and the type decides who owns the issue:

| Action | Means | Owner |
| --- | --- | --- |
| `consider_enhancing` | PostHog has this, and the launch beats it. Names the feature | Product |
| `consider_building` | PostHog has nothing like it | Product |
| `update_pages` | A PostHog page is now wrong, understated, or unanswered | Marketing |
| `new_compare_page` | There is no page covering this comparison at all | Marketing |

**A gap has to be shown in the docs.** An action may only say PostHog cannot do something when a docs excerpt in front of the model shows that gap, and `verifyAgainstDocs` re-checks the reply: a `consider_building` the docs contradict becomes `consider_enhancing` against the product that already exists, and a gap claim with no docs page behind it gets one, or an open question saying it was never verified. When the reply names a product the signal's own words never matched, that product's overview page is read too – at most a couple of pages – so an action is never verified against nothing.

**A page edit has to be about the launch that found it.** `update_pages` is for a page that is wrong or misleading, one that understates a capability the docs confirm, or one that leaves a competitor's claim about PostHog unanswered. "Customers might ask" and "the page could be stronger" are not reasons. It also has to be about *this* launch: a signal about scheduling an experiment stop does not get to send someone off to answer an old "basic A/B testing" claim on the same page, so `enforceUpdatePagesTopic` drops a page action whose words never touch the launch's own vocabulary, even when that leaves the alert with no action at all.

**Page actions never target a docs page.** Marketing writes compare pages, product marketing pages, blog posts, and pricing, and `isMarketingTarget` in [`src/posthog/pages.ts`](./src/posthog/pages.ts) is the whole rule. It is enforced three times over: a page action whose only suggested edits are docs pages is dropped, the sentence Slack shows never opens on a docs URL, and the pages-to-update list holds only pages someone would edit. The docs still go into the analysis context, and product issues still cite them. Reading a page and editing it are not the same permission.

Last, `enforceActionLead` makes each surviving action open with the work it asks for rather than the gap behind it, because that sentence is the whole recommendation in Slack. [`docs/writing.md`](./docs/writing.md) is the long version of all of this, including where each rule lives.

With no `CURSOR_API_KEY`, analysis falls back to restating the source. Those messages are labeled "not model-analyzed" so nobody mistakes one for a recommendation.

## Delivery: Slack and GitHub issues

### Slack

Messages land in the private `#posthog-competitor-happenings` channel, id `C0C07A1DM09`. There are two ways to get them there, and the app picks the first one that is configured:

1. **Bot token (preferred).** Set `SLACK_BOT_TOKEN` and the app calls `chat.postMessage` against `SLACK_CHANNEL_ID`. This is the path the daily runner should use. It targets a private channel by id, and when Slack refuses a message it says why – `chat.postMessage` answers HTTP 200 with `{"ok": false, "error": "..."}`, which the app checks and surfaces rather than treating as success.

   The app needs a bot user with `chat:write`, invited to the channel with `/invite @your-app`. Without the invite you get `not_in_channel`; without the scope you get `missing_scope`, which is fixed in api.slack.com → OAuth & Permissions by adding the scope, reinstalling the app to the workspace, and copying the new `xoxb-` token into `SLACK_BOT_TOKEN`. Reinstalling issues a new token, so the secret has to be updated too.

   `npm run run -- --check-slack` answers both questions before anything is posted: it prints the bot, the workspace, and the scopes the token actually carries. The forced post runs it first, so a token that cannot deliver fails before a GitHub issue is opened for a message nobody will see.

2. **Incoming webhook (fallback).** Set `SLACK_WEBHOOK_URL` instead if creating a Slack app is more trouble than it is worth. The channel is fixed at the webhook, so `SLACK_CHANNEL_ID` is ignored.

With neither set, the app prints the payloads and says so. Every run logs which path it chose, so a missing secret shows up in the first few lines of the job rather than as silence.

The image is attached as a Block Kit `image` block pointing at a public URL, so no extra Slack scope is needed – `chat:write` is still the whole requirement.

**A note on the Slack MCP plugin.** Posting to this channel was first proven interactively through the Slack MCP plugin connected in Cursor. That is a fine way to test by hand, but the daily GitHub Actions run deliberately does not depend on it – MCP needs a connected client session, and a scheduled runner has none. The bot token is the equivalent capability in a form a cron job can use.

### GitHub issues

Each recommended action gets its own issue in this repo, opened before the Slack message goes out so every action has something to link. An alert that says "enhance Experiments, enhance feature flags, and fix the compare page" is three issues, because that is three pieces of work for two teams.

Each issue is scoped to its own action and titled `Competitor: feature – Action`. It carries what Slack no longer does: that action in full, the summary and key points, the impact, open questions, source links, and the feature image. Impact is written as the whole scale – a task list of `Minor`, `Notable`, `Major` with this alert's level checked – so a reader sees where it sits without holding the scale in their head. Slack keeps the single label. Marketing's issues get the PostHog pages to update as url + claim today + suggested edit. Product's get only the docs that back the action they are being asked to take: no suggested edits, no compare-page copy, and no docs page for a product some other action in the same alert named. Nothing lists the sibling actions, because each one is its own issue.

A product issue – `consider_enhancing` or `consider_building` – ends with **Docs that would change if this ships**, listing the docs pages that action was checked against. They are the same pages the issue already cites as evidence, read the other way round: today they say what PostHog does, and the day PostHog does this instead, someone has to rewrite them. Nothing new is fetched to build the list. Page actions have no use for it, because editing a page is already the job they describe.

An issue is labeled `competitor-happenings`, the competitor, `source:<source>`, `impact:minor|notable|major`, `action:<action>`, `owner:marketing|product`, one `team:<slug>` per related small team, and `product:<feature>` when the action names a PostHog product the catalog in [`src/posthog/products.ts`](./src/posthog/products.ts) recognizes – `platform:<surface>` for a surface like the reverse proxy that sits under the products rather than beside them. A feature name the catalog does not know gets no label at all, because a repo full of one-off labels nobody queries is worse than none. A label the repo has never seen makes GitHub answer 422, so the app retries once without labels rather than losing the issue.

Inside Actions the workflow's built-in `GITHUB_TOKEN` is enough, with `issues: write` – no new secret, and no repo settings to change beyond leaving issues switched on. Issues are filed against `GITHUB_REPOSITORY`, which Actions sets to whichever repo is running, so a fork files its own. Locally, set a PAT with repo scope as `GITHUB_TOKEN` or `GH_TOKEN` if you want real issues; without one, issue creation is skipped and the run still posts. A failed issue never fails the run: that action's block goes out without a link, and the other actions keep theirs.

### Related team(s)

Every issue has a `## Related team(s)` line under the recommended action, naming the PostHog small teams the work is for: `Experiments`, `Ingestion, Client Libraries`, `Marketing 🦆, Growth 🦦`. Not "Product and Engineering" – PostHog is organized into small teams that each own particular features, so a department names nobody.

[`src/posthog/teams.ts`](./src/posthog/teams.ts) is the catalog: every team on [posthog.com/teams](https://posthog.com/teams), with its slug, the features its page says it owns, the vocabulary of its work, and its spirit animal. The animal is a real field on the team's page, rendered there as "🦆 Duck" under a **Spirit animal** heading, and only some teams have picked one. A team that has not gets no emoji rather than an invented one, so an emoji in an issue is always the team's own. Refreshing the list means reading /teams again; nothing in it is inferred from this app's own product list.

[`src/teams.ts`](./src/teams.ts) does the routing. **The model chooses.** The prompt gives it every team name and what each one owns and asks each action for one to three, and a list it wrote wins outright once each name has been found in the catalog – it is the only reader with the whole signal in front of it. `Product`, `Engineering`, and `Platform` are thrown away rather than mapped to something near them, which is why the fallback has to be good: a reply that names only departments falls all the way through it.

Falling through, strongest first:

1. **Who owns the feature.** The team whose page says it owns the feature the action names, plus the owners of the PostHog products the action's own words match. The app already works out which product a signal is about, and the catalog says who builds it – 18 of the 21 entries in [`src/posthog/products.ts`](./src/posthog/products.ts) have an owner, including `Reverse proxy` to Ingestion and `Notebooks` to Data Tools.
2. **Team vocabulary** in the action's feature and detail, for a signal that names no product we recognize.
3. **A default**, and only when both of those found nothing: Marketing for page work, Product Analytics for product work.

There is always at least one team and never more than three, and the `team:<slug>` labels stay machine-friendly (`team:marketing`, `team:feature-flags`) while the issue body reads as the name plus the animal.

## Setup

Ten minutes, most of it in other people's dashboards. `npm run check-env -- --strict` names everything you have not done yet, at any point.

1. **Fork or clone**, then `npm install`.
2. **Database.** A Postgres. Supabase is what production uses. Apply [`migrations/001_init.sql`](./migrations/001_init.sql) to create the four tables, then take the connection string from Project Settings → Database → Connection string → **Session pooler**.
3. **Slack app.** api.slack.com/apps → create an app → OAuth & Permissions → add the `chat:write` bot scope → install to the workspace → copy the `xoxb-` token. In Slack, invite it to the channel with `/invite @your-app`, and copy the channel id from View channel details.
4. **Cursor API key.** cursor.com/dashboard → Integrations → API Keys.
5. **X bearer token**, optional. developer.x.com → your app → Keys and tokens.
6. **AgentMail inbox**, optional. [Newsletters](#where-the-signals-come-from) above has the steps.
7. **Add the secrets** under Settings → Secrets and variables → Actions. The table below is the complete list.
8. **Check it.** Actions → **Check secrets** → Run workflow. It names anything missing and asks Slack whether the bot token can post, without posting.
9. **First real run.** Actions → **Daily competitor happenings** → Run workflow. The first run for each competitor and source records that source's existing backlog without alerting, then exits. That is deliberate: switching on a new source would otherwise fire its entire archive at Slack at once. Run it a second time, or wait for tomorrow's cron, and only things that appeared since get a message.

### The secrets

All of these go in **Settings → Secrets and variables → Actions → Secrets**:

| Secret | Needed for | Where the value comes from |
| --- | --- | --- |
| `DATABASE_URL` | Everything. The daily run refuses to start without it | Supabase → Project Settings → Database → Session pooler URI |
| `CURSOR_API_KEY` | The Opus analysis. Without it, alerts restate the source | cursor.com/dashboard → Integrations → API Keys |
| `SLACK_BOT_TOKEN` | Posting. `xoxb-`, with `chat:write`, invited to the channel | api.slack.com/apps → OAuth & Permissions |
| `X_BEARER_TOKEN` | The X source. Unset skips it | developer.x.com → Keys and tokens → Bearer Token |
| `AGENTMAIL_API_KEY` | The newsletter source. Unset skips it | agentmail.to → dashboard → API keys |
| `SLACK_WEBHOOK_URL` | Optional fallback delivery, only read when there is no bot token | api.slack.com/apps → Incoming Webhooks |

And these are **Variables**, not secrets, because none of them is a credential:

| Variable | Default | What it is |
| --- | --- | --- |
| `SLACK_CHANNEL_ID` | `C0C07A1DM09` | The channel the bot posts to |
| `AGENTMAIL_INBOX_ID` | `chasemccaskill@agentmail.to` | The inbox newsletters are read from. Also accepted as a secret, since it is easy to store as one |

`GITHUB_TOKEN` is on neither list. Actions provides it, and the workflows grant it `issues: write`, which is all the permission issue creation needs.

`DATABASE_URL` has to be the **pooler** string. Supabase's direct host (`db.<ref>.supabase.co`) resolves to IPv6 only, and GitHub Actions runners have no IPv6 route, so a direct URI fails on the runner with `connect ENETUNREACH` while working fine from a dual-stack laptop. `check-env` catches that one by sight, before a run spends twenty minutes finding out.

### Keys live in Actions, never in the repo

The daily job reads GitHub Actions secrets. That is the only place a value belongs. Nothing here reads a checked-in key, `.env` is in `.gitignore`, and `.env.example` carries the shape of each variable and where to get it, never a value.

For a local run, copy `.env.example` to `.env` and fill it in. On the command line, `gh secret set DATABASE_URL` prompts for the value without echoing it, which beats pasting it anywhere it can be scrolled back to.

If you are setting this up with a coding agent, [AGENTS.md](./AGENTS.md) and [`.cursor/rules/setup-secrets.mdc`](./.cursor/rules/setup-secrets.mdc) tell it to run `check-env`, prompt you for each missing value, and put them in Actions – not to ask you to paste them into a chat, and not to write one into a file. A secret that reaches an agent's context is a secret to rotate.

## Try it without any secrets

```bash
npm install
DRY_RUN=true FORCE_ANALYZE=true POSTHOG_MAX_PAGES=10 MAX_ITEMS_PER_RUN=2 npm run run
```

That hits the live changelogs and sitemaps, indexes a few PostHog.com pages, and prints the Slack payloads it would have sent. Nothing is written and nothing is posted.

Two things degrade gracefully in that mode, and both say so in the log:

- With no `DATABASE_URL`, the run uses an in-memory store. Every item looks new, which is why `FORCE_ANALYZE=true` is needed to get past the first-run guard.
- With no `CURSOR_API_KEY`, analysis falls back to restating the source instead of assessing it.

A dry run never opens an issue, so the message says why the issue links are missing instead of pretending there are some. That note only ever appears in a dry run.

## Commands

| Command | What it does |
| --- | --- |
| `npm run check-env` | Name every required variable that is missing, and where its value comes from. `-- --strict` includes the optional sources |
| `npm run run` | One full cycle via `tsx`, no build step |
| `npm run run -- --url <url>` | Push one named item through the whole pipeline, ignoring dedupe and the seed guard. Add `--out <path>` to save the message |
| `npm run run -- --check-slack` | Ask Slack what `SLACK_BOT_TOKEN` is and which scopes it carries, and exit non-zero if it cannot post |
| `npm run build` | Compile to `dist/` |
| `npm start` | One full cycle from `dist/` |
| `npm run typecheck` | Type-check `src/` and `test/` |
| `npm test` | Unit tests for the parsers, analysis contract, setup checks, and Slack formatting |

### Verifying one specific item

To see exactly what a given announcement produces, without waiting for a cron run or fighting the dedupe table:

```bash
npm run run -- \
  --url https://amplitude.com/releases/schedule-experiment-stop \
  --out artifacts/slack-test-message.md
```

The item still has to exist in a live feed – this mode selects from what the fetchers actually returned, so it cannot manufacture an announcement. Everything else gives way: an item already in the dedupe table is re-posted under its existing row, a PostHog crawl that fails costs citations rather than the message, and a model that refuses falls back to the labeled heuristic. It writes both the rendered message and the exact `chat.postMessage` payload. [`artifacts/slack-test-message.md`](./artifacts/slack-test-message.md) is a checked-in example produced this way.

## The workflows

| Workflow | Trigger | What it does |
| --- | --- | --- |
| [`daily.yml`](./.github/workflows/daily.yml) | Cron, or Run workflow with a dry-run checkbox | The full cycle |
| [`force-post.yml`](./.github/workflows/force-post.yml) | Run workflow with a URL, or a commit to `.github/force-post-url.txt` | One named item, straight to Slack |
| [`check-secrets.yml`](./.github/workflows/check-secrets.yml) | Run workflow | Names missing secrets and checks the Slack token. Posts nothing |
| [`ci.yml`](./.github/workflows/ci.yml) | Push and pull request | Typecheck, tests, build |

**Daily.** GitHub's cron only speaks UTC, so the workflow is scheduled at both 14:00 and 15:00 UTC and the job exits early on whichever one is not 07:00 in `America/Los_Angeles` that day. Before the pipeline it runs `check-env`, so a secret that expired or was never set fails in the first few seconds, naming the variable, rather than twenty minutes in as a database timeout.

**Force post.** For proving delivery without waiting for tomorrow. It runs `--url`, so the dedupe table and the seed guard do not apply. Either run it from the Actions tab with a `force_url`, or put the URL in [`.github/force-post-url.txt`](./.github/force-post-url.txt) and merge that to main – changing the file is itself the trigger, which keeps a record of every forced post in the git history. Both it and the daily run share one concurrency group, so a forced post can never race the daily run.

`DATABASE_URL` is optional for the forced post alone: without it the run uses the in-memory store, so the message still goes out but nothing is recorded and the item stays eligible for a normal alert later. The same applies when the database is set but unreachable – the forced post falls back and logs that it left no dedupe trace, rather than dropping a message it had already analyzed. The daily run does neither: it refuses to start without a database and fails on one it cannot reach, because carrying on there would re-alert the whole backlog tomorrow.

**Check secrets.** Run it after a fork, or any time an alert stops arriving. It reports which secrets are set, never their values, and then asks Slack what the bot token can actually do.

## Environment reference

Every variable, what it defaults to, and what it is for. [`src/setup/requirements.ts`](./src/setup/requirements.ts) is the machine-readable version of the top of this table, and it is what `check-env` reads.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes, unless `DRY_RUN=true` | – | Supabase pooler / Postgres connection string |
| `CURSOR_API_KEY` | for analysis | – | Cursor SDK key. Unset falls back to the labeled heuristic |
| `SLACK_BOT_TOKEN` | for posting | – | Bot token with `chat:write`. Preferred over the webhook |
| `SLACK_CHANNEL_ID` | no | `C0C07A1DM09` | Channel the bot posts to. Ignored by the webhook path |
| `SLACK_WEBHOOK_URL` | no | – | Incoming webhook, used only when there is no bot token |
| `X_BEARER_TOKEN` | no | – | Unset skips the X source |
| `AGENTMAIL_API_KEY` | no | – | Unset skips the newsletter source |
| `AGENTMAIL_INBOX_ID` | no | `chasemccaskill@agentmail.to` | Inbox to read newsletters from |
| `GITHUB_TOKEN` | for issues | – | Set automatically in Actions. `GH_TOKEN` is read as a fallback. Unset skips issue creation |
| `GITHUB_REPOSITORY` | no | `itsmechase15/posthog-competitor-happenings` | `owner/repo` the issues are filed against. Actions sets it to the running repo |
| `SCREENSHOT_URL_TEMPLATE` | no | microlink, then thum.io | Comma-separated renderer templates, tried in order. `{url}` or `{encodedUrl}` becomes the page to screenshot |
| `DRY_RUN` | no | `false` | Print Slack payloads, skip every database write |
| `FORCE_ANALYZE` | no | `false` | Analyze the first-run backlog instead of recording it. Rejected unless `DRY_RUN=true` |
| `CURSOR_MODEL` | no | `claude-opus-5` | Model id passed to the Cursor SDK |
| `CURSOR_RUNTIME` | no | `local` | `local` runs the agent in-process; `cloud` uses a no-repo cloud agent |
| `LOOKBACK_DAYS` | no | `7` | Items older than this are ignored |
| `MAX_ITEMS_PER_RUN` | no | `12` | Hard cap on Slack messages from one run |
| `MAX_ITEMS_PER_SOURCE` | no | `8` | Hard cap on new items accepted from one competitor + source |
| `POSTHOG_MAX_PAGES` | no | `60` | PostHog.com pages fetched per run |
| `POSTHOG_REFRESH_DAYS` | no | `14` | How stale an indexed page gets before it is re-read |
| `SKIP_POSTHOG_INDEX` | no | `false` | Skip the crawl for a faster local run |
| `HTTP_TIMEOUT_MS` | no | `20000` | Per-request timeout |
| `USER_AGENT` | no | `posthog-competitor-happenings/0.1` | Sent on every outbound request |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, or `error` |

## Feature images

An alert always opens with a picture, tried in this order:

1. Whatever the source attached – an RSS `enclosure` or `media:content`, an image embedded in the entry body, or a launch tweet's photo (or a video's preview frame).
2. The feature page's own `og:image` / `twitter:image`, then in-content screenshots. Logos, icons, sprites, tracking pixels, tiny images, and SVGs are filtered out, and a site-wide brand card like `amplitude-default-seo.png` is pushed behind a real screenshot rather than used as the feature image.
3. A screenshot of the feature page, rendered by a service in `SCREENSHOT_URL_TEMPLATE`. This is how the "screenshot the page" step happens without shipping a browser into the daily job, and Slack needs a public URL anyway.
4. A generated card naming the competitor and the feature. Never pretty, but the message always has a valid image block.

Every candidate is checked with a `HEAD` request first, so a 404 or an HTML error page never reaches Slack as an image.

### Entries that share a page

Mixpanel's changelog is one page with an `#anchor` per release, and its RSS points every entry at that page. Step 2 is skipped for those: the page's `og:image` is a Mintlify card that reads "Changelogs" whatever shipped, and the pictures on the page belong to the other releases. So an anchored entry goes straight to a screenshot of its own anchor, and when that fails it takes the generated card, which at least names the feature.

Keeping the anchor takes some care. `normalizeUrl` strips fragments so one page dedupes to one URL, so [`src/sources/rss.ts`](./src/sources/rss.ts) keeps the anchored link in `raw.entryUrl` and [`entryUrl`](./src/sources/link.ts) is what the image, the KNOW link, the footer, and the issue's source line all read. A raw `#` never survives a request – it is a fragment of the screenshot URL, not part of the page being screenshotted – so a renderer only sees it through the `{encodedUrl}` placeholder. `--url https://docs.mixpanel.com/changelogs#2026-08-27` matches on the anchor first for the same reason: without it, every Mixpanel entry answers to the same URL and a forced post takes whichever one the feed listed first.

`SCREENSHOT_URL_TEMPLATE` takes a comma-separated list, tried in order. It defaults to microlink then thum.io: microlink is the one that honors an anchor, and thum.io has no daily quota, so it stands behind it for a day microlink turns us down.

## Data model

Four tables, defined in [`migrations/001_init.sql`](./migrations/001_init.sql):

- `items` – one row per competitor signal, unique on `(competitor, source, external_id)`
- `analyses` – one row per analyzed item, with the structured verdict as `jsonb`, plus the feature image and one issue per action, in action order. A row written before the split carries a single `issue`, which is read back as the first action's
- `pages` – the PostHog.com pages we have read, and which competitors they mention
- `claims` – the individual competitor-mentioning paragraphs we can cite

The rename from severity to impact needed no migration. The canonical verdict, impact included, lives in the `analysis` jsonb; the legacy `analyses.severity` column keeps getting the impact token so its `NOT NULL` still holds, and nothing reads it back. Rows written before the rename, and any written on the short-lived `low | medium | high` scale, are mapped back onto `minor | notable | major` on the way out.

## Test plan

`npm test` covers the parsers against fixture feeds and sitemaps, the analysis response contract (including malformed, camelCase, and pre-rename model output), image extraction and every fallback in the chain, one issue draft per action with its labels and owner, claim extraction from both PostHog's pages and the competitors' compare pages, the relevance guard that keeps a page edit on the launch that found it, dedupe behavior, the setup check that names a missing secret, and the Slack message shape – image first, the one-sentence KNOW, the impact scale, the separate detail bullets, and one stacked block per recommended action with its punctuation and its own issue link. The fixtures under `test/fixtures/` are synthetic and marked as such – they exercise the shapes real feeds use, and are not copies of real competitor announcements.

Beyond the unit tests, the three checks worth running against the real thing:

1. `npm run check-env -- --strict` on a fresh clone names every variable, and passes once the secrets are in.
2. The dry run in [Try it without any secrets](#try-it-without-any-secrets) renders a full message from live feeds without posting.
3. A forced post puts one known announcement in the channel end to end, issues and all. [`artifacts/slack-test-message.md`](./artifacts/slack-test-message.md) is the message that produced.

## Handoff to PostHog

This repo is the whole system: the code, the workflows, and the secrets checklist. It runs on its own Actions cron and needs nothing from PostHog's infrastructure, so adopting it is a fork, six secrets, and a channel id.

To take it further inside PostHog, open an issue on [PostHog/marketing](https://github.com/PostHog/marketing) pointing at this repo. That repo is the planning hub rather than a deploy target, so the issue is where the conversation lives, not the code. Something like:

> **Competitor happenings bot: daily Mixpanel and Amplitude alerts**
>
> A bot that reads Mixpanel's and Amplitude's changelogs, blogs, X accounts, and newsletters every morning, checks anything new against PostHog's own docs, and posts one Slack alert per launch with what we should do about it – enhance a product, build one, or fix a page that is now wrong. Each recommended action opens its own GitHub issue, labeled by owner and team, so the work lands on a desk rather than in a channel.
>
> Running today in [itsmechase15/posthog-competitor-happenings](https://github.com/itsmechase15/posthog-competitor-happenings). Setup is a fork, six Actions secrets, and a Slack channel id – the README has the checklist, and a Check secrets workflow that tells you what is missing.
>
> Worth deciding: which channel it should post to, and whether the issues belong here or stay in the bot's own repo.

One thing on the roadmap and deliberately not built: replying to a Slack alert to edit its recommended actions.
