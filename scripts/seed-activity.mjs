#!/usr/bin/env node
/*
 * seed-activity.mjs — one "activity tick" for the seeded TradingSocial demo users.
 *
 * Each run generates a small, realistic burst of fresh activity with CURRENT
 * timestamps: new trades (some closed), new posts (text / trade-share / poll),
 * likes, comments, the odd new follow, and matching notifications.
 *
 * Post / comment / poll / trade-note TEXT is generated fresh each tick by Claude
 * via the Claude Code CLI in headless mode (`claude -p`), which authenticates
 * with your Claude subscription — no API key needed. Usage counts against your
 * subscription, not a credit card. If the CLI is missing or the call fails, it
 * falls back to a small static pool so a scheduled tick still produces activity
 * instead of hard-failing.
 *
 * Safe to run repeatedly (follows/likes/votes upsert-ignore duplicates).
 * Reads Supabase + Anthropic creds from ../app/.env.local at runtime — no secrets embedded.
 *
 * Usage:
 *   node scripts/seed-activity.mjs            # default batch
 *   node scripts/seed-activity.mjs --users 5  # cap active users this tick
 *   node scripts/seed-activity.mjs --dry      # print plan, write nothing
 *   node scripts/seed-activity.mjs --no-ai    # skip Claude, use static fallback pool
 *
 * Requires the `claude` CLI installed + logged in (Claude subscription) for AI
 * content. Override the binary path with the CLAUDE_BIN env var if not on PATH.
 */
import { createClient } from '../app/node_modules/@supabase/supabase-js/dist/index.mjs'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dir = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const DRY = argv.includes('--dry')
const NO_AI = argv.includes('--no-ai')
const usersArg = (() => { const i = argv.indexOf('--users'); return i >= 0 ? parseInt(argv[i + 1], 10) : null })()
// --content <file>: JSON content pool supplied by the caller (e.g. the
// seed-trading-activity skill, where Claude writes the batch directly). Takes
// precedence over the CLI generator — reliable, no subprocess auth needed.
const contentFile = (() => { const i = argv.indexOf('--content'); return i >= 0 ? argv[i + 1] : null })()

// Model for content generation, passed to `claude -p --model`. Haiku keeps
// subscription-usage low for this high-frequency background job; swap for
// 'claude-sonnet-4-6' or 'claude-opus-4-8' for higher quality.
const MODEL = 'claude-haiku-4-5'
// `claude` CLI binary. Override with CLAUDE_BIN if it's not on the task's PATH.
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'C:\\Users\\edria\\.local\\bin\\claude.exe'

// ---- env ----
const envText = readFileSync(join(__dir, '..', 'app', '.env.local'), 'utf8')
const env = {}
for (const l of envText.split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !SERVICE) throw new Error('Missing Supabase env in app/.env.local')
const admin = createClient(URL_, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })

const USERNAMES = ['mateorivera','aishakhan','liamnguyen','sofiarossi','noahandersson','priyasharma','ethanobrien','yukitanaka','zaraahmed','diegofernandez']

// ---- helpers ----
const pick = (a) => a[Math.floor(Math.random() * a.length)]
const pickN = (a, n) => { const s = [...a], o = []; while (o.length < n && s.length) o.push(s.splice(Math.floor(Math.random() * s.length), 1)[0]); return o }
const rnd = (a, b) => a + Math.random() * (b - a)
const chance = (p) => Math.random() < p
const shuffle = (a) => { const s = [...a]; for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[s[i], s[j]] = [s[j], s[i]] } return s }
const now = () => Date.now()
const isoAgo = (mins) => new Date(now() - mins * 60000).toISOString()

// ---- instrument catalog (mirror src/lib/instruments.ts) ----
const INSTRUMENTS = [
  { symbol: 'EUR/USD', market: 'forex', pipSize: 0.0001, base: 1.085 },
  { symbol: 'GBP/USD', market: 'forex', pipSize: 0.0001, base: 1.272 },
  { symbol: 'USD/JPY', market: 'forex', pipSize: 0.01, base: 157.4 },
  { symbol: 'XAU/USD', market: 'commodities', pipSize: 0.1, base: 2330 },
  { symbol: 'BTC/USD', market: 'crypto', pipSize: 1, base: 61000 },
  { symbol: 'ETH/USD', market: 'crypto', pipSize: 0.1, base: 3350 },
  { symbol: 'NAS100', market: 'indices', pipSize: 1, base: 19800 },
  { symbol: 'US30', market: 'indices', pipSize: 1, base: 39200 },
]
const SETUPS = ['Breakout', 'Retest', 'Trend Continuation', 'News Play']
const CONF = ['low', 'medium', 'high']
const EMO = ['calm', 'focused', 'excited', 'anxious']
const STRATS = ['Support/Resistance', 'EMA pullback', 'Liquidity sweep', 'Order block', 'VWAP bounce']

