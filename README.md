# posthog-competitor-happenings

Daily Slack alerts when Mixpanel or Amplitude ships something, with what PostHog should do about it.

One run, every morning around 7am PT: read the competitors' changelogs, blogs, X accounts and newsletters, keep only what is genuinely new, ask a model what PostHog should do about each one, open a GitHub issue with the detail, and post a short Slack message that links it. Nothing gets posted twice, and nothing gets posted as raw JSON.

See [PLAN.md](./PLAN.md) for scope, phasing, and the handoff plan.

## What a message looks like

Every alert has the same parts, in this order:

1. **A feature image**, always first. The changelog or blog post's own image if it has one, a launch tweet's image, otherwise a screenshot of the feature page. An alert is never posted without one.
2. **What you need to KNOW** — the heading carries the one sentence on what changed. There is no unlabelled line above it competing to be read first.
3. **Impact** — `minor`, `notable`, or `major`, right under that sentence. A label, not a gate: everything new gets a message.
4. **More detail** — two to four short bullets that elaborate on the sentence. Its own heading, so it never reads as a second summary.
5. **Recommended action** — one of four actions plus exactly one sentence.
6. **Access GitHub issue for more information** — the issue opened for this item.
7. **A small footer** — competitor, source, the model that analyzed it, and a link to the source.

PostHog page citations, suggested edits, and open questions are deliberately not in Slack. They are in the issue, which is where someone actually does the work. [`artifacts/slack-test-message.md`](./artifacts/slack-test-message.md) is a real rendered example.

## Try it without any secrets

```bash
npm install
DRY_RUN=true FORCE_ANALYZE=true POSTHOG_MAX_PAGES=10 MAX_ITEMS_PER_RUN=2 npm run run
```

That hits the live changelogs and sitemaps, indexes a few PostHog.com pages, and prints the Slack payloads it would have sent. Nothing is written and nothing is posted.

Two things degrade gracefully in that mode, and both say so in the log:

- With no `DATABASE_URL`, the run uses an in-memory store. Every item looks new, which is why `FORCE_ANALYZE=true` is needed to get past the first-run guard described below.
- With no `CURSOR_API_KEY`, analysis falls back to restating the source instead of assessing it. Those messages are labelled "not model-analyzed" so nobody mistakes them for a recommendation.

A dry run never opens an issue, so the message says why the issue link is missing instead of pretending there is one. That note only ever appears in a dry run.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL` (the Supabase pooler connection string), `CURSOR_API_KEY`, and `SLACK_BOT_TOKEN`.
3. Apply [`migrations/001_init.sql`](./migrations/001_init.sql) if your database does not already have the four tables. The Supabase project already does.
4. `npm run run`

The first run for each competitor and source records that source's existing backlog without alerting, then exits. That is deliberate: switching on a new source would otherwise fire its entire archive at Slack at once. The second run onwards only alerts on things that appeared since.

## Slack delivery

Messages land in the private `#posthog-competitor-happenings` channel, id `C0C07A1DM09`. There are two ways to get them there, and the app picks the first one that is configured:

1. **Bot token (preferred).** Set `SLACK_BOT_TOKEN` and the app calls `chat.postMessage` against `SLACK_CHANNEL_ID`, which defaults to `C0C07A1DM09`. This is the path the daily runner should use. It targets a private channel by id, and when Slack refuses a message it says why — `chat.postMessage` answers HTTP 200 with `{"ok": false, "error": "..."}`, which the app checks and surfaces rather than treating as success.

   The app needs a bot user with `chat:write`, invited to the channel with `/invite @your-app`. Without the invite you get `not_in_channel`.

2. **Incoming webhook (fallback).** Set `SLACK_WEBHOOK_URL` instead if creating a Slack app is more trouble than it is worth. The channel is fixed at the webhook, so `SLACK_CHANNEL_ID` is ignored.

With neither set, the app prints the payloads and says so. Every run logs which path it chose, so a missing secret shows up in the first few lines of the job rather than as silence.

