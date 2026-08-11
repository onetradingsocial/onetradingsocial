# TradingSocial marketing automation (n8n)

Local n8n instance that posts to **Instagram**, **Telegram**, and **TikTok** on a
schedule. Every post comes from Nathan's queue — there is no content generation.
If nothing is queued and due, that channel posts nothing and the run exits cleanly.

```
                 ┌────────────────────┐
  Nathan  ──────▶│ content-queue.json │
                 └─────────┬──────────┘
                           ▼
   cron ──▶ [ anything pending and due for this platform? ]
                    │                          │
                   yes                         no
                    ▼                          ▼
                 post it                 stop, post nothing
                    │
        ┌───────────┼────────────┐
        ▼           ▼            ▼
   Instagram    Telegram      TikTok
```

| File | What it is |
|---|---|
| `workflows/01-telegram-autoposter.json` | Telegram, 09:00 / 14:00 / 19:00 |
| `workflows/02-tiktok-autoposter.json` | TikTok, 17:00 |
| `workflows/04-instagram-autoposter.json` | Instagram, 12:00 |
| `workflows/05-instagram-token-refresh.json` | Mondays 04:00 — rolls the Instagram token forward so it never expires |
| `content-queue.json` | **Nathan edits this.** The only source of posts. |
| `instagram-token.json` | Live Instagram token, written by the refresh workflow. Gitignored; created on first run. |
| `post-log.jsonl` | Append-only record of everything posted. Gitignored; created on first run. |
| `.env.example` → `.env` | Configuration. `.env` is gitignored. |
| `start-n8n.ps1` | Loads `.env` and starts n8n |

All schedules run in `GENERIC_TIMEZONE`, currently `Asia/Hong_Kong`.

There is no workflow 03 — that slot was an AI content generator, since removed.
Numbering is left alone so the remaining files keep their identity.

---

## What each channel needs

| | Text-only posts? | What a queue item must carry |
|---|---|---|
| **Telegram** | yes | `text`. `imageUrl` optional — if set, posts as a photo. |
| **Instagram** | **no** | `text` (the caption) **plus** `imageUrl` (JPEG) or `videoUrl` (Reel). |
| **TikTok** | **no** | `text` (the caption) **plus** `videoUrl`. |

Items missing the required media are skipped, not half-posted.

### The one thing that isn't ready on day one

**TikTok cannot publish publicly without an app audit.** Until TikTok approves
your app, every direct post is forced to `SELF_ONLY` — i.e. invisible. So
`TIKTOK_MODE=inbox` is the default: the video lands in the
creator's TikTok inbox as a draft to finish and post by hand. Flip to `direct`
once the audit clears.

Telegram and Instagram both publish for real immediately.

---

## Setup

### 1. Install n8n

```bash
npm install -g n8n
```

Node 20+ required. Already installed here (n8n 2.22.6, Node 22.19.0).

### 2. Configure

```bash
cp automation/n8n/.env.example automation/n8n/.env
```

Set at minimum:

- `GENERIC_TIMEZONE` and `TZ` — **every cron schedule uses this.**
- `N8N_ENCRYPTION_KEY` — generate once and keep it. If it changes, every saved
  credential becomes unreadable.

  ```bash
  node -e "console.log(require('crypto').randomBytes(24).toString('base64'))"
  ```

`NODE_FUNCTION_ALLOW_BUILTIN=fs,path` is already set and is **required** — the
Code nodes read and write `content-queue.json` directly. Without it every
workflow dies at the first Code node with `Cannot find module 'fs'`.

### 3. Start it

```bash
powershell -ExecutionPolicy Bypass -File .\automation\n8n\start-n8n.ps1
```

Then open http://localhost:5678.

### 4. Reaching it from other devices (optional)

n8n listens on `0.0.0.0` already; the gate is the Windows Firewall. Scope the
rule to your own Tailscale devices rather than the whole tailnet — a shared
tailnet means other people's machines could otherwise reach the editor, and n8n
holds live posting credentials.

```powershell
New-NetFirewallRule -DisplayName "n8n (my devices only)" -Direction Inbound -Protocol TCP -LocalPort 5678 -RemoteAddress <peer-ip>,<peer-ip> -Action Allow -Profile Any
```

`tailscale serve --bg 5678` is the tidier alternative — HTTPS, no firewall rule —
if your tailnet has HTTPS certificates enabled.

Note that Termux on Android can't resolve MagicDNS names; use the `100.x` IP there.
The phone's browser resolves them fine.

### 5. Telegram credential

