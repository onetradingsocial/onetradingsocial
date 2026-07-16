#!/usr/bin/env node
/**
 * Restore one table from a backup produced by backup-db.mjs.
 *
 *   node scripts/restore-db.mjs <backup-folder> <table> [--wipe]
 *
 * Default is UPSERT by primary key (safe top-up: refills missing/overwritten
 * rows without touching newer ones). --wipe deletes the table's rows first
 * for a clean point-in-time restore — it will ask for confirmation.
 *
 * Full-disaster path: replay app/supabase/migrations against a fresh project,
 * then restore every table in FK order (the TABLES order in backup-db.mjs).
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import path from 'node:path'
import readline from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const [folder, table, flag] = process.argv.slice(2)
if (!folder || !table) {
  console.error('Usage: node scripts/restore-db.mjs <backup-folder> <table> [--wipe]')
  process.exit(1)
}

const raw = readFileSync(path.join(root, 'app', '.env.local'), 'utf8')
const get = (k) => raw.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim().replace(/^"|"$/g, '')
const supabase = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

const file = path.join(root, 'backups', folder, `${table}.json.gz`)
const rows = JSON.parse(gunzipSync(readFileSync(file)).toString())
console.log(`${rows.length} rows in ${file}`)

if (flag === '--wipe') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const a = await rl.question(`DELETE all current rows in "${table}" before restore? Type the table name to confirm: `)
  rl.close()
  if (a.trim() !== table) { console.log('Aborted.'); process.exit(1) }
  const { error } = await supabase.from(table).delete().gte('created_at', '1970-01-01')
  if (error) { console.error('wipe failed:', error.message); process.exit(1) }
}

for (let i = 0; i < rows.length; i += 500) {
  const chunk = rows.slice(i, i + 500)
  const { error } = await supabase.from(table).upsert(chunk)
  if (error) { console.error(`chunk ${i}: ${error.message}`); process.exit(1) }
}
console.log(`Restored ${rows.length} rows into ${table}.`)
