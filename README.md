# posthog-competitor-happenings

This bot posts to `#posthog-competitor-happenings` when Mixpanel or Amplitude
ships something.

It reads both competitors' changelogs, their blogs, their X accounts, and a
newsletter inbox. One run, every morning around 7am PT. Anything new goes to
Opus with PostHog's own docs in front of it, and comes back as one to three
recommended actions: enhance a PostHog product, build one, or fix a page that
is now wrong.

Each action opens its own GitHub issue, and the Slack message links it. Nothing
is posted twice, and nothing is posted as raw JSON.

Competitor launches are easy to miss and expensive to miss. A compare page that
says Amplitude cannot do something they shipped last week is worse than no
compare page, and nobody finds that by reading changelogs on a Tuesday.

Each alert reads:

```
──────────────────────────────
Amplitude · Schedule experiment stop

[ a screenshot of the feature page ]

What you need to KNOW
Amplitude: You can now schedule when an experiment or flag stops, not just
when it starts. (changelog)

Impact  🟠 Notable

More detail
• Set a start time, an end time, or both.

Recommended action(s)

Consider enhancing Experiments
Add a scheduled stop time to Experiments so a test ends on its own.
Access GitHub issue #41

Update pages
Update the Amplitude compare page, which says scheduling is start-only.
Access GitHub issue #42

Amplitude · changelog · analyzed with claude-opus-5 · source
```

[`artifacts/slack-test-message.md`](./artifacts/slack-test-message.md) is a real
rendered message, with the exact `chat.postMessage` payload under it.

## What a Slack alert contains

Every alert has the same parts, in this order:

1. **A divider and a header.** `Amplitude · Schedule experiment stop`. Slack
   collapses consecutive messages from the same bot, so without a break the
   second alert of a morning reads as more of the first one. `alertBreakBlocks`
   in [`src/slack/message.ts`](./src/slack/message.ts) builds both blocks, and
   nothing else depends on them.
