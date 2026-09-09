# posthog-competitor-happenings

Daily Slack alerts when Mixpanel or Amplitude ships something, with what PostHog should do about it.

One run, every morning around 7am PT: read the competitors' changelogs, blogs, X accounts and newsletters, keep only what is genuinely new, ask a model what PostHog should do about each one, open a GitHub issue per recommended action, and post a short Slack message that links each of them. Nothing gets posted twice, and nothing gets posted as raw JSON.

See [PLAN.md](./PLAN.md) for scope, phasing, and the handoff plan.

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

## Try it without any secrets

```bash
npm install
DRY_RUN=true FORCE_ANALYZE=true POSTHOG_MAX_PAGES=10 MAX_ITEMS_PER_RUN=2 npm run run
```

That hits the live changelogs and sitemaps, indexes a few PostHog.com pages, and prints the Slack payloads it would have sent. Nothing is written and nothing is posted.

Two things degrade gracefully in that mode, and both say so in the log:

- With no `DATABASE_URL`, the run uses an in-memory store. Every item looks new, which is why `FORCE_ANALYZE=true` is needed to get past the first-run guard described below.
- With no `CURSOR_API_KEY`, analysis falls back to restating the source instead of assessing it. Those messages are labeled "not model-analyzed" so nobody mistakes them for a recommendation.

A dry run never opens an issue, so the message says why the issue links are missing instead of pretending there are some. That note only ever appears in a dry run.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL` (the Supabase pooler connection string), `CURSOR_API_KEY`, and `SLACK_BOT_TOKEN`.
3. Apply [`migrations/001_init.sql`](./migrations/001_init.sql) if your database does not already have the four tables. The Supabase project already does.
4. `npm run run`

The first run for each competitor and source records that source's existing backlog without alerting, then exits. That is deliberate: switching on a new source would otherwise fire its entire archive at Slack at once. The second run onwards only alerts on things that appeared since.

## Slack delivery

Messages land in the private `#posthog-competitor-happenings` channel, id `C0C07A1DM09`. There are two ways to get them there, and the app picks the first one that is configured:

1. **Bot token (preferred).** Set `SLACK_BOT_TOKEN` and the app calls `chat.postMessage` against `SLACK_CHANNEL_ID`, which defaults to `C0C07A1DM09`. This is the path the daily runner should use. It targets a private channel by id, and when Slack refuses a message it says why – `chat.postMessage` answers HTTP 200 with `{"ok": false, "error": "..."}`, which the app checks and surfaces rather than treating as success.

   The app needs a bot user with `chat:write`, invited to the channel with `/invite @your-app`. Without the invite you get `not_in_channel`; without the scope you get `missing_scope`, which is fixed in api.slack.com → OAuth & Permissions by adding the scope, reinstalling the app to the workspace, and copying the new `xoxb-` token into `SLACK_BOT_TOKEN`. Reinstalling issues a new token, so the secret has to be updated too.

   `npm run run -- --check-slack` answers both questions before anything is posted: it prints the bot, the workspace, and the scopes the token actually carries. The forced post runs it first, so a token that cannot deliver fails before a GitHub issue is opened for a message nobody will see.

2. **Incoming webhook (fallback).** Set `SLACK_WEBHOOK_URL` instead if creating a Slack app is more trouble than it is worth. The channel is fixed at the webhook, so `SLACK_CHANNEL_ID` is ignored.

With neither set, the app prints the payloads and says so. Every run logs which path it chose, so a missing secret shows up in the first few lines of the job rather than as silence.

The image is attached as a Block Kit `image` block pointing at a public URL, so no extra Slack scope is needed – `chat:write` is still the whole requirement.

**A note on the Slack MCP plugin.** Posting to this channel was first proven interactively through the Slack MCP plugin connected in Cursor. That is a fine way to test by hand, but the daily GitHub Actions run deliberately does not depend on it – MCP needs a connected client session, and a scheduled runner has none. The bot token is the equivalent capability in a form a cron job can use.

## Commands

| Command | What it does |
| --- | --- |
| `npm run run` | One full cycle via `tsx`, no build step |
| `npm run run -- --url <url>` | Push one named item through the whole pipeline, ignoring dedupe and the seed guard. Add `--out <path>` to save the message |
| `npm run run -- --check-slack` | Ask Slack what `SLACK_BOT_TOKEN` is and which scopes it carries, and exit non-zero if it cannot post |
| `npm run build` | Compile to `dist/` |
| `npm start` | One full cycle from `dist/` |
| `npm run typecheck` | Type-check `src/` and `test/` |
| `npm test` | Unit tests for the parsers, analysis contract, and Slack formatting |

