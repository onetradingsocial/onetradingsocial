# Publishing the six drafts

Status 2026-09-22: all 35 review findings addressed in the drafts. Nothing is in
`data/posts.json` yet, so nothing is live.

## Order

Only one cross-draft link exists, so only one dependency is real: the
journal-entry post links to the MT5 post. Everything else can publish in any
order.

1. **prop-firm-drawdown-rules-explained** — first, because it is the only one
   whose quotations carry a date that decays.
2. **what-an-mt5-statement-contains** — before the journal-entry post.
3. **what-to-record-in-every-journal-entry** — links to the MT5 post.
4. **how-to-calculate-trading-expectancy**
5. **the-twenty-minute-weekly-review**
6. **why-your-backtest-lies-about-drawdown**

Each draft's frontmatter carries the fields `data/posts.json` needs, except
`published_date`, `author_*`, `thumb_color`, `thumb_icon` and `image`. Converting
a draft means adding those, turning the markdown body into the HTML shape the
other posts use (`<p>`, `<h2>`, `<ul>`, one `<blockquote>`), and running
`node scripts/build-blog.mjs`.

The `## Sources` block is working material, not body copy. Decide per post
whether to keep it (it supports the "checkable" positioning, and the prop-firm
one arguably needs it), condense it to inline links, or drop it. If it ships, it
carries the same citation discipline as the body: both passes of review found
every factual error in those blocks rather than in the articles.

## Prop-firm rules have a shelf life

`prop-firm-drawdown-rules-explained` quotes FTMO, Topstep, Apex and The5ers as
published on 22 September 2026. Firms change these terms. Re-check every quoted
rule on the day it publishes, and do not carry the date forward.

## Three follow-ups on already-published content

These came out of the review and are not fixed here, because they change live
pages rather than drafts:

1. **`/blog/win-rate-is-lying-to-you` contains an unsourced benchmark** —
   "most profitable retail strategies produce expectancy between 0.2R and 0.6R
   per trade. Anything above 0.5R sustained over 100+ trades is a genuinely
   strong edge". It has no source, and it contradicts the position the
   expectancy calculator page takes ("we do not publish a target"). Worth
   cutting whether or not these drafts ship.
2. **Three URLs will compete for "what to record in a trading journal"** — the
   new draft, the "What a useful entry actually contains" section of
   `/blog/why-a-trading-journal`, and the FAQ answer on `for/journal.html`,
   which is schema-marked. Decide which owns the query; if it is the new post,
   shorten the other two to a link.
3. **The ten published posts state read times of 5–10 minutes for 271–752
   words** — roughly 90 seconds to four minutes of actual reading. One edit to
   `data/posts.json` plus a rebuild fixes all ten.

## What the review could not settle

- The AMS PDF for the Bailey et al. "45 configurations" figure would not render
  as text for either the writer or the reviewer; the figure is corroborated by
  the publisher's press release. Read the PDF before publishing if you want it
  first-hand.
- No firm's own rules page confirms a daily drawdown measured on closed balance
  alone. The prop-firm post now says that in the reader's voice and names no
  firm for it.
- The5ers' High Stakes page gives percentages but not the basis of its 10%
  limit; the post says so rather than guessing.
