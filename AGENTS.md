# Working on this repo

Notes for a coding agent – Cursor, Claude Code, Codex, or whatever opens this
next. A person reading this is better served by the [README](./README.md).

## What it is

A daily job that reads Mixpanel's and Amplitude's changelogs, blogs, X accounts
and newsletters, asks Opus what PostHog should do about anything new, opens a
GitHub issue per recommended action, and posts one Slack alert per launch. It
runs on GitHub Actions, on a cron, and stores what it has seen in Postgres.

The `pages` table is also the corpus: every page PostHog publishes about the
product, around 3,800 of them. Each run writes it to `.docs-workspace/` and
gives the analyst read-only search over it, then checks every gap claim the
analyst makes back against the same corpus. The mistake the whole thing exists
to stop is a GitHub issue telling PostHog to build something PostHog ships.

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
| `SKIP_REVIEW=true DRY_RUN=true … npm run run` | The same without the review pass, for when you only care about the analysis |
| `npm run run -- --url <url>` | Push one named announcement through the whole pipeline |
| `npm run run -- --check-slack` | Ask Slack what the bot token can do |
| `npm test` / `npm run typecheck` | What CI runs |

Start with the dry run. It needs no secrets at all, hits the live feeds, and is
the fastest way to see what a change does to a message. It builds the whole
corpus first, which takes a few minutes and leaves it in `.docs-workspace/` –
worth opening, because it is exactly what the analyst sees. `SKIP_POSTHOG_INDEX=true`
skips the rebuild when you only care about the message.

A dry run reviews too. The reviewer and the writer both run, the payload shows
the revised actions and omits the dropped ones, and the issue editor logs what
it would have written instead of writing it – so a dry run shows the whole
outcome, not the half of it that needs no credentials. `SKIP_REVIEW=true` turns
the pass off when you are iterating on something else.

A dry run also photographs the page for a page edit, writes both PNGs to one
temp directory, and logs the paths, because that is the part worth looking at
and it needs no credentials. It commits nothing, and it publishes nothing to
posthog.com: the proposed copy goes into the headless browser's own copy of the
document and dies with the tab. `SKIP_PAGE_VISUALS=true` skips the whole thing,
which is what you want on a box with no Chromium: run
`npx playwright install chromium-headless-shell` once if you would rather see
it.

## House rules for changes

