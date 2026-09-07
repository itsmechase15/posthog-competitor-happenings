# posthog-competitor-happenings

Daily Slack alerts when Mixpanel or Amplitude ships something, with what PostHog should do about it.

One run, every morning around 7am PT: read the competitors' changelogs, blogs, X accounts and newsletters, keep only what is genuinely new, ask a model what PostHog should do about each one, and post a short Slack message per item. Nothing gets posted twice, and nothing gets posted as raw JSON.

See [PLAN.md](./PLAN.md) for scope, phasing, and the handoff plan.

## Try it without any secrets

```bash
npm install
DRY_RUN=true FORCE_ANALYZE=true POSTHOG_MAX_PAGES=10 MAX_ITEMS_PER_RUN=2 npm run run
```

That hits the live changelogs and sitemaps, indexes a few PostHog.com pages, and prints the Slack payloads it would have sent. Nothing is written and nothing is posted.

Two things degrade gracefully in that mode, and both say so in the log:

- With no `DATABASE_URL`, the run uses an in-memory store. Every item looks new, which is why `FORCE_ANALYZE=true` is needed to get past the first-run guard described below.
- With no `CURSOR_API_KEY`, analysis falls back to restating the source instead of assessing it. Those messages are labelled "Not model-analyzed" so nobody mistakes them for a recommendation.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL`, `SLACK_WEBHOOK_URL`, and `CURSOR_API_KEY`.
3. Apply [`migrations/001_init.sql`](./migrations/001_init.sql) if your database does not already have the four tables. The Supabase project already does.
4. `npm run run`

The first run for each competitor and source records that source's existing backlog without alerting, then exits. That is deliberate: switching on a new source would otherwise fire its entire archive at Slack at once. The second run onwards only alerts on things that appeared since.

## Commands

| Command | What it does |
| --- | --- |
| `npm run run` | One full cycle via `tsx`, no build step |
| `npm run build` | Compile to `dist/` |
| `npm start` | One full cycle from `dist/` |
| `npm run typecheck` | Type-check `src/` and `test/` |
| `npm test` | Unit tests for the parsers, analysis contract, and Slack formatting |

## Environment

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes, unless `DRY_RUN=true` | — | Postgres / Supabase connection string |
| `SLACK_WEBHOOK_URL` | for posting | — | Slack Incoming Webhook. Unset means payloads are printed |
| `CURSOR_API_KEY` | for analysis | — | Cursor SDK key. Unset falls back to the labelled heuristic |
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

- `DATABASE_URL`
- `SLACK_WEBHOOK_URL`
- `CURSOR_API_KEY`
- `X_BEARER_TOKEN` (optional)
- `AGENTMAIL_API_KEY` (optional)

Variables:

- `AGENTMAIL_INBOX_ID` (optional, defaults to the inbox in `.env.example`)

## How a run works

1. **Refresh the PostHog.com index.** Read `posthog.com`'s sitemap, keep the marketing and docs pages worth citing, and fetch a budgeted slice of them. Pages that name Mixpanel or Amplitude have their competitor-mentioning paragraphs stored as `claims`, tagged with the section heading they came from. Half the budget refreshes pages we already know, half reaches ones we have never read, so the comparison pages stay current without starving the tail.
2. **Collect candidates.** Changelog RSS for both competitors, blog posts discovered by diffing each sitemap, the last few posts from each X account, and newsletters from the AgentMail inbox. A source that is unconfigured or throwing is logged and skipped — one broken feed never takes down the run.
3. **Keep only what is new.** Dedupe against `items` on `(competitor, source, external_id)`. Sitemaps bump `lastmod` on site-wide re-renders, so blog novelty is decided by URL, not by date.
4. **Fill in the body.** A sitemap only gives a URL, so new blog items get their article fetched for a real title and body before analysis.
5. **Analyze.** Each new item goes to `claude-opus-5` through the Cursor SDK along with the PostHog claims indexed for that competitor. The reply is parsed and validated into a fixed shape: severity, summary, exactly one action, an action detail focused on the gap, and citations limited to URLs the model was actually given.
6. **Post.** One Block Kit message per item, then `analyses.slack_posted_at` is stamped so a retry cannot double-post.

Severity is a label, not a gate. Every new item gets a message; `minor`, `notable`, and `major` just set expectations before you read it.

## Data model

Four tables, defined in [`migrations/001_init.sql`](./migrations/001_init.sql):

- `items` — one row per competitor signal, unique on `(competitor, source, external_id)`
- `analyses` — one row per analyzed item, with the structured verdict as `jsonb`
- `pages` — the PostHog.com pages we have read, and which competitors they mention
- `claims` — the individual competitor-mentioning paragraphs we can cite

## Tests

`npm test` covers the parsers against fixture feeds and sitemaps, the analysis response contract (including malformed and camelCase model output), claim extraction, dedupe behaviour, and Slack formatting. The fixtures under `test/fixtures/` are synthetic and marked as such — they exercise the shapes real feeds use, and are not copies of real competitor announcements.