## Verifying one specific item

To see exactly what a given announcement produces, without waiting for a cron run or fighting the dedupe table:

```bash
npm run run -- \
  --url https://amplitude.com/releases/schedule-experiment-stop \
  --out artifacts/slack-test-message.md
```

The item still has to exist in a live feed – this mode selects from what the fetchers actually returned, so it cannot manufacture an announcement. Everything else gives way: an item already in the dedupe table is re-posted under its existing row, a PostHog crawl that fails costs citations rather than the message, and a model that refuses falls back to the labeled heuristic. It writes both the rendered message and the exact `chat.postMessage` payload. [`artifacts/slack-test-message.md`](./artifacts/slack-test-message.md) is a checked-in example produced this way.

## GitHub issues

Each recommended action gets its own issue in this repo, opened before the Slack message goes out so every action has something to link. An alert that says "enhance Experiments, enhance feature flags, and fix the compare page" is three issues, because that is three pieces of work for two teams: marketing owns `update_pages` and `new_compare_page`, product owns `consider_building` and `consider_enhancing`.

Each issue is scoped to its own action and titled `Competitor: feature – Action`. It carries what Slack no longer does: that action in full, the summary and key points, the impact, open questions, source links, and the feature image. Impact is written as the whole scale – a task list of `Minor`, `Notable`, `Major` with this alert's level checked – so a reader sees where it sits without holding the scale in their head. Slack keeps the single label. Marketing's issues get the PostHog pages to update as url + claim today + suggested edit. Product's get only the docs that back the action they are being asked to take: no suggested edits, no compare-page copy, and no docs page for a product some other action in the same alert named. Nothing lists the sibling actions, because each one is its own issue.

A product issue – `consider_enhancing` or `consider_building` – ends with **Docs that would change if this ships**, listing the docs pages that action was checked against. They are the same pages the issue already cites as evidence, read the other way round: today they say what PostHog does, and the day PostHog does this instead, someone has to rewrite them. Nothing new is fetched to build the list. Page actions have no use for it, because editing a page is already the job they describe.

`update_pages` and `new_compare_page` never target a docs page. Marketing writes compare pages, product marketing pages, blog posts, and pricing, and `isMarketingTarget` in [`src/posthog/pages.ts`](./src/posthog/pages.ts) is the whole rule. It is enforced three times over: a page action whose only suggested edits are docs pages is dropped, the sentence Slack shows never opens on a docs URL, and the pages-to-update list holds only pages someone would edit. The docs still go into the analysis context, and product issues still cite them.

An issue is labeled `competitor-happenings`, the competitor, `source:<source>`, `impact:minor|notable|major`, `action:<action>`, `owner:marketing|product`, one `team:<team>` per related team, and `product:<feature>` when the action names a PostHog product the catalog in [`src/posthog/products.ts`](./src/posthog/products.ts) recognizes – `platform:<surface>` for a surface like the reverse proxy that sits under the products rather than beside them. A feature name the catalog does not know gets no label at all, because a repo full of one-off labels nobody queries is worse than none. A label the repo has never seen makes GitHub answer 422, so the app retries once without labels rather than losing the issue.

### Related team(s)

Every issue has a `## Related team(s)` line under the recommended action, saying who the work is for. [`src/teams.ts`](./src/teams.ts) is the whole map, and it is deliberately coarse:

- Page work – `update_pages` and `new_compare_page` – is **Marketing**.
- Building and enhancing – `consider_building` and `consider_enhancing` – is **Product**.
- **Engineering** is added on top when the action is plainly about the plumbing: SDKs, APIs, ingestion, pipelines, proxies, webhooks, self-hosting, DNS. It is a whole-word keyword match on the action's feature and detail, so "rapid" is not an API.

There is always at least one team and never more than three. It stays this coarse on purpose: PostHog's real team list is not something this app can read yet, and a specific team guessed wrong routes the issue to nobody. When there is a list to route against, `relatedTeams` in [`src/teams.ts`](./src/teams.ts) is the only function the issue builder calls, so that is the one place to change.

Inside Actions the workflow's built-in `GITHUB_TOKEN` is enough, with `issues: write` – no new secret. Locally, set a PAT as `GITHUB_TOKEN` if you want real issues; without one, issue creation is skipped and the run still posts. A failed issue never fails the run: that action's block goes out without a link, and the other actions keep theirs.

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

