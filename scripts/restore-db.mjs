#!/usr/bin/env node
/**
 * Restore one table from a backup produced by backup-db.mjs.
 *
 *   node scripts/restore-db.mjs <backup-folder> <table> --target=dev --project=<ref> [--wipe]
 *
 * Default is UPSERT by primary key (safe top-up: refills missing/overwritten
 * rows without touching newer ones). --wipe deletes the table's rows first
 * for a clean point-in-time restore — it will ask for confirmation.
 *
 * Full-disaster path: replay app/supabase/migrations against a fresh project,
 * then restore every table in FK order (the TABLES order in backup-db.mjs).
 *
 * WHICH DATABASE gets written to is explicit and checked, for the same reason
 * backup-db.mjs checks it — except worse: this script writes. It used to read
 * app/.env.local unconditionally and say nothing about where the rows landed.
 * Now the target is named, the ref is printed before anything is written, and
 * --project=<ref> must match. It also reads the backup's manifest.json and
 * refuses to push prod rows into dev (or the reverse) without --allow-cross-project.
 *
 * No dependencies — talks to PostgREST over fetch. See the note in backup-db.mjs.
 */
import { readFileSync, existsSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import path from 'node:path'
import readline from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const TARGETS = {
  prod: { env: 'scripts/.env.live', ref: 'jmpanzrjxflovdfwcbye', region: 'ap-southeast-2 (Sydney)' },
  dev: { env: 'app/.env.local', ref: 'sixixwutvrguqemqzvvw', region: 'ap-south-1 (Mumbai)' },
}

const REGIONS = Object.fromEntries(Object.values(TARGETS).map((t) => [t.ref, t.region]))

// ---------------------------------------------------------------- args

const args = process.argv.slice(2)
const arg = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const has = (name) => args.includes(`--${name}`)
const positional = args.filter((a) => !a.startsWith('--'))

const [folder, table] = positional
if (!folder || !table) {
  console.error('Usage: node scripts/restore-db.mjs <backup-folder> <table> --target=prod|dev --project=<ref> [--wipe]')
  process.exit(1)
}

if (table.startsWith('storage.')) {
  console.error(`"${table}" is a Storage dump, not a PostgREST table — it cannot be upserted back.`)
  console.error('Re-upload the objects through the Storage API and recreate the bucket config by hand.')
  process.exit(1)
}

const targetName = arg('target') ?? process.env.TS_BACKUP_TARGET
const envArg = arg('env') ?? process.env.TS_BACKUP_ENV
const expectRef = arg('project') ?? process.env.TS_BACKUP_PROJECT

// No default target here on purpose. A restore should never guess.
const envRel = envArg ?? TARGETS[targetName]?.env
if (!envRel) {
  console.error(`Name the destination: --target=${Object.keys(TARGETS).join('|')} or --env=<path>.`)
  console.error('There is deliberately no default — restoring into the wrong project is unrecoverable.')
  process.exit(1)
}

// ---------------------------------------------------------------- creds

const envPath = path.isAbsolute(envRel) ? envRel : path.join(root, envRel)
if (!existsSync(envPath)) {
  console.error(`Env file not found: ${envPath}`)
  process.exit(1)
}

const raw = readFileSync(envPath, 'utf8')
const get = (k) => raw.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim().replace(/^"|"$/g, '')
const url = get('NEXT_PUBLIC_SUPABASE_URL')?.replace(/\/+$/, '')
const key = get('SUPABASE_SERVICE_ROLE_KEY')
if (!url || !key) {
  console.error(`Missing Supabase creds in ${envRel}`)
  process.exit(1)
}

const urlRef = new URL(url).host.split('.')[0]
const region = REGIONS[urlRef] ?? 'unknown region'
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

// Legacy JWT keys still carry ref/role; opaque sb_secret_ keys are settled by preflight.
const parts = key.split('.')
if (parts.length === 3 && key.startsWith('ey')) {
  try {
    const c = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    if (c.ref && c.ref !== urlRef) {
      console.error(`REFUSING: ${envRel} pairs a ${urlRef} URL with a ${c.ref} key.`)
      process.exit(1)
    }
  } catch { /* not a readable JWT; preflight will settle it */ }
}

// ---------------------------------------------------------------- payload

const file = path.join(root, 'backups', folder, `${table}.json.gz`)
if (!existsSync(file)) {
  console.error(`No such backup file: ${file}`)
  process.exit(1)
}
const rows = JSON.parse(gunzipSync(readFileSync(file)).toString())

const manifestPath = path.join(root, 'backups', folder, 'manifest.json')
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null

// ---------------------------------------------------------------- banner + guard

console.log('')
console.log('  Restoring')
console.log(`    from backup : ${folder}`)
console.log(`    source ref  : ${manifest?.ref ?? 'unknown (no manifest.json — pre-2026-08 backup)'}`)
console.log(`    table       : ${table} (${rows.length} rows)`)
console.log('  Into')
console.log(`    project ref : ${urlRef}`)
console.log(`    region      : ${region}`)
console.log(`    url         : ${url}`)
console.log(`    credentials : ${envRel}`)
console.log(`    mode        : ${has('wipe') ? 'WIPE then insert' : 'upsert (top-up)'}`)
console.log('')

if (manifest?.ref && manifest.ref !== urlRef && !has('allow-cross-project')) {
  console.error(`REFUSING: this backup came from ${manifest.ref}, you are restoring into ${urlRef}.`)
  console.error('If that is genuinely what you want, re-run with --allow-cross-project.')
  process.exit(1)
}

if (expectRef) {
  if (expectRef !== urlRef) {
    console.error(`REFUSING: --project=${expectRef} does not match the destination ref ${urlRef}.`)
    console.error('Nothing was written.')
    process.exit(1)
  }
} else if (process.stdin.isTTY) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question('Type the destination project ref to confirm: ')
  rl.close()
  if (answer.trim() !== urlRef) {
    console.error('Ref not confirmed. Aborted — nothing was written.')
    process.exit(1)
  }
} else {
  console.error('REFUSING: no --project=<ref> and no interactive terminal to confirm against.')
  console.error(`Add --project=${urlRef} to the command.`)
  process.exit(1)
}

// Confirm the key actually opens this project before we start writing.
const pre = await fetch(`${url}/rest/v1/`, { headers })
if (!pre.ok) {
  console.error(`REFUSING: ${urlRef} did not accept the key in ${envRel} (HTTP ${pre.status}).`)
  process.exit(1)
}

// ---------------------------------------------------------------- write

if (has('wipe')) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const a = await rl.question(`DELETE all current rows in "${table}" on ${urlRef} before restore? Type the table name to confirm: `)
  rl.close()
  if (a.trim() !== table) { console.log('Aborted.'); process.exit(1) }
  const res = await fetch(`${url}/rest/v1/${table}?created_at=gte.1970-01-01`, { method: 'DELETE', headers })
  if (!res.ok) { console.error('wipe failed:', await res.text()); process.exit(1) }
}

for (let i = 0; i < rows.length; i += 500) {
  const chunk = rows.slice(i, i + 500)
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(chunk),
  })
  if (!res.ok) { console.error(`chunk ${i}: ${await res.text()}`); process.exit(1) }
}
console.log(`Restored ${rows.length} rows into ${table} on ${urlRef}.`)