- **Copy is PostHog copy.** Everything this bot posts follows the
  [docs style guide](https://posthog.com/handbook/wizard-and-docs/docs-style-guide)
  and [tone of voice](https://posthog.com/handbook/brand/tone).
  [`docs/writing.md`](./docs/writing.md) is the short version and says where
  each rule is enforced. The one that catches people out: no em dashes. A dash
  is an en dash with a space either side.
- **A recommendation is a claim about what PostHog ships**, so it is checked
 against the corpus after it is written, by code rather than by another model
 pass. See `gateActions` in
 [`src/analysis/evidence.ts`](./src/analysis/evidence.ts): the cited page has
 to be in the corpus, it has to be product documentation, the quote has to be
 on the stored copy, and the gap's own words must not lead somewhere the
 analysis never opened. A failed check becomes an open question and opens no
 issue – never a correction, because there is no way to rewrite a claim whose
 basis we cannot find without inventing one.
- **A page edit is proportional to the page.** A page that could carry more is
 not a page that should be edited. What an `update_pages` edit adds has to fit
 what is already there, so a page of two or three short paragraphs takes one or
 two sentences and never a competitive write-up, however true every sentence of
 it is. `proportionProblem` in
 [`src/analysis/proportion.ts`](./src/analysis/proportion.ts) measures it
 against the stored page – a fifth of the page's own length, or 60 words,
 whichever is more, on top of the line it replaces – and over that the action
 is dropped into an open question saying a shorter edit may still be worth
 making. Nothing shortens the copy for the model: choosing which sentences
 survive is writing the recommendation, not checking it. The review pass is
 where a short version gets asked for, and the prompts state the rule in the
 same numbers the gate measures with, so keep the three in step.
- **Do not add a guess-then-fix model pass.** A model shown its own unsupported
 claim argues for it better rather than going to check. One analyst run, with
 the corpus under it, then code.
- **The before/after is two screenshots of the live page, and publishes
 nothing.** An `update_pages` issue embeds a PNG of the page as it reads today
 and a PNG of the same page with the proposed copy in it, taken by
 [`src/media/livePage.ts`](./src/media/livePage.ts): open the page in a
 headless browser, shoot it, put the copy into that tab's own DOM, shoot it
 again, throw the tab away. The copy goes in inside a highlight, so the after
 shot says which words are the recommendation and the before shot stays as the
 page reads. Only the words it adds: a rewrite that keeps a sentence of the
 page's own copy leaves that sentence unmarked, and an insert never repeats the
 line it was added next to, because a mark on words the page already had says
 the edit is bigger than it is. Nothing is submitted anywhere and the caption under the after
 shot says so. This replaced a card drawn from the corpus text, which
 read as a text mock of a page rather than the page – do not bring it back, as
 a fallback or otherwise. The corpus is still what the claim is *checked*
 against, and a claim the live page no longer has is a dropped pair and a line
 in the issue saying the page has moved on, never a guess at where it went.
 `update_pages` only: there is no before and after of a feature that does not
 exist. Every step fails soft – no browser, a page that will not load, no
 token, a refused commit – because an issue without the pictures says the same
 thing in words. The one other picture an issue carries is the
 `consider_publishing` draft, and it is taken the same way
 ([`src/media/draftPage.ts`](./src/media/draftPage.ts)): a real posthog.com
 blog post is opened through the same `openLivePage`, its headline, body,
 byline, and tables of contents become the draft's in that tab's DOM, a
 stamp above the headline says it is a proposed draft, and the page is
 photographed a screen at a time. It has to look like posthog.com – same
 chrome, same type, same column – because a marketer is deciding whether to
 publish it there. A generic reading column of the draft was tried and
 rejected as a mock of a page: do not bring it back.
- **The review pass is not that pass.** Once an action's issue is open, a
 different model reads the same corpus and says agree, revise, or drop, and a
 revise is rewritten once and re-gated by the same code. Five things make it a
 review rather than a model marking its own homework: it is a **different
 model** from the analyst, it is **shown the analyst's claim** rather than its
 own, it has the **corpus underneath it** rather than a memory of one, the
 rewrite is **re-checked by code** and not by another model, and it happens
 **once** – an unconfirmed rewrite is never applied. Take away any one of those
 and it becomes the forbidden pass. See [`src/review/`](./src/review/) and the
 [Review section of PLAN.md](./PLAN.md#review-every-action-once).
- **Zero actions is a normal answer**, rendered as **None** with a reason. Do
 not reintroduce a rule that an alert has to recommend something. For a piece
 that ships nothing, the reason says what the piece is and that it is not an
 announcement of a new feature or product, and stops: "This is a thought
 leadership article about X. It's not an announcement of a new feature or
 product." Never "no impact on current PostHog products" or "PostHog's
 Experiments product has nothing to answer" – `trimNotAGapReason` in
 [`src/analysis/noAction.ts`](./src/analysis/noAction.ts) cuts that flourish,
 and a test greps `src/` for it. PostHog's voice rules apply to the drafted
 article below, not to this note.
- **`consider_publishing` is a content action, not a product one.** After the
 product verdict is None on a piece that ships nothing, the analyst asks
 whether PostHog publishes anything on the same angle. If it does, the None
 carries `noAction.marketing` naming the page. If not, a `consider_publishing`
 action files an issue with the product verdict, a draft of the piece in
 PostHog's blog voice, and the draft laid out and photographed. Three things
 keep it from weakening the product bar, so keep all three: `noAction` is set
 whenever there is no *product* action (`productActions` in
 [`src/types.ts`](./src/types.ts)), so the product answer is always given
 next to the piece; the gate judges the two sides apart and no content block
 ever reaches the product verdict; and it is an extra path, never a fallback
 for an unverified gap or a page edit that failed its bar. The draft is
 checked by [`src/analysis/article.ts`](./src/analysis/article.ts): there is
 one, it has a headline, it runs at least 300 words, and no PostHog blog
 post, tutorial, or newsletter issue on the angle went unread. The picture on
 the issue is the draft staged into a real posthog.com blog post's page, with
 a stamp saying it is a proposed draft and the borrowed post's authors hidden,
 and the caption names the post it was staged on and says nothing was
 published.
- **A run with no alerts in it still says so.** Silence reads the same as a
  broken cron from inside the channel, so `runCycle` ends with one line saying
  nothing shipped, posted once, after every alert has been tried. See
  `postQuietDayNote` in [`src/slack/quietDay.ts`](./src/slack/quietDay.ts). It
  is skipped on a run that had alerts to post – including ones Slack refused,
  because the next run retries those – on a run that collected nothing because
  every source failed, and on a first run that recorded a backlog silently. In
  each of those the line would be untrue rather than merely redundant. A forced
  post of one URL never reaches it: that path posts its own message, **None**
  and all.
- **New environment variable?** Add it to [`src/config.ts`](./src/config.ts),
  [`src/setup/requirements.ts`](./src/setup/requirements.ts), `.env.example`,
  and the workflow that needs it. The requirements list is what `check-env`
  reads, so a variable missing from it is a variable nobody is told about.
- Tests live in `test/`, run with vitest, and the fixtures are synthetic on
  purpose. `npm run typecheck && npm test` before opening a PR.