// ---- static FALLBACK content (used only if AI generation is unavailable) ----
const FALLBACK = {
  postText: [
    'Green day on the books. Process over profits. 📈',
    'Your stop loss is not a suggestion. Protect the account first.',
    'Waited for the retest instead of chasing. Patience paid.',
    'Cut to 2 A+ setups a day and the equity curve smoothed out.',
    'Red day but zero rule breaks. That\'s a win. On to tomorrow.',
    'Journaling every trade is the cheapest edge you can buy.',
    'Risk 1% to make 3%. Let the math work.',
    'The market rewards discipline, not conviction.',
    'Prop challenge update: grinding, drawdown untouched.',
    'Sat through the chop, caught the clean afternoon trend.',
  ],
  tradeCaptions: [
    'Textbook execution 👇', 'Called the level, waited, banked it.',
    'Full breakdown on this setup:', 'This is what patience looks like.',
    'Tight risk, let the runner run.',
  ],
  comments: [
    'Clean setup 🔥', 'Discipline > everything.', 'What was your R:R here?',
    'Scale out or full TP?', 'Needed this today, thanks.', 'Respect the risk mgmt 👏',
    'Following your journey.', 'How long in the trade?', 'Saving this one.', 'Patience is the edge.',
  ],
  tradeNotes: [
    'Clean setup off the daily level, waited for confirmation.',
    'Took the break of structure, managed risk tight.',
    'Momentum play into session open, scaled out at target.',
    'Pullback into demand, followed the plan.',
    'Slight FOMO on entry but respected the stop.',
    'News spike faded, reversal entry worked out.',
  ],
  polls: [
    { q: 'Best market for intraday edge right now?', opts: ['Forex majors', 'Indices', 'Crypto', 'Gold'] },
    { q: 'Trades per day sweet spot?', opts: ['1–2 A+', '3–5', '6+', 'Depends on vol'] },
    { q: 'Biggest leak in your trading?', opts: ['Overtrading', 'Moving stops', 'FOMO', 'Cutting winners early'] },
    { q: 'Preferred session to trade?', opts: ['London', 'New York', 'Asia', 'Overlap only'] },
  ],
}

// ---- AI content generation (via Claude Code CLI, subscription auth) ----
// Returns a content pool { postText[], tradeCaptions[], comments[], tradeNotes[], polls[{q,opts}] }.
// Falls back to the static pool on any failure so a scheduled tick never dies.
function validatePool(data, source) {
  for (const k of ['postText', 'tradeCaptions', 'comments', 'tradeNotes']) {
    if (!Array.isArray(data[k]) || data[k].length === 0) throw new Error(`bad field ${k}`)
  }
  const polls = Array.isArray(data.polls)
    ? data.polls.filter((p) => p && typeof p.q === 'string' && Array.isArray(p.opts) && p.opts.length >= 2)
        .map((p) => ({ q: p.q, opts: p.opts.slice(0, 4) }))
    : []
  return {
    postText: data.postText.map(String),
    tradeCaptions: data.tradeCaptions.map(String),
    comments: data.comments.map(String),
    tradeNotes: data.tradeNotes.map(String),
    polls: polls.length ? polls : FALLBACK.polls,
    source,
  }
}

