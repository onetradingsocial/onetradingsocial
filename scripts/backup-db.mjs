#!/usr/bin/env node
/**
 * TradingSocial database backup (Sprint 2, row 51).
 *
 * Dumps every public table to gzipped JSON under backups/<timestamp>/ using a
 * Supabase secret (service_role) key. Schema itself is already version-controlled
 * in app/supabase/migrations, so data-level JSON is a complete recovery story:
 * replay migrations, then restore-db.mjs.
 *
 * Run:      node scripts/backup-db.mjs --target=prod --project=jmpanzrjxflovdfwcbye
 * Schedule: Windows Task Scheduler, daily (see docs/backup-restore.md)
 *
 * WHICH DATABASE gets backed up is now explicit and checked. It used to read
 * app/.env.local unconditionally — which points at DEV — so every backup this
 * script took was silently of the wrong project. Three things stop that now:
 *   1. the target is named on the command line, not implied by a hardcoded path;
 *   2. the resolved project ref is printed before a single row is read;
 *   3. --project=<ref> must match that ref, or the run is refused.
 *
 * No dependencies. It talks to PostgREST over fetch rather than through
 * @supabase/supabase-js, because there is no package.json at the repo root and
 * the bare import was unresolvable from scripts/ — the original script could
 * never actually run. Node 18+ has global fetch; we are on 22.
 */
import { readFileSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'
import readline from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/**
 * Named targets. Keeping these here — rather than letting the caller pass any
 * old path by default — means "prod" and "dev" mean exactly one thing each.
 */
const TARGETS = {
  prod: { env: 'scripts/.env.live', ref: 'jmpanzrjxflovdfwcbye', region: 'ap-southeast-2 (Sydney)' },
  dev: { env: 'app/.env.local', ref: 'sixixwutvrguqemqzvvw', region: 'ap-south-1 (Mumbai)' },
}

const REGIONS = Object.fromEntries(Object.values(TARGETS).map((t) => [t.ref, t.region]))

// ---------------------------------------------------------------- args

const args = process.argv.slice(2)
const arg = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const has = (name) => args.includes(`--${name}`)

const targetName = arg('target') ?? process.env.TS_BACKUP_TARGET ?? 'prod'
const envArg = arg('env') ?? process.env.TS_BACKUP_ENV
const expectRef = arg('project') ?? process.env.TS_BACKUP_PROJECT

if (has('help') || has('h')) {
  console.log(`
Usage: node scripts/backup-db.mjs [--target=prod|dev] [--env=<path>] --project=<ref>

  --target=prod   read scripts/.env.live   -> ${TARGETS.prod.ref}   (default)
  --target=dev    read app/.env.local      -> ${TARGETS.dev.ref}
  --env=<path>    read an arbitrary env file instead of a named target
  --project=<ref> required unless the terminal is interactive; must match the
                  project ref the credentials actually resolve to
`)
  process.exit(0)
}

const envRel = envArg ?? TARGETS[targetName]?.env
if (!envRel) {
  console.error(`Unknown --target=${targetName}. Known targets: ${Object.keys(TARGETS).join(', ')}.`)
  console.error('Or pass --env=<path> to point at an env file directly.')
  process.exit(1)
}

// ---------------------------------------------------------------- creds

const envPath = path.isAbsolute(envRel) ? envRel : path.join(root, envRel)
if (!existsSync(envPath)) {
  console.error(`Env file not found: ${envPath}`)
  process.exit(1)
}

function env(file) {
  const raw = readFileSync(file, 'utf8')
  const get = (k) => raw.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim().replace(/^"|"$/g, '')
  const url = get('NEXT_PUBLIC_SUPABASE_URL')
  const key = get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error(`Missing Supabase creds in ${file}`)
  return { url: url.replace(/\/+$/, ''), key }
}

const { url, key } = env(envPath)

/**
 * The ref the URL claims. Current Supabase secret keys (sb_secret_...) are
 * opaque — unlike the old JWTs they carry no ref/role claim — so the URL is the
 * only static source of a ref, and it can disagree with the key sitting beside
 * it. preflight() below settles that disagreement against the live API.
 * Legacy JWT keys are still cross-checked here for as long as any survive.
 */
const urlRef = new URL(url).host.split('.')[0]

function jwtClaims(token) {
  const parts = token.split('.')
  if (parts.length !== 3 || !token.startsWith('ey')) return null
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

const claims = jwtClaims(key)
if (claims) {
  if (claims.ref && claims.ref !== urlRef) {
    console.error(`REFUSING: ${envRel} pairs a ${urlRef} URL with a ${claims.ref} key.`)
    process.exit(1)
  }
  if (claims.role && claims.role !== 'service_role') {
    console.error(`REFUSING: key in ${envRel} has role "${claims.role}", not service_role.`)
    process.exit(1)
  }
}

const region = REGIONS[urlRef] ?? 'unknown region'

// ---------------------------------------------------------------- banner + guard

console.log('')
console.log('  Backing up')
console.log(`    project ref : ${urlRef}`)
console.log(`    region      : ${region}`)
console.log(`    url         : ${url}`)
console.log(`    credentials : ${envRel}`)
console.log(`    key type    : ${claims ? 'legacy JWT service_role' : 'sb_secret_ (opaque)'}`)
console.log('')

if (expectRef) {
  if (expectRef !== urlRef) {
    console.error(`REFUSING: --project=${expectRef} does not match the resolved ref ${urlRef}.`)
    console.error('Nothing was read. Check --target / --env, or fix the ref you passed.')
    process.exit(1)
  }
} else if (process.stdin.isTTY) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(`Type the project ref to confirm you mean this database: `)
  rl.close()
  if (answer.trim() !== urlRef) {
    console.error('Ref not confirmed. Aborted — nothing was read.')
    process.exit(1)
  }
} else {
  // Scheduled runs have no terminal to prompt. They must state the ref up front.
  console.error('REFUSING: no --project=<ref> and no interactive terminal to confirm against.')
  console.error(`Add --project=${urlRef} to the command (scheduled tasks must be explicit).`)
  process.exit(1)
}

// ---------------------------------------------------------------- tables

/**
 * Restore order — respects FK dependencies, so restore-db.mjs can walk it
 * top to bottom. ORDER_BY holds the primary key for tables whose PK is not
 * "id"; paging without a stable sort can drop or duplicate rows across pages.
 */
const TABLES = [
  'profiles', 'trades', 'trade_audits', 'broker_accounts', 'exchange_accounts',
  'trade_templates', 'trading_rules', 'trade_reports', 'process_goals',
  'posts', 'post_images', 'poll_options', 'poll_votes', 'comments', 'likes',
  'follows', 'favorites', 'conversations', 'messages', 'notifications',
  'courses', 'lessons', 'quiz_questions', 'quiz_options', 'lesson_completions',
  'feedback', 'feature_requests', 'feature_request_votes', 'feature_request_comments',
  'subscriptions', 'referral_codes', 'referral_clicks', 'referrals',
  'feature_flags', 'analytics_events', 'system_alerts', 'admin_audit',
  'disposable_email_domains',
]

const ORDER_BY = {
  disposable_email_domains: 'domain',
  favorites: 'user_id,favorite_id',
  feature_flags: 'feature',
  feature_request_votes: 'request_id,user_id',
  follows: 'follower_id,following_id',
  likes: 'post_id,user_id',
  poll_votes: 'post_id,user_id',
  referral_codes: 'user_id',
  trading_rules: 'user_id',
}

const PAGE = 1000
const KEEP_LAST = 14 // prune older backup folders

const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }

async function rest(pathname, params = '') {
  const res = await fetch(`${url}${pathname}${params}`, { headers })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json()
}

/** Fail fast and loudly if the key does not actually open this project. */
async function preflight() {
  const res = await fetch(`${url}/rest/v1/`, { headers })
  if (res.status === 401 || res.status === 403) {
    console.error(`REFUSING: the key in ${envRel} is not accepted by ${urlRef}.`)
    console.error('A URL and a key from two different projects are sitting in the same file.')
    process.exit(1)
  }
  if (!res.ok) throw new Error(`preflight failed: ${res.status} ${await res.text()}`)
  return res.json()
}

