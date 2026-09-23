# Pictures of the draft for `consider_publishing` issues

The bot writes PNGs here. Nobody edits this folder by hand.

When a competitor publishes a piece that ships nothing – thought leadership,
an explainer, an event write-up – and PostHog's blog has nothing on the same
angle, the issue the bot opens carries a draft of the piece PostHog might
publish, written in PostHog's blog voice. A marketer's first question about a
draft is what it would look like on posthog.com, so that is what the pictures
are of: a real PostHog blog post, opened in a headless browser, with its
headline, body, byline, and tables of contents swapped for the draft's in that
tab's own DOM, photographed a screen at a time from the top. A browser only
renders an image it can fetch, so the PNGs are committed here and the issue
body embeds them from these paths.

It is the same treatment the `update_pages` before/after gets, through the
same code that opens the page: light theme, desktop window, the site's own
fonts and images allowed in, every third party kept out. What says it is a
draft is a yellow "Proposed draft · not published" stamp above the headline,
in the headline's own column, and a byline that reads `Draft, <date>` with the
borrowed post's authors hidden – they did not write this. The caption in the
issue names the post the layout came from. Nothing in this folder was ever
published to posthog.com: the draft lives in one tab's memory between the load
and the screenshots, and the tab is thrown away.

    artifacts/consider-publishing/<YYYY-MM-DD>/<title-slug>-<hash>-1.png
    artifacts/consider-publishing/<YYYY-MM-DD>/<title-slug>-<hash>-2.png
    …

This repo is public, so the issue embeds the plain
`raw.githubusercontent.com/<repo>/<default branch>/<path>` address: no token in
it, nothing to expire, and it renders for anybody who opens the issue.

The hash covers the headline, the whole draft, and the day, so a re-run the
same morning lands on the same files and a draft the review pass rewrote gets
its own set rather than changing the pictures an open issue points at. A long
draft is at most four shots; the rest is in the fence under them. One shot
failing to commit drops them all, because a post with its ending missing,
captioned as whole, is worse than the text.

Nothing reads these back. They are here because an issue points at them, so a
file whose issue is closed is only history – delete a day's folder if the repo
gets heavy, and old issues lose their pictures while keeping the draft in text.
Turning the whole thing off is `SKIP_PAGE_VISUALS=true`, the same switch as the
page before/after, after which issues carry the draft in words alone.

See [`src/media/draftPage.ts`](../../src/media/draftPage.ts) for which post is
borrowed, how the swap is made, and how the page is scrolled and shot,
[`src/media/livePage.ts`](../../src/media/livePage.ts) for the browser both
kinds of picture are taken in, and
[`src/media/draftVisual.ts`](../../src/media/draftVisual.ts) for which actions
get pictures and how they are committed.
