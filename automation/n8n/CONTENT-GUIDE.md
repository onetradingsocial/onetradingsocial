# Submitting content — guide for Nathan

Everything posted to Instagram, Telegram, and TikTok comes from one file:
**`automation/n8n/content-queue.json`**. Nothing is generated automatically —
if it isn't in this file, it doesn't get posted.

The system checks the queue on a schedule, takes the oldest post that's due for
that platform, publishes it, and marks it done. An empty queue just means a
quiet day; nothing breaks.

| Platform | Posts at (Hong Kong time) |
|---|---|
| Telegram | 09:00, 14:00, 19:00 |
| Instagram | 12:00 |
| TikTok | 17:00 |

---

## How to add a post

Open `content-queue.json` and add a block inside `"items": [ ... ]`. Copy an
existing one and edit it — the commas between blocks matter.

### Instagram

```json
{
  "id": "ig-2026-08-12-a",
  "platform": "instagram",
  "status": "pending",
  "scheduledFor": "",
  "text": "Your caption goes here.\n\n#tradingjournal #daytrading #expectancy",
  "imageUrl": "https://www.tradingsocial.io/assets/social/expectancy-01.jpg",
  "videoUrl": "",
  "author": "nathan"
}
```

### Telegram

```json
{
  "id": "tg-2026-08-12-a",
  "platform": "telegram",
  "status": "pending",
  "scheduledFor": "",
  "text": "<b>Your hook.</b>\n\nThe body of the post.\n\n<a href=\"https://tradingsocial.io\">Start free</a>",
  "imageUrl": "",
  "author": "nathan"
}
```

### TikTok

```json
{
  "id": "tt-2026-08-12-a",
  "platform": "tiktok",
  "status": "pending",
  "scheduledFor": "",
  "text": "Caption plus hashtags.",
  "videoUrl": "https://www.tradingsocial.io/assets/social/clip-01.mp4",
  "author": "nathan"
}
```

---

## The fields

| Field | What to put |
|---|---|
| `id` | Anything unique. `ig-YYYY-MM-DD-a` works well. |
| `platform` | `instagram`, `telegram`, or `tiktok` — lowercase. |
| `status` | `pending` = will post at the next slot. `draft` = written but not approved yet, ignored by the poster. `skip` = parked. Changes itself to `posted` afterwards. Anything other than `pending` is left alone. |
| `scheduledFor` | Leave `""` to post at the next slot. Or `"2026-08-14T04:00:00Z"` to hold it until then — **note that's UTC, so subtract 8 hours from Hong Kong time**. |
| `text` | The post body / caption. See per-platform rules below. |
| `imageUrl` | Required for Instagram (unless posting a Reel). Optional for Telegram. |
| `videoUrl` | Required for TikTok. Optional for Instagram (posts as a Reel). |
| `author` | Just for your own tracking. |

Queue as many as you like. They go out oldest-first, one per slot.

---

## Images and video

**Instagram cannot post text alone.** Every Instagram post needs an image or a
video at a **public web address** — Instagram downloads it from its own servers,
so a file on your computer or phone won't work.

### Where to put them

1. Save the file into `assets/social/` in the website repo
2. Deploy the site
3. The address is then
   `https://www.tradingsocial.io/assets/social/your-filename.jpg`

Use `www.` — the plain `tradingsocial.io` version redirects, which some
platforms handle badly.

### Image rules

| | |
|---|---|
| Format | **JPEG only.** A PNG will be rejected — export as `.jpg`. |
| Shape | Between 4:5 (portrait) and 1.91:1 (wide). **1080×1080 square** or **1080×1350 portrait** are the safe picks. |
| Size | Under 8 MB. |

Portrait 1080×1350 takes up the most space in the feed, so it's usually the
better choice for reach.

### Video rules (TikTok and Instagram Reels)

MP4, vertical 9:16, under 60 seconds to be safe. TikTok additionally requires the
video to be hosted on a domain we've verified with them — for now that means the
same `www.tradingsocial.io/assets/social/` location.

---

## Writing the text

**Telegram** accepts limited HTML. Only these work:

- `<b>bold</b>`
- `<i>italic</i>`
- `<a href="https://tradingsocial.io">link text</a>`

Nothing else. If you need a literal `<` or `&` in the text, write `&lt;` or
`&amp;` instead, or the post will be rejected.

Line breaks are `\n` — two of them (`\n\n`) makes a paragraph gap.

**Instagram and TikTok** are plain text. No HTML, no markdown. Hashtags go at
the end.

**Length:** Telegram messages up to 4096 characters — but if you attach an image
it drops to **1024**, so keep image posts short. Instagram captions up to 2200.

---

## Rules that aren't optional

TradingSocial is a trading product, which means marketing copy is held to a
higher standard than most. These apply to everything, including anything you
write by hand:

- **No profit, return, or income claims.** Not "traders using this made X", not
  "improve your returns", not a screenshot of a big win.
- **No win-rate promises.** Don't imply anyone will achieve a particular result.
- **No trading or investment advice.** Never tell anyone what to buy or sell.
- **Never** say signals, copy-trading, guaranteed, or risk-free.

Write about **process** — journaling, measuring, reviewing, discipline,
verification. Never about **outcomes**. "Track your expectancy per setup" is
fine. "Boost your win rate" is not.

Beyond being the honest thing to do, breaking these is the fastest route to an
ad account ban or a regulator taking an interest.

---

## After you add a post

Save the file. That's it — no restart needed, the system re-reads it every time
it runs.

To check what happened:

- `post-log.jsonl` — one line per post that went out, with a timestamp
- The `status` in `content-queue.json` flips to `posted` and gains a `postedAt`
- Or open the n8n dashboard and look at **Executions**

## If a post doesn't appear

| What you see | Usually means |
|---|---|
| Instagram post never appeared | The image isn't a JPEG, or the address isn't publicly reachable. Paste the `imageUrl` into a private browser window — if it doesn't load there, Instagram can't load it either. |
| Telegram says "can't parse entities" | Unsupported HTML in `text`. Stick to `<b>`, `<i>`, `<a href>`. |
| Nothing posted at all | The whole file may be invalid JSON — usually a missing or extra comma. Paste it into jsonlint.com to find the line. |
| TikTok posted but nobody can see it | Expected for now. TikTok won't allow public posting until our developer app passes their review. Until then it lands in the TikTok app's drafts for you to finish by hand. |

When in doubt, add the post with `"status": "skip"`, tell me, and I'll check it
before flipping it to `pending`.
