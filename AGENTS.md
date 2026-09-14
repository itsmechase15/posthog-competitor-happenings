# Working on this repo

Notes for a coding agent – Cursor, Claude Code, Codex, or whatever opens this
next. A person reading this is better served by the [README](./README.md).

## What it is

A daily job that reads Mixpanel's and Amplitude's changelogs, blogs, X accounts
and newsletters, asks Opus what PostHog should do about anything new, opens a
GitHub issue per recommended action, and posts one Slack alert per launch. It
runs on GitHub Actions, on a cron, and stores what it has seen in Postgres.

## First job on a fresh clone or fork: the secrets

Nothing works until the keys are in place, so do this before anything else.

1. Run `npm install && npm run check-env -- --strict`. It names every variable
   that is missing, what it is for, and where the value comes from. That output
   is the checklist – do not reconstruct one from memory.
2. **Ask the user for each missing value, one at a time.** They are the only
   source. Do not invent placeholders, do not reuse a value from another
   project, and do not carry on without them and leave a broken cron behind.
3. **Put every value in the repo's Actions secrets, never in the repo.** The
   daily job reads Actions secrets, so a value in a file is both a leak and in
   the wrong place. From a terminal the user is authenticated in:

   ```sh
   gh secret set DATABASE_URL --repo <owner>/<repo>   # prompts, does not echo
   ```

   Or Settings → Secrets and variables → Actions → New repository secret.
   `SLACK_CHANNEL_ID` and `AGENTMAIL_INBOX_ID` are variables, not secrets, and
   neither has a default in the code – a Slack channel id and an inbox address
   belong to whoever is running this, so the app stops or skips the source
   rather than guessing at one. Never reintroduce a personal default for
   either.
4. For a local run only, the same values go in `.env`, which git ignores. Copy
   `.env.example` and fill it in.
5. Confirm it took: Actions → **Check secrets** → Run workflow. It reports what
   is missing and asks Slack whether the bot token can actually post, without
   sending anything to the channel.

### The rule about secret values

Never ask a user to paste a secret into the chat, never write one into a file
you commit, and never print one in a log or a summary. If a value reaches your
context by accident, say so plainly and tell the user to rotate it. Referring to
a secret **by name** – "set `CURSOR_API_KEY`" – is the whole job.

## Running it

| Command | What it does |
| --- | --- |
| `npm run check-env -- --strict` | Name every variable that is missing |
| `DRY_RUN=true FORCE_ANALYZE=true npm run run` | Full pipeline, prints the payloads, posts nothing, writes nothing |
| `npm run run -- --url <url>` | Push one named announcement through the whole pipeline |
| `npm run run -- --check-slack` | Ask Slack what the bot token can do |
| `npm test` / `npm run typecheck` | What CI runs |

Start with the dry run. It needs no secrets at all, hits the live feeds, and is
the fastest way to see what a change does to a message.

## House rules for changes

- **Copy is PostHog copy.** Everything this bot posts follows the
  [docs style guide](https://posthog.com/handbook/wizard-and-docs/docs-style-guide)
  and [tone of voice](https://posthog.com/handbook/brand/tone).
  [`docs/writing.md`](./docs/writing.md) is the short version and says where
  each rule is enforced. The one that catches people out: no em dashes. A dash
  is an en dash with a space either side.
- **A recommendation is a claim about what PostHog ships**, so it is checked
  against the product docs before it is written. See `verifyAgainstDocs` in
  [`src/analysis/verify.ts`](./src/analysis/verify.ts).
- **New environment variable?** Add it to [`src/config.ts`](./src/config.ts),
  [`src/setup/requirements.ts`](./src/setup/requirements.ts), `.env.example`,
  and the workflow that needs it. The requirements list is what `check-env`
  reads, so a variable missing from it is a variable nobody is told about.
- Tests live in `test/`, run with vitest, and the fixtures are synthetic on
  purpose. `npm run typecheck && npm test` before opening a PR.