function buildContentPool() {
  // Caller-supplied content (skill path) wins — no subprocess, no auth issues.
  if (contentFile) return validatePool(JSON.parse(readFileSync(contentFile, 'utf8')), 'provided')
  if (NO_AI) return { ...FALLBACK, source: 'fallback' }

  const prompt =
    `Generate fresh, authentic social content for TradingSocial — a community app where retail traders ` +
    `share a trading journal. Voice: real retail traders (forex, indices, crypto, gold), mixed experience ` +
    `levels. Natural, varied, sometimes casual with light emoji, never corporate or spammy. No hashtags, no ` +
    `@mentions, no financial advice or specific price predictions.\n\n` +
    `Output ONLY raw JSON (no markdown fences, no commentary) with exactly this shape:\n` +
    `{"postText":[10 strings],"tradeCaptions":[6 strings],"comments":[14 strings],"tradeNotes":[8 strings],` +
    `"polls":[4 objects each {"q":string,"opts":[4 strings]}]}\n\n` +
    `- postText: standalone feed posts (< 240 chars each): trading psychology, discipline, risk, journaling, ` +
    `wins/losses, process reflections. Distinct angles, no repetition.\n` +
    `- tradeCaptions: short captions (< 100 chars) for a post sharing a specific trade.\n` +
    `- comments: short replies (< 110 chars) another trader leaves on a post.\n` +
    `- tradeNotes: first-person journal notes (< 140 chars) a trader writes on their own trade.\n` +
    `- polls: community poll questions, each with exactly 4 short options.\n` +
    `Make this batch feel different from a generic template — vary structure, length, and tone.`

  // headless Claude Code run; --output-format json wraps the reply in an envelope.
  // input:'' closes stdin with EOF so claude doesn't block waiting for piped input
  // (critical under Task Scheduler, which gives the process no stdin handle).
  const stdout = execFileSync(
    CLAUDE_BIN,
    ['-p', prompt, '--model', MODEL, '--output-format', 'json'],
    { encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024, input: '' },
  )
  const envelope = JSON.parse(stdout)
  if (envelope.is_error) throw new Error(envelope.result || 'claude cli error')
  let text = String(envelope.result || '').trim()
  // strip accidental ```json ... ``` fences
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  // tolerate any preamble/suffix prose: slice to the outermost { ... }
  const start = text.indexOf('{'), end = text.lastIndexOf('}')
  if (start >= 0 && end > start) text = text.slice(start, end + 1)
  return validatePool(JSON.parse(text), `ai:${MODEL}`)
}

function buildTrade(balance, tradedAtMs, C) {
  const inst = pick(INSTRUMENTS)
  const dp = inst.pipSize < 1 ? 4 : 1
  const dir = chance(0.5) ? 'long' : 'short'
  const s = dir === 'long' ? 1 : -1
  const entry = +(inst.base * (1 + rnd(-0.004, 0.004))).toFixed(dp)
  const slWanted = rnd(15, 60)
  const stop = +(entry - s * slWanted * inst.pipSize).toFixed(dp)
  const rr = +rnd(1.3, 3).toFixed(2)
  const target = +(entry + s * slWanted * rr * inst.pipSize).toFixed(dp)
  const slPips = Math.abs(entry - stop) / inst.pipSize
  const tpPips = Math.abs(target - entry) / inst.pipSize
  const plannedRr = Math.abs(target - entry) / Math.abs(entry - stop)
  const riskPercent = +rnd(0.5, 2).toFixed(2)
  const riskAmount = balance * (riskPercent / 100)
  const row = {
    market: inst.market, instrument: inst.symbol, direction: dir, sizing_mode: 'risk_percent',
    entry_price: entry, stop_price: stop, target_price: target,
    risk_percent: riskPercent, lots: null, risk_amount: riskAmount,
    sl_pips: slPips, tp_pips: tpPips, planned_rr: plannedRr,
    setup_type: pick(SETUPS), confidence: pick(CONF), emotion: pick(EMO),
    note: pick(C.tradeNotes), is_public: true,
    mistake_tags: chance(0.35) ? [pick(['FOMO', 'Exited too early', 'Held too long', 'Moved stop loss'])] : [],
    strategy_tags: pickN(STRATS, chance(0.5) ? 2 : 1),
    traded_at: new Date(tradedAtMs).toISOString(),
  }
  if (chance(0.7)) {
    const roll = Math.random()
    let exitPips
    if (roll < 0.5) exitPips = tpPips * rnd(0.7, 1)
    else if (roll < 0.85) exitPips = -slPips * rnd(0.85, 1)
    else exitPips = rnd(-2, 2)
    const exit = +(entry + s * exitPips * inst.pipSize).toFixed(dp)
    const realizedPips = ((exit - entry) * s) / inst.pipSize
    const rMultiple = realizedPips / slPips
    const EPS = 1e-9
    Object.assign(row, {
      status: 'closed', exit_price: exit, r_multiple: rMultiple,
      pnl_amount: rMultiple * riskAmount, realized_pips: realizedPips,
      outcome: rMultiple > EPS ? 'win' : rMultiple < -EPS ? 'loss' : 'breakeven',
      closed_at: new Date(tradedAtMs + rnd(20, 55) * 60000).toISOString(),
    })
  } else {
    Object.assign(row, { status: 'open', outcome: 'open' })
  }
  return row
}

// ---- content pool for this tick ----
let C
try {
  C = buildContentPool()
} catch (e) {
  // Surface the auth/parse reason but keep it to one line; static fallback keeps the tick alive.
  let why = e.message.split('\n')[0]
  try { const o = JSON.parse(e.stdout || '{}'); if (o.result) why = o.result } catch {}
  console.warn(`[AI content unavailable: ${why} — using static fallback]`)
  C = { ...FALLBACK, source: 'fallback' }
}