## Environment

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes, unless `DRY_RUN=true` | – | Supabase pooler / Postgres connection string |
| `CURSOR_API_KEY` | for analysis | – | Cursor SDK key. Unset falls back to the labeled heuristic |
| `GITHUB_TOKEN` | for issues | – | Set automatically in Actions. Unset skips issue creation |
| `GITHUB_REPOSITORY` | no | `itsmechase15/posthog-competitor-happenings` | `owner/repo` the issues are filed against |
| `SCREENSHOT_URL_TEMPLATE` | no | microlink, then thum.io | Comma-separated renderer templates, tried in order. `{url}` or `{encodedUrl}` becomes the page to screenshot |
| `SLACK_BOT_TOKEN` | for posting | – | Bot token with `chat:write`. Preferred over the webhook |
| `SLACK_CHANNEL_ID` | no | `C0C07A1DM09` | Channel the bot posts to. Ignored by the webhook path |
| `SLACK_WEBHOOK_URL` | no | – | Incoming webhook, used only when there is no bot token |
| `X_BEARER_TOKEN` | no | – | Unset skips the X source |
| `AGENTMAIL_API_KEY` | no | – | Unset skips the newsletter source |
| `AGENTMAIL_INBOX_ID` | no | `chasemccaskill@agentmail.to` | Inbox to read newsletters from |
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
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, or `error` |

## GitHub Actions

[`.github/workflows/daily.yml`](./.github/workflows/daily.yml) runs the cycle daily. GitHub's cron only speaks UTC, so the workflow is scheduled at both 14:00 and 15:00 UTC and the job exits early on whichever one is not 07:00 in `America/Los_Angeles` that day. You can also trigger it manually, with a dry-run checkbox.

[`.github/workflows/force-post.yml`](./.github/workflows/force-post.yml) posts one named item on demand, for proving delivery without waiting for tomorrow. It runs `--url`, so the dedupe table and the seed guard do not apply. Either run it from the Actions tab with a `force_url`, or put the URL in [`.github/force-post-url.txt`](./.github/force-post-url.txt) and merge that to main – changing the file is itself the trigger, which keeps a record of every forced post in the git history. Both workflows share one concurrency group, so a forced post can never race the daily run.

`DATABASE_URL` is optional for the forced post alone: without it the run uses the in-memory store, so the message still goes out but nothing is recorded and the item stays eligible for a normal alert later. The same applies when the database is set but unreachable – the forced post falls back and logs that it left no dedupe trace, rather than dropping a message it had already analyzed. The daily run does neither: it refuses to start without a database and fails on one it cannot reach, because carrying on there would re-alert the whole backlog tomorrow.

It has to be the **pooler** connection string. Supabase's direct host (`db.<ref>.supabase.co`) resolves to IPv6 only, and GitHub Actions runners have no IPv6 route, so a direct URL fails on the runner with `connect ENETUNREACH` while working fine from a dual-stack laptop. The pooler host is dual-stack; a run that hits this says so in its log.

Add these under **Settings → Secrets and variables → Actions**:

Secrets:

- `DATABASE_URL` – Supabase pooler connection string
- `CURSOR_API_KEY`
- `SLACK_BOT_TOKEN` – preferred delivery path
- `SLACK_WEBHOOK_URL` (optional, only used when there is no bot token)
- `X_BEARER_TOKEN` (optional)
- `AGENTMAIL_API_KEY` (optional)

Variables:

- `SLACK_CHANNEL_ID` (optional, defaults to `C0C07A1DM09`)
- `AGENTMAIL_INBOX_ID` (optional, defaults to the inbox in `.env.example`)

`GITHUB_TOKEN` is not on either list: Actions provides it, and the workflow grants it `issues: write`.