The image is attached as a Block Kit `image` block pointing at a public URL, so no extra Slack scope is needed — `chat:write` is still the whole requirement.

**A note on the Slack MCP plugin.** Posting to this channel was first proven interactively through the Slack MCP plugin connected in Cursor. That is a fine way to test by hand, but the daily GitHub Actions run deliberately does not depend on it — MCP needs a connected client session, and a scheduled runner has none. The bot token is the equivalent capability in a form a cron job can use.

## Commands

| Command | What it does |
| --- | --- |
| `npm run run` | One full cycle via `tsx`, no build step |
| `npm run run -- --url <url>` | Push one named item through the whole pipeline, ignoring dedupe and the seed guard. Add `--out <path>` to save the message |
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

The item still has to exist in a live feed — this mode selects from what the fetchers actually returned, so it cannot manufacture an announcement. It writes both the rendered message and the exact `chat.postMessage` payload. [`artifacts/slack-test-message.md`](./artifacts/slack-test-message.md) is a checked-in example produced this way.

## GitHub issues

Each analyzed item gets an issue in this repo before the Slack message goes out, so the message has something to link. The issue carries what Slack no longer does: the full summary and key points, the impact, the recommended action with all of its detail, the PostHog pages to update as url + claim today + suggested edit, open questions, source links, and the feature image.

It is labelled `competitor-happenings`, the competitor, `source:<source>`, `impact:minor|notable|major`, and `action:<action>`. A label the repo has never seen makes GitHub answer 422, so the app retries once without labels rather than losing the issue.

Inside Actions the workflow's built-in `GITHUB_TOKEN` is enough, with `issues: write` — no new secret. Locally, set a PAT as `GITHUB_TOKEN` if you want real issues; without one, issue creation is skipped and the run still posts. A failed issue never fails the run: the message goes out without the link.

## Feature images

An alert always opens with a picture, tried in this order:

1. Whatever the source attached — an RSS `enclosure` or `media:content`, an image embedded in the entry body, or a launch tweet's photo (or a video's preview frame).
2. The feature page's own `og:image` / `twitter:image`, then in-content screenshots. Logos, icons, sprites, tracking pixels, tiny images, and SVGs are filtered out, and a site-wide brand card like `amplitude-default-seo.png` is pushed behind a real screenshot rather than used as the feature image.
3. A screenshot of the feature page, rendered by the service in `SCREENSHOT_URL_TEMPLATE`. This is how the "screenshot the page" step happens without shipping a browser into the daily job, and Slack needs a public URL anyway.
4. A generated card naming the competitor and the feature. Never pretty, but the message always has a valid image block.

Every candidate is checked with a `HEAD` request first, so a 404 or an HTML error page never reaches Slack as an image.

## Environment

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes, unless `DRY_RUN=true` | — | Supabase pooler / Postgres connection string |
| `CURSOR_API_KEY` | for analysis | — | Cursor SDK key. Unset falls back to the labelled heuristic |
| `GITHUB_TOKEN` | for issues | — | Set automatically in Actions. Unset skips issue creation |
| `GITHUB_REPOSITORY` | no | `itsmechase15/posthog-competitor-happenings` | `owner/repo` the issues are filed against |
| `SCREENSHOT_URL_TEMPLATE` | no | thum.io renderer | URL template whose `{url}` becomes the page to screenshot |
| `SLACK_BOT_TOKEN` | for posting | — | Bot token with `chat:write`. Preferred over the webhook |
| `SLACK_CHANNEL_ID` | no | `C0C07A1DM09` | Channel the bot posts to. Ignored by the webhook path |
| `SLACK_WEBHOOK_URL` | no | — | Incoming webhook, used only when there is no bot token |
| `X_BEARER_TOKEN` | no | — | Unset skips the X source |
| `AGENTMAIL_API_KEY` | no | — | Unset skips the newsletter source |
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

Add these under **Settings → Secrets and variables → Actions**:

Secrets:

- `DATABASE_URL` — Supabase pooler connection string
- `CURSOR_API_KEY`
- `SLACK_BOT_TOKEN` — preferred delivery path
- `SLACK_WEBHOOK_URL` (optional, only used when there is no bot token)
- `X_BEARER_TOKEN` (optional)
- `AGENTMAIL_API_KEY` (optional)

Variables:

- `SLACK_CHANNEL_ID` (optional, defaults to `C0C07A1DM09`)
- `AGENTMAIL_INBOX_ID` (optional, defaults to the inbox in `.env.example`)

`GITHUB_TOKEN` is not on either list: Actions provides it, and the workflow grants it `issues: write`.

The runner uses the bot token rather than the Slack MCP plugin, for the reason in [Slack delivery](#slack-delivery) above.

## How a run works

1. **Refresh the PostHog.com index.** Read `posthog.com`'s sitemap, keep the marketing and docs pages worth citing, and fetch a budgeted slice of them. Pages that name Mixpanel or Amplitude have their competitor-mentioning paragraphs stored as `claims`, tagged with the section heading they came from. Half the budget refreshes pages we already know, half reaches ones we have never read, so the comparison pages stay current without starving the tail.
2. **Collect candidates.** Changelog RSS for both competitors, blog posts discovered by diffing each sitemap, the last few posts from each X account, and newsletters from the AgentMail inbox. A source that is unconfigured or throwing is logged and skipped — one broken feed never takes down the run.
3. **Keep only what is new.** Dedupe against `items` on `(competitor, source, external_id)`. Sitemaps bump `lastmod` on site-wide re-renders, so blog novelty is decided by URL, not by date.
4. **Fill in the body.** A sitemap only gives a URL, so new blog items get their article fetched for a real title and body before analysis.
5. **Analyze.** Each new item goes to `claude-opus-5` through the Cursor SDK along with the PostHog claims indexed for that competitor. The reply is parsed and validated into a fixed shape: impact, a one-sentence summary, the key points, exactly one action, an action detail focused on the gap, citations limited to URLs the model was actually given, and any open questions.
6. **Illustrate and file.** Find the feature image, then open the GitHub issue that carries the long detail. Both are stored alongside the verdict, so a retry re-posts the same picture and links the same issue instead of opening a second one.
7. **Post.** One Block Kit message per item to `#posthog-competitor-happenings`, then `analyses.slack_posted_at` is stamped so a retry cannot double-post. A post that fails is left unstamped, and the next run picks it up again for up to three days — an item is only ever deduped once, so without that a Slack blip would lose the message for good.

Impact is a label, not a gate. Every new item gets a message; `minor`, `notable`, and `major` just set expectations before you read it.

## Data model

Four tables, defined in [`migrations/001_init.sql`](./migrations/001_init.sql):

- `items` — one row per competitor signal, unique on `(competitor, source, external_id)`
- `analyses` — one row per analyzed item, with the structured verdict as `jsonb`, plus the feature image and the issue it was posted with
- `pages` — the PostHog.com pages we have read, and which competitors they mention
- `claims` — the individual competitor-mentioning paragraphs we can cite

The rename from severity to impact needed no migration. The canonical verdict, impact included, lives in the `analysis` jsonb; the legacy `analyses.severity` column keeps getting the impact token so its `NOT NULL` still holds, and nothing reads it back. Rows written before the rename, and any written on the short-lived `low | medium | high` scale, are mapped back onto `minor | notable | major` on the way out.

## Tests

`npm test` covers the parsers against fixture feeds and sitemaps, the analysis response contract (including malformed, camelCase, and pre-rename model output), image extraction and every fallback in the chain, the GitHub issue draft, claim extraction, dedupe behaviour, and the Slack message shape — image first, the one-sentence KNOW, the impact scale, the separate detail bullets, the one-sentence action, and the issue link. The fixtures under `test/fixtures/` are synthetic and marked as such — they exercise the shapes real feeds use, and are not copies of real competitor announcements.
