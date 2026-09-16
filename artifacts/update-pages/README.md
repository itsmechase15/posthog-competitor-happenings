# Before/after screenshots for `update_pages` issues

The bot writes PNGs here. Nobody edits this folder by hand.

When an alert says a posthog.com compare page, product page or pricing page is
now wrong, the issue it opens carries the copy to paste. Two screenshots of the
page answer the first question the person making the edit has: one of the page
as it reads today, one of the same page with the proposed copy in it. A browser
only renders an image it can fetch, so the PNGs are committed here and the
issue body embeds them from these paths.

The after shot is taken with the copy put into a headless browser's own copy of
the document – highlighted, so the recommendation is the part of the picture
that reads first – between two screenshots, in a tab that is then thrown away.
Nothing in this folder was ever published to posthog.com, and the caption in
the issue says so.

    artifacts/update-pages/<YYYY-MM-DD>/<page-slug>-<hash>-before.png
    artifacts/update-pages/<YYYY-MM-DD>/<page-slug>-<hash>-after.png

This repo is public, so the issue embeds the plain
`raw.githubusercontent.com/<repo>/<default branch>/<path>` address: no token in
it, nothing to expire, and it renders for anybody who opens the issue.

The hash covers the page, both sides of the edit, and the day the pair was
taken. Re-running the same recommendation the same morning lands on the same
files rather than a second copy of them; a run a week later photographs the
page as it is that week rather than embedding a before shot that has gone
stale; and a rewritten edit gets its own pair rather than changing the pictures
an already-open issue points at. One of the two failing to commit drops both,
because half a comparison is worse than none.

Nothing reads these back. They are here because an issue points at them, so a
file whose issue is closed is only history – delete a day's folder if the repo
gets heavy, and old issues lose their pictures while keeping the diff and the
copy to paste. Turning the whole thing off is `SKIP_PAGE_VISUALS=true`, after
which issues say the same thing in words.

See [`src/media/livePage.ts`](../../src/media/livePage.ts) for the browser that
takes them, [`src/media/pageEdit.ts`](../../src/media/pageEdit.ts) for what the
edit is and where each file goes, and
[`src/media/visual.ts`](../../src/media/visual.ts) for which edits get a pair.