// ---- load users ----
const { data: profs, error: pe } = await admin.from('profiles').select('id, username, account_balance').in('username', USERNAMES)
if (pe) throw pe

// how many users act this tick
const activeCount = usersArg ?? (3 + Math.floor(Math.random() * 4)) // 3..6
const active = shuffle(profs).slice(0, Math.min(activeCount, profs.length))

const plan = { trades: 0, closedOpen: 0, posts: 0, polls: 0, likes: 0, comments: 0, follows: 0, notifs: 0 }
const tradeRows = [], postSpecs = [], likeRows = [], commentRows = [], followRows = [], notif = []
const likeSet = new Set()

// 1) trades — each active user logs 1, sometimes 2, with recent timestamps
for (const u of active) {
  const n = chance(0.3) ? 2 : 1
  for (let i = 0; i < n; i++) {
    tradeRows.push({ ...buildTrade(u.account_balance || 10000, now() - rnd(2, 90) * 60000, C), user_id: u.id })
    plan.trades++
  }
}

// 2) also close a random existing OPEN trade for ~half of active users
const { data: openTrades } = await admin.from('trades')
  .select('id, user_id, market, instrument, direction, entry_price, stop_price, risk_amount')
  .eq('status', 'open').in('user_id', active.map(u => u.id)).limit(50)
const closeUpdates = []
for (const u of active) {
  if (!chance(0.5)) continue
  const mine = (openTrades || []).filter(t => t.user_id === u.id)
  if (!mine.length) continue
  const t = pick(mine)
  const pipSize = INSTRUMENTS.find(x => x.symbol === t.instrument)?.pipSize ?? (t.instrument.includes('JPY') ? 0.01 : t.market === 'forex' ? 0.0001 : 1)
  const s = t.direction === 'long' ? 1 : -1
  const slPips = Math.abs(t.entry_price - t.stop_price) / pipSize
  const win = chance(0.55)
  const exitPips = win ? slPips * rnd(1, 2.4) : -slPips * rnd(0.8, 1)
  const exit = +(t.entry_price + s * exitPips * pipSize).toFixed(pipSize < 1 ? 4 : 1)
  const realizedPips = ((exit - t.entry_price) * s) / pipSize
  const rMultiple = realizedPips / slPips
  const EPS = 1e-9
  closeUpdates.push({ id: t.id, exit, rMultiple, pnl: rMultiple * t.risk_amount, realizedPips,
    outcome: rMultiple > EPS ? 'win' : rMultiple < -EPS ? 'loss' : 'breakeven' })
  plan.closedOpen++
}

// 3) posts — ~55% of active users post
for (const u of active) {
  if (!chance(0.55)) continue
  const roll = Math.random()
  const createdAt = isoAgo(rnd(1, 120))
  if (roll < 0.3) {
    postSpecs.push({ kind: 'trade', author: u.id, body: pick(C.tradeCaptions), createdAt })
  } else if (roll < 0.45) {
    postSpecs.push({ kind: 'poll', author: u.id, poll: pick(C.polls), createdAt })
    plan.polls++
  } else {
    postSpecs.push({ kind: 'text', author: u.id, body: pick(C.postText), createdAt })
  }
  plan.posts++
}

// 4) occasional new follow
for (const u of active) {
  if (!chance(0.25)) continue
  const target = pick(profs.filter(p => p.id !== u.id))
  followRows.push({ follower_id: u.id, following_id: target.id, created_at: isoAgo(rnd(1, 120)) })
  notif.push({ user_id: target.id, actor_id: u.id, type: 'follow', entity_id: null, entity_type: null, read: false, created_at: isoAgo(rnd(1, 120)) })
  plan.follows++
}

if (DRY) {
  console.log('DRY RUN — content:', C.source, '| plan:', JSON.stringify({ ...plan, activeUsers: active.map(u => u.username) }, null, 2))
  process.exit(0)
}

