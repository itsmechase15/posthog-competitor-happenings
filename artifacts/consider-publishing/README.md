# Pictures of the draft for `consider_publishing` issues

The bot writes PNGs here. Nobody edits this folder by hand.

When a competitor publishes a piece that ships nothing – thought leadership,
an explainer, an event write-up – and PostHog's blog has nothing on the same
angle, the issue the bot opens carries a draft of the piece PostHog might
publish, written in PostHog's blog voice. A marketer's first question about a
draft is what it reads like as a post, so the draft is laid out as one in a
headless browser and photographed a screen at a time, top of the page first.
A browser only renders an image it can fetch, so the PNGs are committed here
and the issue body embeds them from these paths.

The page in the picture is the draft, at reading width, under a header that
says it is a draft. It is not a posthog.com page and does not pretend to be
one: there is no live page to photograph for a post nobody has written, and a
picture of the draft in PostHog's own fonts and chrome would be a picture of a
page that does not exist. Nothing in this folder was ever published, and the
caption in the issue says so.

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

See [`src/media/draftPage.ts`](../../src/media/draftPage.ts) for the page and
the browser that photographs it, [`src/media/markdown.ts`](../../src/media/markdown.ts)
for how the draft is laid out, and
[`src/media/draftVisual.ts`](../../src/media/draftVisual.ts) for which actions
get pictures and how they are committed.
