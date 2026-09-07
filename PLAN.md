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

### Analysis
- Cursor SDK, model `claude-opus-5`
- Impact `low | medium | high` = **label only** (not a post gate — every new signal can Slack)
- Exactly one recommended action:
  - update pages (existing compare/content)
  - new compare page
  - consider building (PostHog has nothing like this)
  - consider enhancing (related feature; gap)
- Action copy focuses on the gap / why PostHog has nothing like it — not generic "why care"
- "Severity" is gone from everything user-facing. Reads still accept the old
  `minor | notable | major` and map them to `low | medium | high`, and the
  legacy `analyses.severity` column keeps getting the mapped token so this
  needed no migration

### Slack
One short, pretty message per new signal, in this order and nothing else:

1. Feature image — changelog/blog image, tweet image, or a screenshot of the feature page. Never posted without one
2. One sentence on what changed
3. **What you need to KNOW** — a few short bullets
4. **Impact** — low / medium / high
5. **Recommended action** — the action plus one sentence
6. **Access GitHub issue for more information** — link to the issue for this item

PostHog page citations, suggested edits, and open questions are not in Slack.
They live in the issue.

### GitHub issues
Moved into the daily flow from Phase 2, because Slack got short and the detail
had to go somewhere.

One issue per analyzed item, in this repo, opened before the Slack post so the
message has something to link. Title is competitor + feature; body carries the
full summary, key points, impact, recommended action with all its detail, the
PostHog pages to update (url, claim, suggested edit), open questions, source
links, and the feature image. Labelled by competitor, source, impact, and
action. Uses the `GITHUB_TOKEN` Actions provides; with no token the run skips
issue creation and keeps posting.

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