1. [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token
2. n8n: **Credentials → Add → Telegram** → paste it
3. Add the bot to your channel **as an administrator with Post Messages** — a
   plain member cannot post
4. `TELEGRAM_CHAT_ID`: `@handle` for a public channel, or the `-100…` numeric id
   for a private one (forward a channel message to
   [@userinfobot](https://t.me/userinfobot))
5. `TELEGRAM_REVIEW_CHAT_ID`: your own DM with the bot — this is where the
   Instagram token alert goes. Message the bot once first; bots can't DM you first.
6. Assign the credential in both Telegram nodes

### 6. TikTok

1. [developers.tiktok.com](https://developers.tiktok.com) → create an app
2. Add the **Content Posting API** product, request `video.upload`
3. **Verify the domain** hosting your videos under *Manage apps → URL properties*.
   TikTok pulls the file from the URL you give it and refuses unverified domains.
4. Client key/secret into `.env`
5. OAuth consent once to get a refresh token:

   ```
   https://www.tiktok.com/v2/auth/authorize/?client_key=KEY&scope=video.upload&response_type=code&redirect_uri=URI&state=x
   ```

   Take the `code` off the redirect and **URL-decode it** — TikTok appends a
   literal `*` that arrives as `%2A` and the exchange fails silently otherwise.

   ```bash
   curl -X POST https://open.tiktokapis.com/v2/oauth/token/ \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "client_key=KEY&client_secret=SECRET&code=CODE&grant_type=authorization_code&redirect_uri=URI"
   ```

   Put `refresh_token` in `TIKTOK_REFRESH_TOKEN`. It rotates on every refresh and
   n8n keeps the current one in workflow static data, so this is only the seed.
   Refresh tokens expire after **365 days**, so this recurs annually.

### 7. Instagram

**a.** The account must be **Business or Creator**, linked to a Facebook Page.
Personal accounts have no publishing API.

**b.** [developers.facebook.com](https://developers.facebook.com) → Create App →
Other → Business. Add product **Instagram** → **API setup with Instagram login**.

**c.** In that panel, *Generate access tokens* → add your Instagram account →
authorize. It hands you a **long-lived token** (60 days) and shows the numeric
**Instagram account ID**. This skips the manual OAuth dance entirely.

**d.** Put them in `.env`:

```
IG_USER_ID=<numeric account id>
IG_ACCESS_TOKEN=<long-lived token>
```

**e.** Restart n8n, open *Instagram Token Refresh*, **Execute Workflow**. It
writes `instagram-token.json`, which becomes the source of truth from then on.

**Leave that workflow Active.** Instagram tokens die after 60 days and
**cannot be refreshed once expired** — recovery means redoing the OAuth consent
by hand. The workflow re-rolls it every Monday and alerts you on Telegram if a
refresh fails or expiry comes within 14 days.

### Changing the Instagram account, or replacing an expired token

**`.env` is only a seed. The workflows read `instagram-token.json`.** Editing
`IG_ACCESS_TOKEN` on its own changes nothing — the poster keeps using the old
token, publishes to the old account, and reports no error. This is the single
easiest thing to get wrong here.

So don't do it by hand:

1. Generate a token for the account you want (Meta app → Instagram →
   *API setup with Instagram login* → **Add account** → authorize → copy)
2. Paste it into `IG_ACCESS_TOKEN` in `.env`
3. Run:

   ```bash
   node automation/n8n/set-instagram-token.mjs
   ```

4. Restart n8n

The script validates the token against Meta before changing anything, prints
which account it belongs to (so a wrong paste is obvious immediately), refuses
non-Business/Creator accounts, then rewrites `instagram-token.json` and
`IG_USER_ID` together. If the token is bad it exits without touching either file.
It never prints the token.

### 8. Import the workflows

Drag each file onto the canvas, or with n8n stopped:

```bash
n8n import:workflow --separate --input=./automation/n8n/workflows
```

The files carry stable ids, so re-importing **updates** them rather than creating
duplicates. Edits made in the n8n UI do *not* flow back to the repo — re-export
if you change something there and want it kept.

Then assign credentials, check the schedule, and flip **Active**. Nothing runs
until it's activated.

---

## How Nathan uses it

Everything lives in **`content-queue.json`**. Add an object to `items`:

```json
{
  "id": "ig-2026-08-12-a",
  "platform": "instagram",
  "status": "pending",
  "scheduledFor": "",
  "text": "Caption goes here.\n\n#tradingjournal #daytrading",
  "imageUrl": "https://.../card.jpg",
  "videoUrl": "",
  "author": "nathan"
}
```

- **`status`** — `pending` posts at the next slot for its platform. `skip` parks
  it. The workflow flips it to `posted` and stamps `postedAt` once it's out.
- **`scheduledFor`** — empty means "next available slot"; an ISO timestamp holds
  it until then. Oldest due item goes first.
- **`text`** — Telegram: HTML, only `<b>`, `<i>`, `<a href="">`. Instagram and
  TikTok: plain text, used as the caption.
- **`imageUrl`** — Telegram: optional, posts as a photo (caption capped at
  **1024 characters** vs 4096 for plain messages). Instagram: this or `videoUrl`
  is required, and it must be **JPEG** — PNG is rejected.
- **`videoUrl`** — TikTok: required, on your TikTok-verified domain.
  Instagram: optional, posts as a Reel.

**Nothing posts unless Nathan queues it.** An empty queue means a quiet day, by
design.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Cannot find module 'fs'` in a Code node | `NODE_FUNCTION_ALLOW_BUILTIN=fs,path` must be in the environment *before* n8n starts — use `start-n8n.ps1`, not a bare `n8n start`. |
| Posts fire at the wrong hour | `GENERIC_TIMEZONE`/`TZ` wrong. Set both, restart n8n, re-save the workflow. |
| Telegram `400: chat not found` | Bot isn't in the channel, or the chat id is wrong. Private channels use the numeric `-100…` id. |
| Telegram `400: not enough rights` | Bot is a member but not an admin with Post Messages. |
| Telegram `400: can't parse entities` | Unsupported HTML. Only `<b>`, `<i>`, `<a href="">`; a bare `<` or `&` must be escaped. |
| Instagram container `status_code: ERROR` | Almost always: image isn't JPEG, URL isn't publicly reachable, or aspect ratio out of range. Fetch the URL from outside your network to check. |
| Instagram `Invalid OAuth access token` | Expired or revoked. If expired it **cannot** be refreshed — redo step 7c and reset `IG_ACCESS_TOKEN`. |
| Instagram posts nothing, no error | No queued item had the required media. Check the execution's **Load IG Queue** output. |
| TikTok `access_token_invalid` | Refresh token rotated and the `.env` seed is stale. Clear the workflow's static data or redo step 6. |
| TikTok `url_ownership_unverified` | Video domain isn't verified under *URL properties*. |
| TikTok posts succeed but nobody sees them | Unaudited app — TikTok forces `SELF_ONLY`. Expected until the audit clears. |
| TikTok stuck at `PROCESSING_UPLOAD` | Normal for larger files. Raise the **Wait for TikTok to pull video** node from 45s. |

Every run is visible under **Executions** with the exact input and output of each
node. `post-log.jsonl` is the durable record of what actually went out.

---

## Keeping it running (watchdog)

This runs on a laptop that sleeps, so two mechanisms cover the gaps.

### 1. Scheduled Task restarts n8n

```bash
powershell -ExecutionPolicy Bypass -File .\automation\n8n\install-watchdog.ps1
```

Registers **TradingSocial n8n watchdog** under your own account (no admin
needed) with three triggers: at logon, every 5 minutes, and daily at 11:50 with
*wake the computer to run this task*. It checks whether anything is listening on
5678 and starts n8n only if not, so repeated runs can't produce a second
instance. Activity goes to `watchdog.log`; n8n's own output to
`n8n-console.log`.

Remove it with:

```powershell
Unregister-ScheduledTask -TaskName "TradingSocial n8n watchdog" -Confirm:$false
```

### 2. The Instagram poster heals a missed slot

n8n's cron does **not** backfill a tick it slept through, so a single daily
trigger silently loses the day. Instead the workflow runs **hourly** and decides
whether to post, guarded so it still posts at most once a day:

- already posted today → skip
- before `IG_POST_HOUR` (12) → skip
- at/after `IG_POST_UNTIL_HOUR` (21) → skip, leave it for tomorrow

So it posts at 12:00 normally; if the machine was asleep until 15:00 it posts at
15:00; if it never woke inside the window the item stays `pending` and goes out
the next day. **Nothing is lost — the queue just drains a day slower.**

### What this does not fix

Wake-to-run works from sleep, not hibernate or shutdown, and only when wake
timers are permitted. On this machine they are **enabled on AC and disabled on
battery**, so a closed lid on battery will not wake for the 11:50 trigger — the
5-minute watchdog catches it whenever you next open the lid, and the posting
window absorbs the delay.

Check with `powercfg /query SCHEME_CURRENT SUB_SLEEP RTCWAKE` (`0x1` = enabled).
Enabling it on battery costs battery life and isn't necessary given the window.

For genuinely unattended posting, this still wants an always-on host — same
workflows, same files, somewhere that doesn't sleep.

## Operational notes

- **Re-importing deactivates workflows.** `n8n import:workflow` resets `active`
  to false. After any re-import, reactivate and restart:

  ```bash
  n8n update:workflow --id=tsInstagramPost04 --active=true
  n8n update:workflow --id=tsIgTokenRefresh5 --active=true
  ```

  Triggers are registered at boot, so a restart is required for the change to
  take effect. If the n8n server is running, the CLI needs its own ports:
  `N8N_RUNNERS_BROKER_PORT=5690 N8N_PORT=5691`.
- **Keep PowerShell scripts ASCII-only.** PowerShell 5.1 reads `.ps1` as ANSI
  unless there's a BOM, so an em dash in a comment becomes a parser error.
- **Back up** `~/.n8n/database.sqlite` and keep `N8N_ENCRYPTION_KEY` somewhere
  separate. One without the other is useless.
- `content-queue.json` is safe to commit — it's the content calendar. `.env`,
  `post-log.jsonl`, and `instagram-token.json` are gitignored and must stay that way.
- **The Instagram token is the one thing that dies from neglect.** Everything else
  degrades visibly; an expired Instagram token is unrecoverable without redoing
  the OAuth consent. Keep the refresh workflow active and don't ignore its alerts.
