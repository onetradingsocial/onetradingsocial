#!/usr/bin/env node
/**
 * TradingSocial database backup (Sprint 2, row 51).
 *
 * Dumps every public table to gzipped JSON under backups/<timestamp>/ using
 * the Supabase service role (reads creds from app/.env.local — no secrets
 * embedded here). Schema itself is already version-controlled in
 * app/supabase/migrations, so data-level JSON is a complete recovery story:
 * replay migrations, then restore-db.mjs.
 *
 * Run:      node scripts/backup-db.mjs
 * Schedule: Windows Task Scheduler, daily (see docs/backup-restore.md)
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

function env() {
  const raw = readFileSync(path.join(root, 'app', '.env.local'), 'utf8')
  const get = (k) => raw.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim().replace(/^"|"$/g, '')
  const url = get('NEXT_PUBLIC_SUPABASE_URL')
  const key = get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Missing Supabase creds in app/.env.local')
  return { url, key }
}

const TABLES = [
  'profiles', 'trades', 'trade_audits', 'broker_accounts', 'trade_templates',
  'posts', 'post_images', 'poll_options', 'poll_votes', 'comments', 'likes',
  'follows', 'favorites', 'conversations', 'messages', 'notifications',
  'courses', 'lessons', 'quiz_questions', 'quiz_options', 'lesson_completions',
  'feedback', 'subscriptions', 'feature_flags', 'analytics_events', 'system_alerts',
]

const PAGE = 1000
const KEEP_LAST = 14 // prune older backup folders

async function dumpTable(supabase, table) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return rows
}

const { url, key } = env()
const supabase = createClient(url, key, { auth: { persistSession: false } })
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const dir = path.join(root, 'backups', stamp)
mkdirSync(dir, { recursive: true })

let total = 0
for (const table of TABLES) {
  const rows = await dumpTable(supabase, table)
  writeFileSync(path.join(dir, `${table}.json.gz`), gzipSync(JSON.stringify(rows)))
  total += rows.length
  console.log(`${table.padEnd(22)} ${rows.length} rows`)
}
console.log(`\nBackup complete: ${dir} (${total} rows)`)

// Prune old backups.
const backupsRoot = path.join(root, 'backups')
const dirs = readdirSync(backupsRoot).sort()
for (const d of dirs.slice(0, Math.max(0, dirs.length - KEEP_LAST))) {
  rmSync(path.join(backupsRoot, d), { recursive: true, force: true })
  console.log(`pruned old backup ${d}`)
}