async function dumpTable(table) {
  const order = ORDER_BY[table] ?? 'id'
  const sort = order.split(',').map((c) => `${c}.asc`).join(',')
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const page = await rest(
      `/rest/v1/${table}`,
      `?select=*&order=${encodeURIComponent(sort)}&offset=${from}&limit=${PAGE}`,
    ).catch((e) => {
      throw new Error(`${table}: ${e.message}`)
    })
    rows.push(...page)
    if (page.length < PAGE) break
  }
  return rows
}

/**
 * Storage lives outside PostgREST, so it needs the Storage API. Object rows and
 * bucket config are what the public-URL columns point at — losing them loses the
 * meaning of every avatar_url / screenshot_url in the dump.
 */
async function dumpStorage(dir) {
  const out = {}
  try {
    const buckets = await rest('/storage/v1/bucket')
    writeFileSync(path.join(dir, 'storage.buckets.json.gz'), gzipSync(JSON.stringify(buckets)))
    out.buckets = buckets.length
    // list is NOT recursive: a folder comes back as an entry with id === null,
    // so walk into every one of those or you capture nothing but directory names.
    const listFolder = async (bucket, prefix) => {
      const res = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix, limit: 10000, sortBy: { column: 'name', order: 'asc' } }),
      })
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
      const found = []
      for (const o of await res.json()) {
        const full = prefix ? `${prefix}/${o.name}` : o.name
        if (o.id === null) found.push(...(await listFolder(bucket, full)))
        else found.push({ bucket, path: full, ...o })
      }
      return found
    }
    const objects = []
    for (const b of buckets) objects.push(...(await listFolder(b.name, '')))
    writeFileSync(path.join(dir, 'storage.objects.json.gz'), gzipSync(JSON.stringify(objects)))
    out.objects = objects.length
  } catch (e) {
    console.log(`storage dump skipped: ${e.message}`)
    out.error = e.message
  }
  return out
}

// ---------------------------------------------------------------- run

const spec = await preflight()

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const dir = path.join(root, 'backups', stamp)
mkdirSync(dir, { recursive: true })

// Anything PostgREST exposes that TABLES forgot is data nobody is backing up.
const exposed = Object.keys(spec.paths ?? {})
  .filter((p) => p !== '/' && !p.startsWith('/rpc/'))
  .map((p) => p.slice(1))
const missed = exposed.filter((t) => !TABLES.includes(t))
if (missed.length) console.log(`WARNING: not in TABLES, not backed up: ${missed.join(', ')}\n`)

const counts = {}
let total = 0
for (const table of TABLES) {
  const rows = await dumpTable(table)
  writeFileSync(path.join(dir, `${table}.json.gz`), gzipSync(JSON.stringify(rows)))
  counts[table] = rows.length
  total += rows.length
  console.log(`${table.padEnd(26)} ${rows.length} rows`)
}

const storage = await dumpStorage(dir)
if (storage.objects !== undefined) {
  console.log(`${'storage.objects'.padEnd(26)} ${storage.objects} objects in ${storage.buckets} bucket(s)`)
}

/**
 * The manifest is what lets restore-db.mjs tell you which database a folder of
 * .json.gz files came out of. Without it a backup is anonymous, which is how
 * this whole mess started.
 */
writeFileSync(
  path.join(dir, 'manifest.json'),
  JSON.stringify(
    { ref: urlRef, region, url, envFile: envRel, takenAt: new Date().toISOString(), totalRows: total, counts, storage, uncovered: missed },
    null,
    2,
  ),
)

console.log(`\nBackup complete: ${dir}`)
console.log(`${total} rows across ${TABLES.length} tables from ${urlRef} (${region})`)

// Prune old backups.
const backupsRoot = path.join(root, 'backups')
const dirs = readdirSync(backupsRoot).sort()
for (const d of dirs.slice(0, Math.max(0, dirs.length - KEEP_LAST))) {
  rmSync(path.join(backupsRoot, d), { recursive: true, force: true })
  console.log(`pruned old backup ${d}`)
}