2. **A feature image**, first under the break. See [The pictures](#the-pictures).
3. **What you need to KNOW.** One sentence on what changed, with the source
   hanging off the end as a linked `changelog`, `article`, or `tweet`. The tag
   names the thing you land on, so anything published on the competitor's own
   site is an `article`, whether it is a launch write-up or a recap of a panel
   they hosted. The footer links the source too, but that is the last line.
   This one lets you open the change as soon as you have read what happened. A
   newsletter gets no link, because its only URL is a thread in our own inbox,
   and `newsletter` is the tag it carries everywhere else.
4. **Impact.** `minor`, `notable`, or `major`. A label, not a gate. Every new
   item gets a message. One question decides the label: what did the post ship?
   A brand-new feature is major, an enhancement of a feature they already had
   is notable, and a post with neither in it is minor. See
   [How impact is rated](#how-impact-is-rated).
5. **More detail.** Two to four short bullets under their own heading, so it
   never reads as a second summary.
6. **Recommended action(s).** Each action is its own block: a bold title, one
   short sentence, and a link to that action's issue. The sentence leads with
   the work, because it is the only line the reader gets. "Consider enhancing"
   names the PostHog feature and links its product page when
   [`src/posthog/products.ts`](./src/posthog/products.ts) has a checked URL.
7. **A footer.** Competitor, source, the model that analyzed it, and the link.

There is no single issue link for the whole alert. Three actions means three
issues and three links. The work lands on different desks.

Page citations, suggested edits, and open questions are deliberately not in
Slack. They are in the issue, which is where someone does the work.

The copy follows PostHog's
[docs style guide](https://posthog.com/handbook/wizard-and-docs/docs-style-guide)
and [tone of voice](https://posthog.com/handbook/brand/tone).
[`docs/writing.md`](./docs/writing.md) is the short version and says where each
rule is enforced. The one to know: dashes are en dashes with a space either
side, never em dashes.

## How impact is rated

Impact answers one question: what did this post ship?

| Impact | The post is about | Example |
| --- | --- | --- |
| 🔵 Minor | No new feature and no enhancement | A hiring post, a pricing rewrite, a quarterly recap |
| 🟠 Notable | An enhancement of a feature they already had | A scheduled stop time on experiments they already ship |
| 🔴 Major | A brand-new feature they did not have before | Serving events through the customer's own domain |

Nothing else moves it. Not how strategic the launch feels, not whether PostHog
has a gap here, not how loudly it was written up. A post that mixes a new
feature with company news is rated on the feature, because impact follows the
strongest thing in the post and fluff never pulls it down.

The rule lives in `SYSTEM_RULES` in
[`src/analysis/prompt.ts`](./src/analysis/prompt.ts), which is what the model
reads. The heuristic in [`src/analysis/fallback.ts`](./src/analysis/fallback.ts)
approximates it from the words a launch post uses, for runs with no
`CURSOR_API_KEY`.

## How a recommendation is decided

A launch is easy to summarize. Saying what PostHog should do about it is the
part that can be wrong, and a wrong one wastes somebody's afternoon.

Each new item goes to `claude-opus-5` through the Cursor SDK with three kinds
of context: the claims indexed from PostHog's own pages, which find stale
marketing copy; the canonical docs for the products the signal touches, which
are the only evidence for what PostHog ships; and the competitor's own compare
page about PostHog, read fresh once per competitor per run.

The reply is parsed into a fixed shape – impact, one sentence, key points, one
to three actions, citations limited to URLs the model was given, and any open
questions. Then three guards run over it.

**Actions come in four types**, and the type decides who owns the issue:

| Action | Means | Owner |
| --- | --- | --- |
| `consider_enhancing` | PostHog has this, and the launch beats it. Names the feature | Product |
| `consider_building` | PostHog has nothing like it | Product |
| `update_pages` | A PostHog page is now wrong, understated, or unanswered | Marketing |
| `new_compare_page` | There is no page covering this comparison at all | Marketing |

**A gap has to be shown in the docs.** An action may only say PostHog cannot do
something when a docs excerpt in front of the model shows that gap.
`verifyAgainstDocs` in [`src/analysis/verify.ts`](./src/analysis/verify.ts)
re-checks the reply. A `consider_building` the docs contradict becomes a
`consider_enhancing` against the product that already exists. A gap claim with
no docs page behind it gets one, or an open question saying it was never
verified. When the reply names a product the signal's own words never matched,
that product's overview page is read too, so an action is never verified
against nothing.

**A page edit has to be about the launch that found it.** "Customers might ask"
and "the page could be stronger" are not reasons. `enforceUpdatePagesTopic`
drops a page action whose words never touch the launch's own vocabulary, even
when that leaves the alert with no action at all. A signal about scheduling an
experiment stop does not get to send someone off to answer an old "basic A/B
testing" claim on the same page.

**Page actions never target a docs page.** Marketing writes compare pages,
product marketing pages, blog posts, and pricing. `isMarketingTarget` in
[`src/posthog/pages.ts`](./src/posthog/pages.ts) is the whole rule, enforced
three times over: a page action whose only suggested edits are docs pages is
dropped, the sentence Slack shows never opens on a docs URL, and the
pages-to-update list holds only pages someone would edit. The docs still go
into the analysis context, and product issues still cite them. Reading a page
and editing it are not the same permission.

Last, `enforceActionLead` makes each surviving action open with the work rather
than the gap behind it.

**Without `CURSOR_API_KEY` the bot still posts.** Analysis falls back to
restating the source, and those messages are labeled "not model-analyzed" so
nobody mistakes one for a recommendation.

## Where the signals come from

Four sources, all in [`src/sources/`](./src/sources). The first two need no key.

**Changelogs.** The RSS feeds at
[docs.mixpanel.com/changelogs](https://docs.mixpanel.com/changelogs/rss.xml) and
[amplitude.com/releases](https://amplitude.com/releases/feed.xml). This is the
source that carries most days.

**Blogs.** Each competitor's sitemap, diffed run over run, filtered to `/blog/`
paths. A new URL gets its article fetched for a title and a body. Sitemaps bump
`lastmod` on site-wide re-renders, so blog novelty is decided by URL, not date.

**X.** The last ten posts from `@mixpanel` and `@Amplitude_HQ`, which is where a
launch often lands before the changelog catches up, and where the launch image
usually is. Needs `X_BEARER_TOKEN`. Unset, the source is skipped with a log
line and the run carries on.

**Newsletters.** Product update emails go to an [AgentMail](https://agentmail.to)
inbox that exists only for this. Mail is read over the API, not IMAP, so the
daily job needs nothing but a key. Each run asks for up to 50 messages newer
than `LOOKBACK_DAYS` and keeps only the ones whose subject, preview, or sender
names a competitor – `routeMessage` in
[`src/sources/agentmail.ts`](./src/sources/agentmail.ts). Signup confirmations
and the rest of the noise cost nothing.

A source that is unconfigured or throwing is logged and skipped. One broken
feed never takes down the run.

## The issues

Each recommended action gets its own issue in this repo, opened before the
Slack message goes out so every action has something to link.

An issue is titled `Competitor: feature – Action` and carries what Slack no
longer does: that action in full, the summary and key points, the impact, open
questions, source links, and the feature image. Impact is written as the whole
scale, a task list of `Minor`, `Notable`, `Major` with this alert's level
checked and each level carrying what it means, so a reader sees where it sits,
and why, without holding the scale in their head.

Marketing's issues get the PostHog pages to update as url + claim today +
suggested edit. Product's get only the docs that back the action they are being
asked to take: no suggested edits, no compare-page copy, and no docs page for a
product some other action in the same alert named. Nothing lists the sibling
actions, because each one is its own issue.

A product issue ends with **Docs that would change if this ships**. Those are
the same pages the issue already cites as evidence, read the other way round:
today they say what PostHog does, and the day PostHog does this instead,
someone has to rewrite them. Nothing new is fetched to build the list.

Labels: `competitor-happenings`, the competitor, `source:<source>`,
`impact:<level>`, `action:<action>`, `owner:marketing|product`, one
`team:<slug>` per related team, and `product:<feature>` when the action names a
product the catalog recognizes. A feature name the catalog does not know gets
no label, because a repo full of one-off labels nobody queries is worse than
none. A label the repo has never seen makes GitHub answer 422, so the app
retries once without labels rather than losing the issue.

Inside Actions the built-in `GITHUB_TOKEN` is enough, with `issues: write`. No
new secret. A failed issue never fails the run: that action's block goes out
without a link, and the other actions keep theirs.

### Related team(s)

Every issue names the PostHog small teams the work is for: `Experiments`,
`Ingestion, Client Libraries`, `Marketing 🦆, Growth 🦦`. Not "Product and
Engineering". PostHog is organized into small teams that each own particular
features, so a department names nobody.

[`src/posthog/teams.ts`](./src/posthog/teams.ts) is the catalog: every team on
[posthog.com/teams](https://posthog.com/teams), with its slug, the features its
page says it owns, the vocabulary of its work, and its spirit animal. The
animal is a real field on the team's page, and only some teams have picked one.
A team that has not gets no emoji rather than an invented one.

[`src/teams.ts`](./src/teams.ts) does the routing, and **the model chooses.**
The prompt gives it every team name and what each one owns, and a list it wrote
wins outright once each name is found in the catalog. `Product`, `Engineering`,
and `Platform` are thrown away rather than mapped to something near them, which
is why the fallback has to be good. Falling through, strongest first:

1. **Who owns the feature.** The team whose page says it owns the feature the
   action names, plus the owners of the products the action's words match. 18
   of the 21 entries in [`src/posthog/products.ts`](./src/posthog/products.ts)
   carry an owner.
2. **Team vocabulary** in the action's feature and detail, for a signal that
   names no product we recognize.
3. **A default**, and only when both found nothing: Marketing for page work,
   Product Analytics for product work.

There is always at least one team and never more than three.

## The pictures

An alert always opens with a picture, tried in this order:

1. Whatever the source attached – an RSS `enclosure` or `media:content`, an
   image in the entry body, or a launch tweet's photo.
2. The feature page's own `og:image` / `twitter:image`, then in-content
   screenshots. Logos, icons, sprites, tracking pixels, tiny images, and SVGs
   are filtered out. A site-wide brand card like `amplitude-default-seo.png` is
   pushed behind a real screenshot rather than used as the feature image.
3. A screenshot of the feature page, rendered by a service in
   `SCREENSHOT_URL_TEMPLATE`. This is how "screenshot the page" happens without
   shipping a browser into the daily job, and Slack needs a public URL anyway.
4. A generated card naming the competitor and the feature. Never pretty, but
   the message always has a valid image block.

Every candidate gets a `HEAD` request first, so a 404 or an HTML error page
never reaches Slack as an image. The image is a Block Kit `image` block
pointing at a public URL, so `chat:write` is still the whole Slack scope.

Mixpanel's changelog is one page with an `#anchor` per release, and its RSS
points every entry at that page. Step 2 is skipped for those: the page's
`og:image` is a Mintlify card that reads "Changelogs" whatever shipped, and the
pictures on the page belong to the other releases. So an anchored entry goes
straight to a screenshot of its own anchor.

Keeping the anchor takes some care. `normalizeUrl` strips fragments so one page
dedupes to one URL, so [`src/sources/rss.ts`](./src/sources/rss.ts) keeps the
anchored link in `raw.entryUrl`, and [`entryUrl`](./src/sources/link.ts) is
what the image, the KNOW link, the footer, and the issue all read. A raw `#`
never survives a request, so a renderer only sees it through the `{encodedUrl}`
placeholder. `SCREENSHOT_URL_TEMPLATE` defaults to microlink then thum.io:
microlink honors an anchor, and thum.io has no daily quota, so it stands behind
it for a day microlink turns us down.

## How it works

[`.github/workflows/daily.yml`](./.github/workflows/daily.yml) runs the bot
every morning. One run does 7 steps:

1. **Refresh the PostHog.com index.** Read the sitemap, keep the marketing and
   docs pages worth citing, and fetch a budgeted slice of them. The canonical
   product docs in [`src/posthog/products.ts`](./src/posthog/products.ts) are
   added by hand and sorted first, because they are what a recommendation gets
   checked against. Pages that name Mixpanel or Amplitude have their
   competitor-mentioning paragraphs stored as `claims`. Half the budget
   refreshes pages we know, half reaches pages we have never read.
2. **Collect candidates** from the four sources.
3. **Keep only what is new.** Dedupe against `items` on
   `(competitor, source, external_id)`.
4. **Fill in the body.** A sitemap only gives a URL, so a new blog item gets its
   article fetched for a real title and body before analysis.
5. **Analyze against the docs.** See
   [How a recommendation is decided](#how-a-recommendation-is-decided).
6. **Illustrate and file.** Find the feature image, then open one GitHub issue
   per recommended action. Both are stored alongside the verdict, so a retry
   re-posts the same picture and links the same issues instead of opening a
   second set.
7. **Post.** One Block Kit message per item, then `analyses.slack_posted_at` is
   stamped so a retry cannot double-post. A post that fails is left unstamped
   and the next run picks it up again for up to three days. An item is only
   ever deduped once, so without that a Slack blip would lose the message for
   good.

GitHub's cron only speaks UTC, so the workflow is scheduled at both 14:00 and
15:00 UTC and the job exits early on whichever one is not 07:00 in
`America/Los_Angeles` that day.

Two caps keep a bad morning from becoming a flood: `MAX_ITEMS_PER_SOURCE` (8)
on what one competitor and source can contribute, and `MAX_ITEMS_PER_RUN` (12)
on Slack messages from one run.

The first run for each competitor and source records that source's existing
backlog without alerting, then exits. This is correct. Switching on a new
source would otherwise fire its whole archive at Slack at once. The run after
that one posts as normal.

## Files

| Path | Purpose |
| --- | --- |
| `src/index.ts` | The CLI. One cycle, `--url`, `--check-slack`, `--out`. |
| `src/pipeline.ts` | The run order. It calls the other modules. |
| `src/config.ts` | Every environment variable, read once. |
| `src/sources/` | Changelog RSS, blog sitemaps, X, and AgentMail. |
| `src/posthog/` | The posthog.com index, the product catalog, the team catalog. |
| `src/analysis/` | The prompt, the reply schema, and the three guards. |
| `src/teams.ts` | Routes an action to PostHog's small teams. |
| `src/media/image.ts` | The feature image chain. |
| `src/github/issue.ts` | One issue draft per action, with its labels. |
| `src/slack/message.ts` | The Block Kit message. **Change this for a redesign.** |
| `src/slack/post.ts` | `chat.postMessage`, the webhook fallback, and `--check-slack`. |
| `src/setup/requirements.ts` | Every variable, what it is for, where the value comes from. `check-env` reads this. |
| `migrations/001_init.sql` | The four tables. |
| `docs/writing.md` | The copy rules, and where each one is enforced. |
| `AGENTS.md` | Notes for a coding agent, including the rules about keys. |
| `.env.example` | The shape of every variable. Never a value. |
| `test/` | Unit tests and synthetic fixtures. |

## Setup

Ten minutes, most of it in other people's dashboards. `npm run check-env --
--strict` names everything you have not done yet, at any point, and says where
each value comes from. Run it whenever you are lost.

Add these under **Settings → Secrets and variables → Actions → Secrets**:

| Secret | Needed for | Where the value comes from |
| --- | --- | --- |
| `DATABASE_URL` | Everything. The daily run refuses to start without it | Supabase → Project Settings → Database → Connection string → Session pooler |
| `CURSOR_API_KEY` | The Opus analysis. Without it, alerts restate the source | cursor.com/dashboard → Integrations → API Keys |
| `SLACK_BOT_TOKEN` | Posting. `xoxb-`, with `chat:write`, invited to the channel | api.slack.com/apps → OAuth & Permissions |
| `X_BEARER_TOKEN` | The X source. Unset skips it | developer.x.com → Keys and tokens → Bearer Token |
| `AGENTMAIL_API_KEY` | The newsletter source. Unset skips it | agentmail.to → dashboard → API keys |
| `SLACK_WEBHOOK_URL` | Optional fallback delivery, only read when there is no bot token | api.slack.com/apps → Incoming Webhooks |

And these under **Variables**, because neither is a credential. Both are yours,
and neither has a default – the app would rather stop than post into somebody
else's channel or read somebody else's inbox:

| Variable | Needed for | What it is |
| --- | --- | --- |
| `SLACK_CHANNEL_ID` | Posting with a bot token | The channel the bot posts to, the `C0…` id from **View channel details**. Nothing is delivered until it is set |
| `AGENTMAIL_INBOX_ID` | The newsletter source | The inbox newsletters are read from, like `name@agentmail.to`. Unset skips the source |

Either one is also accepted as a **secret** of the same name, because both are
easy to reach for as one. Every workflow reads the variable first and falls back
to the secret, so it does not matter which home you pick – only that one of them
has a value.

`GITHUB_TOKEN` is on neither list. Actions provides it, and the workflows grant
it `issues: write`, which is all issue creation needs.

### Create the Slack app

Slack does not let an automated job create an app, so a person with workspace
permissions does this once:

1. Go to <https://api.slack.com/apps> and select **Create New App**.
2. **OAuth & Permissions** → add the `chat:write` bot scope.
3. **Install to Workspace**, then copy the **Bot User OAuth Token** (`xoxb-...`)
   into `SLACK_BOT_TOKEN`.
4. In Slack, invite the app to the channel: `/invite @your-app`. Every post
   fails with `not_in_channel` if you skip this step.
5. Open the channel → **View channel details** → copy the `C0…` id into the
   `SLACK_CHANNEL_ID` variable. There is no default channel, so a bot token
   without this one stops the run rather than guessing.

A missing scope answers `missing_scope`. Fix it by adding the scope,
reinstalling the app, and copying the new token into the secret. Reinstalling
issues a new token, so the secret has to be updated too.

An incoming webhook works as a fallback, and `SLACK_WEBHOOK_URL` is read only
when there is no bot token. It is worse: the channel is fixed at the webhook,
so `SLACK_CHANNEL_ID` is ignored, and a webhook cannot tell you why Slack
refused a message. `chat.postMessage` answers HTTP 200 with
`{"ok": false, "error": "..."}`, which the app checks and surfaces.

### Create the AgentMail inbox

The newsletters need an address of their own, because a personal inbox cannot
be read by a cron job.

1. Create an inbox in the [AgentMail](https://agentmail.to) dashboard. You get
   an address like `name@agentmail.to`.
2. Copy an API key from the same dashboard into `AGENTMAIL_API_KEY`, and the
   address into the `AGENTMAIL_INBOX_ID` variable. Both, or the source is
   skipped – there is no default inbox to read instead.
3. Subscribe that address to both competitors' product update lists, from the
   signup forms on their own sites.
4. Open the inbox and click through the confirmation mail. Most of them double
   opt-in, and an unconfirmed subscription is a source that never delivers.

### The database has to be the pooler URI

Supabase's direct host (`db.<ref>.supabase.co`) resolves to IPv6 only, and
GitHub Actions runners have no IPv6 route. A direct URI therefore works fine
from a dual-stack laptop and fails on every scheduled run with
`connect ENETUNREACH`. Take the **Session pooler** string instead. `check-env`
catches that one by sight, before a run spends twenty minutes finding out.

Apply [`migrations/001_init.sql`](./migrations/001_init.sql) to create the four
tables.

### Keys live in Actions, never in the repo

The daily job reads Actions secrets. That is the only place a value belongs.
Nothing here reads a checked-in key, `.env` is in `.gitignore`, and
`.env.example` carries the shape of each variable and where to get it, never a
value.

For a local run, copy `.env.example` to `.env` and fill it in. On the command
line, `gh secret set DATABASE_URL` prompts for the value without echoing it,
which beats pasting it anywhere it can be scrolled back to.

If you are setting this up with a coding agent, [AGENTS.md](./AGENTS.md) and
[`.cursor/rules/setup-secrets.mdc`](./.cursor/rules/setup-secrets.mdc) tell it
to run `check-env`, prompt you for each missing value, and put them in Actions.
Not to ask you to paste them into a chat, and not to write one into a file. A
secret that reaches an agent's context is a secret to rotate.

## Turn it on, in this order

1. Create the Slack app, install it, and copy the bot token.
2. Invite the app to the channel, and copy the channel id.
3. Create the database, apply the migration, and take the pooler URI.
4. Add the secrets and the two variables.
5. **Merge this to main.** GitHub lists a `workflow_dispatch` workflow only
   when the file is on the default branch, and a schedule only runs there. You
   cannot test the bot from a branch.
6. Open the **Actions** tab. Run **Check secrets**, with `strict` ticked. It
   names anything missing, then asks Slack what the bot token can actually do.
   It posts nothing.
7. Run **Daily competitor happenings** with `dry_run` ticked. The bot reads the
   live feeds and prints the payloads it would have sent.
8. Run **Force post one item** with a URL from a live changelog. See below for
   why this step exists.
9. Run **Daily competitor happenings** for real. It records each source's
   backlog and posts nothing. Run it a second time, or wait for tomorrow's
   cron, and only things that appeared since get a message.

## Prove the Slack path with a forced post

The bot stays quiet until a competitor ships, which can take days. The first
real alert would therefore also be the first test of the Slack path. A wrong
channel id, a missing scope, or an app that was never invited would sit
unnoticed until then.

[`force-post.yml`](./.github/workflows/force-post.yml) closes that gap. It
pushes one named announcement through the whole pipeline, ignoring the dedupe
table and the first-run seed guard, and it runs `--check-slack` first, so a
token that cannot deliver fails before a GitHub issue is opened for a message
nobody will see.

Two ways in:

- Actions → **Force post one item** → **Run workflow**, with a `force_url`.
- Put the URL in [`.github/force-post-url.txt`](./.github/force-post-url.txt)
  and merge it to main. Changing the file is itself the trigger, which leaves a
  record of every forced post in the git history.

The item still has to exist in a live feed. This mode selects from what the
fetchers returned, so it cannot manufacture an announcement.

`DATABASE_URL` is optional for the forced post alone. Without it the run uses
the in-memory store, so the message still goes out but nothing is recorded and
the item stays eligible for a normal alert later. The daily run refuses to
start without a database and fails on one it cannot reach, because carrying on
there would re-alert the whole backlog tomorrow.

A dry run cannot do this job. A dry run posts nothing to Slack at all.

Both workflows share one concurrency group, so a forced post can never race the
daily run.

## The workflows

| Workflow | Trigger | What it does |
| --- | --- | --- |
| [`daily.yml`](./.github/workflows/daily.yml) | Cron, or Run workflow with a dry-run checkbox | The full cycle |
| [`force-post.yml`](./.github/workflows/force-post.yml) | Run workflow with a URL, or a commit to `.github/force-post-url.txt` | One named item, straight to Slack |
| [`check-secrets.yml`](./.github/workflows/check-secrets.yml) | Run workflow | Names missing secrets and asks Slack what the token can do. Posts nothing |
| [`ci.yml`](./.github/workflows/ci.yml) | Push and pull request | Typecheck, tests, build |

Both `daily.yml` and `force-post.yml` run `check-env` before the pipeline. A
secret that expired or was never set fails in the first few seconds, naming the
variable, rather than twenty minutes in as a database timeout.

Run **Check secrets** after a fork, and any time an alert stops arriving. It
reports which secrets are set, never their values.

## Configuration

Every variable, what it defaults to, and what it is for.
[`src/setup/requirements.ts`](./src/setup/requirements.ts) is the
machine-readable version of the top of this table, and it is what `check-env`
reads. A variable missing from it is a variable nobody is told about.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes, unless `DRY_RUN=true` | – | Supabase pooler / Postgres connection string |
| `CURSOR_API_KEY` | for analysis | – | Cursor SDK key. Unset falls back to the labeled heuristic |
| `SLACK_BOT_TOKEN` | for posting | – | Bot token with `chat:write`. Preferred over the webhook |
| `SLACK_CHANNEL_ID` | with a bot token | – | Channel the bot posts to, as a `C0…` id. Ignored by the webhook path |
| `SLACK_WEBHOOK_URL` | no | – | Incoming webhook, used only when there is no bot token |
| `X_BEARER_TOKEN` | no | – | Unset skips the X source |
| `AGENTMAIL_API_KEY` | no | – | Unset skips the newsletter source |
| `AGENTMAIL_INBOX_ID` | with an AgentMail key | – | Inbox to read newsletters from. Unset skips the source |
| `GITHUB_TOKEN` | for issues | – | Set automatically in Actions. `GH_TOKEN` is read as a fallback. Unset skips issue creation |
| `GITHUB_REPOSITORY` | no | `itsmechase15/posthog-competitor-happenings` | `owner/repo` the issues are filed against. Actions sets it to the running repo |
| `SCREENSHOT_URL_TEMPLATE` | no | microlink, then thum.io | Comma-separated renderer templates, tried in order. `{url}` or `{encodedUrl}` becomes the page to screenshot |

And the tuning, which is right by default:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DRY_RUN` | `false` | Print Slack payloads, skip every database write |
| `FORCE_ANALYZE` | `false` | Analyze the first-run backlog instead of recording it. Rejected unless `DRY_RUN=true` |
| `CURSOR_MODEL` | `claude-opus-5` | Model id passed to the Cursor SDK |
| `CURSOR_RUNTIME` | `local` | `local` runs the agent in-process; `cloud` uses a no-repo cloud agent |
| `LOOKBACK_DAYS` | `7` | Items older than this are ignored |
| `MAX_ITEMS_PER_RUN` | `12` | Hard cap on Slack messages from one run |
| `MAX_ITEMS_PER_SOURCE` | `8` | Hard cap on new items from one competitor + source |
| `POSTHOG_MAX_PAGES` | `60` | PostHog.com pages fetched per run |
| `POSTHOG_REFRESH_DAYS` | `14` | How stale an indexed page gets before it is re-read |
| `SKIP_POSTHOG_INDEX` | `false` | Skip the crawl for a faster local run |
| `HTTP_TIMEOUT_MS` | `20000` | Per-request timeout |
| `USER_AGENT` | `posthog-competitor-happenings/0.1` | Sent on every outbound request |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error` |

## State

The bot keeps what it has seen in Postgres. Four tables, defined in
[`migrations/001_init.sql`](./migrations/001_init.sql):

- `items` – one row per competitor signal, unique on
  `(competitor, source, external_id)`. This is the dedupe key.
- `analyses` – one row per analyzed item, with the verdict as `jsonb`, the
  feature image, and one issue per action, in action order.
- `pages` – the PostHog.com pages we have read, and which competitors they
  mention.
- `claims` – the individual competitor-mentioning paragraphs we can cite.

An item is only ever deduped once, which is why a failed post is retried for
three days rather than dropped.

The rename from severity to impact needed no migration. The canonical verdict
lives in the `analysis` jsonb; the legacy `analyses.severity` column keeps
getting the impact token so its `NOT NULL` still holds, and nothing reads it
back. Rows written before the rename, and any on the short-lived
`low | medium | high` scale, are mapped back onto `minor | notable | major` on
the way out.

## Run it on your machine

The bot needs Node 22.13 or later. No secrets, no database:

```sh
npm install
DRY_RUN=true FORCE_ANALYZE=true POSTHOG_MAX_PAGES=10 MAX_ITEMS_PER_RUN=2 npm run run
```

That hits the live changelogs and sitemaps, indexes a few PostHog.com pages,
and prints the Slack payloads it would have sent. Nothing is written and
nothing is posted.

Two things degrade in that mode, and both say so in the log. With no
`DATABASE_URL` the run uses an in-memory store, so every item looks new, which
is why `FORCE_ANALYZE=true` is needed to get past the first-run guard. With no
`CURSOR_API_KEY` analysis falls back to restating the source. A dry run never
opens an issue, so the message says why the issue links are missing instead of
pretending there are some.

To see what one specific announcement produces:

```sh
npm run run -- \
  --url https://amplitude.com/releases/schedule-experiment-stop \
  --out artifacts/slack-test-message.md
```

That writes both the rendered message and the exact `chat.postMessage` payload.

| Command | What it does |
| --- | --- |
| `npm run check-env` | Name every required variable that is missing, and where its value comes from. `-- --strict` includes the optional sources |
| `npm run run` | One full cycle via `tsx`, no build step |
| `npm run run -- --url <url>` | Push one named item through the whole pipeline, ignoring dedupe and the seed guard |
| `npm run run -- --check-slack` | Ask Slack what `SLACK_BOT_TOKEN` is and which scopes it carries. Exits non-zero if it cannot post |
| `npm run build` | Compile to `dist/` |
| `npm start` | One full cycle from `dist/` |
| `npm run typecheck` | Type-check `src/` and `test/` |
| `npm test` | The unit tests |

## Test plan

`npm test` covers the parsers against fixture feeds and sitemaps, the analysis
response contract (including malformed, camelCase, and pre-rename model
output), image extraction and every fallback in the chain, one issue draft per
action with its labels and owner, claim extraction from PostHog's pages and the
competitors' compare pages, the relevance guard that keeps a page edit on the
launch that found it, team routing, dedupe behavior, the setup check that names
a missing secret, and the Slack message shape. The fixtures under
`test/fixtures/` are synthetic and marked as such. They exercise the shapes
real feeds use, and are not copies of real competitor announcements.

Beyond the unit tests, three checks are worth running against the real thing:

1. `npm run check-env -- --strict` on a fresh clone names every variable, and
   passes once the secrets are in.
2. The dry run above renders a full message from live feeds without posting.
3. A forced post puts one known announcement in the channel end to end, issues
   and all.

## Handoff to PostHog

This repo is the whole system: the code, the workflows, and the secrets
checklist. It runs on its own Actions cron and needs nothing from PostHog's
infrastructure, so adopting it is a fork, six secrets, and a channel id.

To take it further inside PostHog, open an issue on
[PostHog/marketing](https://github.com/PostHog/marketing) pointing at this
repo. That repo is the planning hub rather than a deploy target, so the issue
is where the conversation lives, not the code. Something like:

> **Competitor happenings bot: daily Mixpanel and Amplitude alerts**
>
> A bot that reads Mixpanel's and Amplitude's changelogs, blogs, X accounts,
> and newsletters every morning, checks anything new against PostHog's own
> docs, and posts one Slack alert per launch with what we should do about it –
> enhance a product, build one, or fix a page that is now wrong. Each
> recommended action opens its own GitHub issue, labeled by owner and team, so
> the work lands on a desk rather than in a channel.
>
> Running today in
> [itsmechase15/posthog-competitor-happenings](https://github.com/itsmechase15/posthog-competitor-happenings).
> Setup is a fork, six Actions secrets, and a Slack channel id. The README has
> the checklist, and a Check secrets workflow that tells you what is missing.
>
> Worth deciding: which channel it should post to, and whether the issues
> belong here or stay in the bot's own repo.

[PLAN.md](./PLAN.md) has the scope and phasing. One thing on the roadmap and
deliberately not built: replying to a Slack alert to edit its recommended
actions.

## License

MIT. See [LICENSE](./LICENSE).
