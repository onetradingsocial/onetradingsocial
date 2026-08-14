# Database backup & restore

Schema lives in git (`app/supabase/migrations/`). Data is backed up by
`scripts/backup-db.mjs` to gzipped JSON per table under `backups/<timestamp>/`
(kept out of git; last 14 backups retained, older pruned automatically).

Both scripts are dependency-free — they call PostgREST over `fetch` and need
nothing but Node 18+. (They used to `import '@supabase/supabase-js'`, which is
unresolvable from `scripts/`: there is no `package.json` or `node_modules` at
the repo root, only under `app/`. That import meant neither script could run.)

## Naming the database — read this first

Backups and restores are **explicit about which project they touch**. There are
two named targets:

| `--target` | env file             | project ref            | region                  |
| ---------- | -------------------- | ---------------------- | ----------------------- |
| `prod`     | `scripts/.env.live`  | `jmpanzrjxflovdfwcbye` | ap-southeast-2 (Sydney) |
| `dev`      | `app/.env.local`     | `sixixwutvrguqemqzvvw` | ap-south-1 (Mumbai)     |

`app/.env.local` points at **dev**. `scripts/.env.live` points at **prod**.
Before this change `backup-db.mjs` read `app/.env.local` unconditionally and
printed nothing about the target, so a "production backup" would silently have
been a dev backup.

Both scripts now:

- print the resolved project ref, region and credential file **before** touching data;
- require `--project=<ref>` to match that ref (or, on an interactive terminal,
  ask you to type the ref) and refuse otherwise;
- refuse if the URL and the key in an env file belong to different projects;
- write/read a `manifest.json` recording which project a backup came from.

Scheduled (non-interactive) runs **must** pass `--project=<ref>` — there is no
terminal to confirm against, so the script refuses rather than guessing.

## Manual backup

Production:

```powershell
node scripts/backup-db.mjs --target=prod --project=jmpanzrjxflovdfwcbye
```

Dev:

```powershell
node scripts/backup-db.mjs --target=dev --project=sixixwutvrguqemqzvvw
```

Any other project — point at an env file directly:

```powershell
node scripts/backup-db.mjs --env=path\to\.env --project=<ref>
```

`--target` / `--env` / `--project` can also be given as `TS_BACKUP_TARGET`,
`TS_BACKUP_ENV`, `TS_BACKUP_PROJECT`. `--help` prints the usage.

## Scheduled daily backup (Windows Task Scheduler)

```powershell
schtasks /Create /TN "TradingSocial DB Backup" /SC DAILY /ST 03:00 `
  /TR "node C:\work\OneTradingSocial\Website\scripts\backup-db.mjs --target=prod --project=jmpanzrjxflovdfwcbye"
```

The old version of this doc used a `D:\Work\...` path that does not exist on
this machine, and omitted the target flags — so even if the task had been
registered it would have failed, and the task was never actually registered
(`schtasks /Query /TN "TradingSocial DB Backup"` returns "cannot find the file
specified"). Register it with the command above.

## Restore

There is **no default destination** — a restore writes, so it must be named.

Single table, top-up (upsert by primary key — safe, keeps newer rows):

```powershell
node scripts/restore-db.mjs 2026-08-14T03-18-19 trades --target=prod --project=jmpanzrjxflovdfwcbye
```

Single table, point-in-time (wipes current rows first, asks for confirmation):

```powershell
node scripts/restore-db.mjs 2026-08-14T03-18-19 trades --target=prod --project=jmpanzrjxflovdfwcbye --wipe
```

Restoring a backup into a project it did not come from is refused unless you
add `--allow-cross-project` (e.g. deliberately seeding dev from a prod dump).

Full disaster (new Supabase project):
1. Apply every migration in `app/supabase/migrations/` in order (Supabase MCP `apply_migration`, or SQL editor).
2. Restore tables in the `TABLES` order from `backup-db.mjs` (respects FK dependencies).
3. Recreate auth users (Supabase Auth is NOT in this backup — enable Supabase's own PITR/backups on Pro plan for auth + storage coverage).

## What a backup folder contains

- `<table>.json.gz` — one per table in `TABLES` (38 tables).
- `storage.buckets.json.gz`, `storage.objects.json.gz` — bucket config and the
  object inventory, pulled from the Storage API (the `storage` schema is not
  exposed through PostgREST). Object **bytes** are not downloaded, only metadata.
  These two cannot be fed back through `restore-db.mjs`; re-upload objects via
  the Storage API instead.
- `manifest.json` — source project ref, region, timestamp, per-table row counts,
  and any exposed table missing from `TABLES`.

`backup-db.mjs` compares `TABLES` against everything PostgREST exposes and warns
about any table it is not backing up. Twelve tables were missing from the list
before this change (`referral_codes`, `referral_clicks`, `admin_audit`,
`disposable_email_domains`, `trading_rules`, `trade_reports`, `feature_requests`,
`feature_request_votes`, `feature_request_comments`, `process_goals`,
`referrals`, `exchange_accounts`); they are covered now.

## Known limits
- `auth.users` is not covered — Supabase Pro's daily backups cover it.
- Storage object **contents** are not downloaded; only the object inventory and
  bucket config. Supabase Pro backups cover the bytes.
- Restore of `trades` fires audit triggers (rows appear in `trade_audits` as system inserts) — harmless, and preserves the immutability story.
- Paging is ordered by primary key so rows can't be skipped or doubled between
  pages; `ORDER_BY` in `backup-db.mjs` lists the tables whose PK is not `id`.

## Uptime monitoring (row 50)
Point a free UptimeRobot monitor at `https://app.tradingsocial.io/api/health`
(200 = app + DB healthy, 503 otherwise) and one at `https://www.tradingsocial.io`.
Failed background jobs (MT5 sync errors, failed imports) already raise
`system_alerts` via the daily watchdog cron.