// ---- writes ----
// trades
if (tradeRows.length) { const { error } = await admin.from('trades').insert(tradeRows); if (error) throw error }
// close open trades
for (const c of closeUpdates) {
  await admin.from('trades').update({
    status: 'closed', outcome: c.outcome, exit_price: c.exit,
    r_multiple: c.rMultiple, pnl_amount: c.pnl, realized_pips: c.realizedPips,
    closed_at: new Date().toISOString(),
  }).eq('id', c.id)
}
// posts (need ids for trade-share link, poll opts, likes/comments)
const baseInserts = []
for (const spec of postSpecs) {
  if (spec.kind === 'trade') baseInserts.push({ author_id: spec.author, body: spec.body, attachment_type: 'trade', created_at: spec.createdAt })
  else if (spec.kind === 'poll') baseInserts.push({ author_id: spec.author, body: spec.poll.q, attachment_type: 'poll', created_at: spec.createdAt })
  else baseInserts.push({ author_id: spec.author, body: spec.body, attachment_type: 'none', created_at: spec.createdAt })
}
let insertedPosts = []
if (baseInserts.length) {
  const { data, error } = await admin.from('posts').insert(baseInserts).select('id, author_id, attachment_type, created_at')
  if (error) throw error
  insertedPosts = data
}
// link trade-share posts to a real trade by that author
const tradeShareIdx = insertedPosts.map((p, i) => ({ p, spec: postSpecs[i] })).filter(x => x.spec.kind === 'trade')
if (tradeShareIdx.length) {
  const { data: recentTrades } = await admin.from('trades').select('id, user_id')
    .in('user_id', tradeShareIdx.map(x => x.p.author_id)).order('traded_at', { ascending: false }).limit(100)
  for (const { p } of tradeShareIdx) {
    const t = (recentTrades || []).find(r => r.user_id === p.author_id)
    if (t) await admin.from('posts').update({ trade_id: t.id }).eq('id', p.id)
  }
}
// poll options + votes
for (let i = 0; i < insertedPosts.length; i++) {
  const post = insertedPosts[i], spec = postSpecs[i]
  if (post.attachment_type !== 'poll') continue
  const { data: opts } = await admin.from('poll_options')
    .insert(spec.poll.opts.map((label, ord) => ({ post_id: post.id, label, ord }))).select('id')
  const voters = shuffle(profs).slice(0, 4 + Math.floor(Math.random() * 5))
  const votes = voters.map(v => ({ post_id: post.id, option_id: pick(opts).id, user_id: v.id, created_at: isoAgo(rnd(1, 90)) }))
  await admin.from('poll_votes').upsert(votes, { onConflict: 'post_id,user_id', ignoreDuplicates: true })
}
// follows
if (followRows.length) await admin.from('follows').upsert(followRows, { onConflict: 'follower_id,following_id', ignoreDuplicates: true })

// 5) engagement on recent posts (last 2 days) — likes + comments + notifs
const { data: recentPosts } = await admin.from('posts')
  .select('id, author_id').gte('created_at', isoAgo(60 * 24 * 2)).order('created_at', { ascending: false }).limit(60)
for (const post of recentPosts || []) {
  // likes
  const likers = shuffle(profs.filter(p => p.id !== post.author_id)).slice(0, Math.floor(rnd(0, 4)))
  for (const l of likers) {
    const key = `${post.id}:${l.id}`; if (likeSet.has(key)) continue; likeSet.add(key)
    likeRows.push({ post_id: post.id, user_id: l.id, created_at: isoAgo(rnd(1, 120)) })
    if (chance(0.5)) { notif.push({ user_id: post.author_id, actor_id: l.id, type: 'like', entity_id: post.id, entity_type: 'post', read: false, created_at: isoAgo(rnd(1, 120)) }); }
    plan.likes++
  }
  // comments
  if (chance(0.35)) {
    const c = pick(profs.filter(p => p.id !== post.author_id))
    const createdAt = isoAgo(rnd(1, 100))
    commentRows.push({ post_id: post.id, author_id: c.id, body: pick(C.comments), created_at: createdAt })
    notif.push({ user_id: post.author_id, actor_id: c.id, type: 'comment', entity_id: post.id, entity_type: 'post', read: false, created_at: createdAt })
    plan.comments++
  }
}
if (likeRows.length) await admin.from('likes').upsert(likeRows, { onConflict: 'post_id,user_id', ignoreDuplicates: true })
if (commentRows.length) { const { error } = await admin.from('comments').insert(commentRows); if (error) throw error }

// notifications (drop self-notifs)
const clean = notif.filter(n => n.user_id !== n.actor_id)
if (clean.length) { const { error } = await admin.from('notifications').insert(clean); if (error) throw error }
plan.notifs = clean.length

console.log(`[${new Date().toISOString()}] tick OK — content:${C.source} active:${active.length} ` +
  `trades:${plan.trades} closed:${plan.closedOpen} posts:${plan.posts}(poll ${plan.polls}) ` +
  `likes:${plan.likes} comments:${plan.comments} follows:${plan.follows} notifs:${plan.notifs}`)
