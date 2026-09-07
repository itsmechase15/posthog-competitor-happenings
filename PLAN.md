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
- GitHub issues with screenshots (Phase 2)
- PRs for page edits (Phase 3)

### Index PostHog.com
Index PostHog.com pages that mention Mixpanel or Amplitude. Cite URL + claim + suggested edit when relevant.

### Analysis
- Cursor SDK, model `claude-opus-5`
- Severity `minor | notable | major` = **label only** (not a post gate — every new signal can Slack)
- Exactly one recommended action:
  - update pages (existing compare/content)
  - new compare page
  - consider building (PostHog has nothing like this)
  - consider enhancing (related feature; gap)
- Action copy focuses on the gap / why PostHog has nothing like it — not generic "why care"

### Slack
Short summary per new signal. Chase personal Slack first; PostHog channel later.

### Storage
Supabase Postgres (`DATABASE_URL`). Project ref `hapeyljmsclryifyhqdr`.
Tables: `items`, `analyses`, `pages`, `claims` (already migrated).

### Runtime
TypeScript on GitHub. Cron via GitHub Actions (~7am PT).

### Env / secrets
- `DATABASE_URL`
- `SLACK_WEBHOOK_URL`
- `CURSOR_API_KEY` (for Cursor SDK analysis)
- Optional: AgentMail API, `X_BEARER_TOKEN` if Actions cannot use other X access

## Handoff to Joe (PostHog Marketing Lead)
1. Prove on Chase Slack + screenshot
2. Ship this app repo
3. Open issue/PR in https://github.com/PostHog/marketing linking the app + setup notes (that repo is planning hub, not deploy)
