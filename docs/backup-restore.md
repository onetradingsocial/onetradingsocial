# Database backup & restore

Schema lives in git (`app/supabase/migrations/`). Data is backed up by
`scripts/backup-db.mjs` to gzipped JSON per table under `backups/<timestamp>/`
(kept out of git; last 14 backups retained, older pruned automatically).

## Manual backup

```powershell
node scripts/backup-db.mjs
```

Reads Supabase creds from `app/.env.local` (service role). No secrets in the script.

## Scheduled daily backup (Windows Task Scheduler)

```powershell
schtasks /Create /TN "TradingSocial DB Backup" /SC DAILY /ST 03:00 `
  /TR "node D:\Work\OneTradingSocial\Website\scripts\backup-db.mjs"
```

## Restore

Single table, top-up (upsert by primary key — safe, keeps newer rows):

```powershell
node scripts/restore-db.mjs 2026-07-15T03-00-00 trades
```

Single table, point-in-time (wipes current rows first, asks for confirmation):

```powershell
node scripts/restore-db.mjs 2026-07-15T03-00-00 trades --wipe
```

Full disaster (new Supabase project):
1. Apply every migration in `app/supabase/migrations/` in order (Supabase MCP `apply_migration`, or SQL editor).
2. Restore tables in the `TABLES` order from `backup-db.mjs` (respects FK dependencies).
3. Recreate auth users (Supabase Auth is NOT in this backup — enable Supabase's own PITR/backups on Pro plan for auth + storage coverage).

## Known limits
- `auth.users` and Storage objects (avatars, chart screenshots) are not covered — Supabase Pro's daily backups cover those; this script covers all `public` data.
- Restore of `trades` fires audit triggers (rows appear in `trade_audits` as system inserts) — harmless, and preserves the immutability story.

## Uptime monitoring (row 50)
Point a free UptimeRobot monitor at `https://app.tradingsocial.io/api/health`
(200 = app + DB healthy, 503 otherwise) and one at `https://www.tradingsocial.io`.
Failed background jobs (MT5 sync errors, failed imports) already raise
`system_alerts` via the daily watchdog cron.
