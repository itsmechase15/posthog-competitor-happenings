# Before/after cards

The PNGs in here are the before/after images on `update_pages` GitHub issues.
One per page an issue asks somebody to edit, committed by the daily job so the
issue body can embed it: GitHub Issues renders an image from a URL and nothing
else, and "open this link to see the change" is the handoff the card exists to
avoid.

    artifacts/update-pages/<YYYY-MM-DD>/<page-slug>-<hash>.png

The hash is taken over the rendered card, so a path always holds the same
bytes. That is what makes the raw URL in an issue body safe to embed, makes a
re-render of an unchanged edit free, and makes a revised edit a new file rather
than an old URL quietly showing new copy.

Nothing reads these back. They are here because an issue points at them, so a
file whose issue is closed is only history – delete a day's folder if the repo
gets heavy, and old issues lose their pictures while keeping the diff and the
copy to paste.

`src/media/pageEdit.ts` builds the card, `src/media/render.ts` screenshots it,
and `src/github/files.ts` commits it.