The runner uses the bot token rather than the Slack MCP plugin, for the reason in [Slack delivery](#slack-delivery) above.

## How a run works

1. **Refresh the PostHog.com index.** Read `posthog.com`'s sitemap, keep the marketing and docs pages worth citing, and fetch a budgeted slice of them. The canonical product docs in [`src/posthog/products.ts`](./src/posthog/products.ts) are added by hand and sorted first, because they are what a recommendation gets checked against. That catalog tracks the Tools section of [posthog.com/platform.md](https://posthog.com/platform.md), plus the platform surfaces that sit under all of them and still get shipped against by name – [Advanced / proxy](https://posthog.com/docs/advanced/proxy) most of all, because Mixpanel calls it First-Party Domains and nobody calls it a reverse proxy. A surface the catalog does not carry is a recommendation with nothing to check it against. Pages that name Mixpanel or Amplitude have their competitor-mentioning paragraphs stored as `claims`, tagged with the section heading they came from. Half the budget refreshes pages we already know, half reaches ones we have never read, so the comparison pages stay current without starving the tail.
2. **Collect candidates.** Changelog RSS for both competitors, blog posts discovered by diffing each sitemap, the last few posts from each X account, and newsletters from the AgentMail inbox. A source that is unconfigured or throwing is logged and skipped – one broken feed never takes down the run.
3. **Keep only what is new.** Dedupe against `items` on `(competitor, source, external_id)`. Sitemaps bump `lastmod` on site-wide re-renders, so blog novelty is decided by URL, not by date.
4. **Fill in the body.** A sitemap only gives a URL, so new blog items get their article fetched for a real title and body before analysis.
5. **Analyze against the docs.** Each new item goes to `claude-opus-5` through the Cursor SDK with three kinds of context: the claims indexed for that competitor, which find stale marketing copy; the canonical docs for the products the signal touches, which are the only evidence for what PostHog actually ships; and the competitor's own comparison page about PostHog, read fresh once per competitor per run, which is where a claim that PostHog cannot do something turns up. An action may only say PostHog cannot do something when a docs excerpt in front of the model shows that gap, and `verifyAgainstDocs` re-checks the reply: a `consider_building` the docs contradict becomes `consider_enhancing` against the product that already exists, and a gap claim with no docs page behind it gets one or an open question saying it was never verified. When the reply names a product the signal's own words never matched, that product's overview page is read too – at most a couple of pages – so an action is never verified against nothing. Then a page action whose only suggested edits point at docs pages is dropped, because the docs are the evidence and not the job, and `enforceUpdatePagesTopic` checks that every page edit is about the launch itself: a signal about scheduling an experiment stop does not get to send someone off to answer an old "basic A/B testing" claim on the same page, so a page action whose words never touch the launch's own vocabulary is dropped rather than reworded, even when that leaves the alert with no action at all. The reply is parsed and validated into a fixed shape: impact, a one-sentence summary, the key points, one to three actions, an action detail focused on the gap, citations limited to URLs the model was actually given, and any open questions.
6. **Illustrate and file.** Find the feature image, then open one GitHub issue per recommended action, each carrying the long detail for its own job. Both are stored alongside the verdict, so a retry re-posts the same picture and links the same issues instead of opening a second set.
7. **Post.** One Block Kit message per item to `#posthog-competitor-happenings`, then `analyses.slack_posted_at` is stamped so a retry cannot double-post. A post that fails is left unstamped, and the next run picks it up again for up to three days – an item is only ever deduped once, so without that a Slack blip would lose the message for good.

Impact is a label, not a gate. Every new item gets a message; `minor`, `notable`, and `major` just set expectations before you read it.

## Data model

Four tables, defined in [`migrations/001_init.sql`](./migrations/001_init.sql):

- `items` – one row per competitor signal, unique on `(competitor, source, external_id)`
- `analyses` – one row per analyzed item, with the structured verdict as `jsonb`, plus the feature image and one issue per action, in action order. A row written before the split carries a single `issue`, which is read back as the first action's
- `pages` – the PostHog.com pages we have read, and which competitors they mention
- `claims` – the individual competitor-mentioning paragraphs we can cite

The rename from severity to impact needed no migration. The canonical verdict, impact included, lives in the `analysis` jsonb; the legacy `analyses.severity` column keeps getting the impact token so its `NOT NULL` still holds, and nothing reads it back. Rows written before the rename, and any written on the short-lived `low | medium | high` scale, are mapped back onto `minor | notable | major` on the way out.

## Tests

`npm test` covers the parsers against fixture feeds and sitemaps, the analysis response contract (including malformed, camelCase, and pre-rename model output), image extraction and every fallback in the chain, one issue draft per action with its labels and owner, claim extraction from both PostHog's pages and the competitors' compare pages, the relevance guard that keeps a page edit on the launch that found it, dedupe behavior, and the Slack message shape – image first, the one-sentence KNOW, the impact scale, the separate detail bullets, and one stacked block per recommended action with its punctuation and its own issue link. The fixtures under `test/fixtures/` are synthetic and marked as such – they exercise the shapes real feeds use, and are not copies of real competitor announcements.
