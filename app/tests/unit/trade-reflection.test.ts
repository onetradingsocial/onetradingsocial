// app/tests/unit/trade-reflection.test.ts
//
// Per-trade rule reflection — audit 2026-09-05, Wave D4.
//
// "After a trade is saved or imported, ask whether it followed the chosen rule
// — yes, no or unsure — with an optional short sentence." Ungated, every tier.
// This is the third step of the improvement cycle and the evidence the basic
// weekly review counts.
//
// Four things are worth a guard, and they are the four this file covers:
//
//   1. THE WRITE PATH. `saveTradeReflection` writes the two reflection columns
//      and nothing else. An UPDATE that RLS refuses is silent, so the action
//      has to read the result back or a user answers the prompt, sees a tick,
//      and finds the trade unanswered.
//
//   2. THE IMPORTED TRADE. Import is how most real evidence arrives. A
//      reflection that could not be written on a broker-synced row would defeat
//      the feature, and the thing that keeps it writable is 0028's trigger
//      being a WHITELIST of locked execution columns. That is a property of a
//      .sql file, so it is asserted against the .sql file.
//
//   3. THE COUNTS HELPER. C3's weekly review reduces trades to
//      followed/broke/unsure/unreflected through `countReflections`. The
//      invariant it rests on is that the four buckets partition the input.
//
//   4. THE DAILY CAP. A per-trade reflection also completes the day's
//      `rule_reflection` process entry. That must not become a way to farm the
//      reward surface 0070 caps at one row per kind per day.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  countReflections, readTradeReflection, isReflected, normalizeReflectionNote,
  followedRate, REFLECTION_NOTE_MAX, TRADE_REFLECTION_CHOICES, EMPTY_REFLECTION_COUNTS,
  type ReflectableTrade,
} from '@/lib/reflection'
import { REFLECTION_OUTCOMES } from '@/lib/process'

const UID = '11111111-2222-4333-8444-555555555555'
const TRADE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
const sql = (f: string) => readFileSync(join(MIGRATIONS, f), 'utf8')

/* ───────────────────────────────────────────────────────────────────────────
 * The server-action edges. Same idiom as trade-edit.test.ts: mock the
 * server-only boundaries and let the real pure code run.
 * ─────────────────────────────────────────────────────────────────────────── */

const getUser = vi.fn(async () => ({ data: { user: { id: UID, email: 'a@b.co' } } }))
const allowAction = vi.fn(async () => ({ ok: true }))

/** Every `.update()` payload the action sent, per table. */
const updates: { table: string; payload: Record<string, unknown> }[] = []
/** Every `.insert()` payload the action sent, per table. */
const inserts: { table: string; payload: Record<string, unknown> }[] = []
/** What `.maybeSingle()` gives back for the trades update — null = no row matched. */
const updateResult = vi.fn<() => { data: unknown; error: unknown }>(() => ({ data: { id: TRADE }, error: null }))
/** What the process_logs insert gives back. 23505 = already reflected today. */
const processInsertResult = vi.fn<() => { error: unknown }>(() => ({ error: null }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser },
    from: (table: string) => ({
      update: (payload: Record<string, unknown>) => {
        updates.push({ table, payload })
        return {
          eq: () => ({
            eq: () => ({ select: () => ({ maybeSingle: async () => updateResult() }) }),
          }),
        }
      },
      insert: async (payload: Record<string, unknown>) => {
        inserts.push({ table, payload })
        return processInsertResult()
      },
    }),
  }),
}))

vi.mock('@/lib/server/action-throttle', () => ({
  allowAction: (...args: unknown[]) => allowAction(...(args as [])),
  JOURNAL_BUDGET: { scope: 'act:journal', max: 60, windowMs: 600_000 },
  UPLOAD_BUDGET: { scope: 'act:upload', max: 20, windowMs: 600_000 },
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

async function actions() {
  return import('@/app/actions/reflection')
}

beforeEach(() => {
  updates.length = 0
  inserts.length = 0
  updateResult.mockReturnValue({ data: { id: TRADE }, error: null })
  processInsertResult.mockReturnValue({ error: null })
  allowAction.mockResolvedValue({ ok: true })
})

const tradeUpdate = () => updates.find((u) => u.table === 'trades')?.payload
const processInsert = () => inserts.find((i) => i.table === 'process_logs')?.payload

/* ───────────────────────────────────────────────────────────────────────────
 * 1. The write path
 * ─────────────────────────────────────────────────────────────────────────── */

describe('saveTradeReflection — the write', () => {
  it('writes the outcome and the sentence, and nothing else', async () => {
    const { saveTradeReflection } = await actions()
    const res = await saveTradeReflection(TRADE, { outcome: 'broke', note: '  moved my stop  ' })

    expect(res).toEqual({ ok: true })
    expect(tradeUpdate()).toEqual({
      reflection_outcome: 'broke',
      reflection_note: 'moved my stop',
    })
    // The payload is the assertion: an execution column here would be a change
    // to what the broker reported, and 0028's trigger would turn it into a raw
    // Postgres exception in the user's face on any imported row.
    expect(Object.keys(tradeUpdate() ?? {}).sort()).toEqual(['reflection_note', 'reflection_outcome'])
  })

  it('accepts all three answers, including "unsure"', async () => {
    const { saveTradeReflection } = await actions()
    for (const outcome of TRADE_REFLECTION_CHOICES) {
      updates.length = 0
      const res = await saveTradeReflection(TRADE, { outcome })
      expect(res.ok).toBe(true)
      expect(tradeUpdate()?.reflection_outcome).toBe(outcome)
    }
  })

  it('the vocabulary is the same one process_logs uses', () => {
    // Shared on purpose: one question, one set of words, so a per-trade answer
    // can stand as the day's entry with no translation layer. If these ever
    // diverge, `recordDailyReflection` starts writing a value 0070's check
    // constraint rejects.
    expect([...TRADE_REFLECTION_CHOICES].sort()).toEqual([...REFLECTION_OUTCOMES].sort())
  })

  it('an empty or blank sentence is stored as null, not as ""', async () => {
    const { saveTradeReflection } = await actions()
    await saveTradeReflection(TRADE, { outcome: 'followed', note: '   ' })
    expect(tradeUpdate()?.reflection_note).toBeNull()
  })

  it('caps the sentence at the length the column check allows', async () => {
    const { saveTradeReflection } = await actions()
    await saveTradeReflection(TRADE, { outcome: 'followed', note: 'x'.repeat(REFLECTION_NOTE_MAX + 200) })
    const note = tradeUpdate()?.reflection_note as string
    // Trimmed here rather than sent and rejected: a 23514 in a toast for
    // something the form allowed is the failure `parseTradeForm` avoids too.
    expect(note.length).toBeLessThanOrEqual(REFLECTION_NOTE_MAX)
  })

  it('refuses an answer outside the vocabulary before any write', async () => {
    const { saveTradeReflection } = await actions()
    const res = await saveTradeReflection(TRADE, { outcome: 'mostly' })
    expect(res.error).toBeTruthy()
    expect(updates).toHaveLength(0)
  })

  it('reports a trade that is not the caller’s instead of reporting success', async () => {
    // The failure this catches is silent by nature: PostgREST reports success
    // for an UPDATE that RLS refused, having matched zero rows. Without reading
    // the result back the user sees a tick on a write that never happened.
    updateResult.mockReturnValue({ data: null, error: null })
    const { saveTradeReflection } = await actions()
    const res = await saveTradeReflection(TRADE, { outcome: 'followed' })
    expect(res.ok).toBeUndefined()
    expect(res.error).toBe('Trade not found.')
  })

  it('is throttled on the journal budget like every other journal write', async () => {
    allowAction.mockResolvedValue({ ok: false, message: 'Slow down.' } as never)
    const { saveTradeReflection } = await actions()
    const res = await saveTradeReflection(TRADE, { outcome: 'followed' })
    expect(res.error).toBe('Slow down.')
    expect(updates).toHaveLength(0)
  })

  it('reads no entitlement — the module never imports one', () => {
    // The reflection is the one improvement primitive a Free user must reach.
    // A gate added here would put the free cycle behind a paywall, which is the
    // defect the audit's A5 finding is about. C1 owns the gate work; this file
    // owns "there is no gate here".
    const src = readFileSync(join(process.cwd(), 'src', 'app', 'actions', 'reflection.ts'), 'utf8')
    expect(src).not.toMatch(/canFlag|getTier|entitlements|feature-flags/)
  })
})

describe('clearTradeReflection', () => {
  it('clears both columns together', async () => {
    // `trades_reflection_note_needs_outcome` (0071) refuses a sentence with no
    // answer, so clearing one without the other is a constraint violation.
    const { clearTradeReflection } = await actions()
    const res = await clearTradeReflection(TRADE)
    expect(res).toEqual({ ok: true })
    expect(tradeUpdate()).toEqual({ reflection_outcome: null, reflection_note: null })
  })

  it('does not remove the day’s process entry', async () => {
    // The user did reflect today; withdrawing one trade's answer does not make
    // that untrue. `unlogProcess` exists for a user who wants the entry gone.
    const { clearTradeReflection } = await actions()
    await clearTradeReflection(TRADE)
    expect(processInsert()).toBeUndefined()
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 2. The imported trade
 * ─────────────────────────────────────────────────────────────────────────── */

describe('imported trades stay reflectable', () => {
  it('the action has no source check — a broker row takes the same path', async () => {
    // `deleteTrade` refuses non-manual rows and 0053 narrows the delete policy
    // to `source = 'manual'`. Neither reasoning applies here: rewriting verified
    // execution data launders a leaderboard, a reflection changes no metric
    // anyone else can see. If a `source` test ever appears in this action, a
    // user who imports their history can no longer complete a cycle.
    const src = readFileSync(join(process.cwd(), 'src', 'app', 'actions', 'reflection.ts'), 'utf8')
    expect(src).not.toMatch(/\bsource\s*[!=]==?\s*'manual'/)

    const { saveTradeReflection } = await actions()
    // The mock does not model `source` at all, which is the point: the action
    // never selects it, so an imported row is indistinguishable from a manual
    // one on this path.
    expect((await saveTradeReflection(TRADE, { outcome: 'broke' })).ok).toBe(true)
  })

  it('0028’s execution lock does not name either reflection column', () => {
    // The trigger is a whitelist of LOCKED columns. A new column is editable on
    // an imported row by construction — but only for as long as nobody adds it
    // to the tuple. This is the guard on that.
    const m0028 = sql('0028_sprint1_trust_foundations.sql')
    const fn = m0028.slice(m0028.indexOf('protect_imported_trade_fields'))
    expect(fn).toContain('new.entry_price')       // sanity: we found the tuple
    expect(fn).not.toContain('reflection_outcome')
    expect(fn).not.toContain('reflection_note')
  })

  it('0071 grants UPDATE on both reflection columns to authenticated', () => {
    // 0045 revoked the table-wide UPDATE default. Without this grant the write
    // is refused with "permission denied for column ... of relation trades" and
    // nothing lands — the code without the migration is broken, not merely
    // unenforced. Same deploy-order note 0067 carries.
    const m = sql('0071_trade_reflections.sql')
    const grant = m.slice(m.indexOf('grant update ('))
    expect(grant).toContain('reflection_outcome')
    expect(grant).toContain('reflection_note')
    expect(grant).toContain('on public.trades to authenticated')
  })

  it('0071 opens no execution column and no provenance column', () => {
    const m = sql('0071_trade_reflections.sql')
    const grant = m.slice(m.indexOf('grant update ('))
    for (const col of ['entry_price', 'exit_price', 'traded_at', 'lots', 'source', 'broker_deal_id', 'user_id']) {
      expect(grant).not.toContain(col)
    }
  })

  it('the sentence is a separate column from the private note', () => {
    // `trades.note` is `private_notes`, a Trader perk. The reflection sentence
    // is short and ungated. Keeping them distinct in the schema is what stops a
    // later gate change reaching into the free cycle.
    const m = sql('0071_trade_reflections.sql')
    expect(m).toContain('reflection_note')
    expect(m).not.toMatch(/^\s*(alter|update).*\bnote\b(?!_|s)/mi)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 3. The counts helper — what C3 builds against
 * ─────────────────────────────────────────────────────────────────────────── */

const t = (outcome?: string | null, note?: string | null): ReflectableTrade =>
  ({ reflection_outcome: outcome ?? null, reflection_note: note ?? null })

describe('countReflections', () => {
  it('an empty set is all zeroes, not a crash and not a null', () => {
    expect(countReflections([])).toEqual(EMPTY_REFLECTION_COUNTS)
  })

  it('splits a set into followed / broke / unsure / unreflected', () => {
    const c = countReflections([
      t('followed'), t('followed'), t('followed'),
      t('broke'),
      t('unknown'),
      t(null), t(undefined),
    ])
    expect(c.followed).toBe(3)
    expect(c.broke).toBe(1)
    expect(c.unsure).toBe(1)     // stored as 'unknown', reported as unsure
    expect(c.unreflected).toBe(2)
    expect(c.reflected).toBe(5)
    expect(c.total).toBe(7)
  })

  it('the four buckets partition the input — the denominator invariant', () => {
    // Everything the weekly review says about a week is a ratio over these.
    // A trade that fell into no bucket, or into two, would make the sentence
    // "you reviewed four sessions; three followed your checklist" untrue in a
    // way nothing else would catch.
    const rows = [
      t('followed'), t('broke'), t('unknown'), t(null),
      t('followed'), t('nonsense'), t(''), t('followed'),
    ]
    const c = countReflections(rows)
    expect(c.followed + c.broke + c.unsure + c.unreflected).toBe(c.total)
    expect(c.total).toBe(rows.length)
    expect(c.reflected + c.unreflected).toBe(c.total)
  })

  it('an unrecognised stored value reads as unreflected, never as followed', () => {
    // 0071's check constraint makes this impossible today. If a later migration
    // widens the vocabulary, under-reporting is the safe direction: the wrong
    // one would silently promote an unknown value into a compliance figure.
    const c = countReflections([t('nonsense'), t('FOLLOWED'), t(42 as unknown as string)])
    expect(c.unreflected).toBe(3)
    expect(c.followed).toBe(0)
  })

  it('is order-independent', () => {
    const a = [t('followed'), t(null), t('broke')]
    const b = [t('broke'), t('followed'), t(null)]
    expect(countReflections(a)).toEqual(countReflections(b))
  })
})

describe('readTradeReflection / followedRate', () => {
  it('unreflected is null, which is a third state and not a failure', () => {
    expect(readTradeReflection(t(null))).toBeNull()
    expect(readTradeReflection(undefined)).toBeNull()
    expect(isReflected(t(null))).toBe(false)
    expect(isReflected(t('unknown'))).toBe(true)
  })

  it('returns the answer and the trimmed sentence', () => {
    expect(readTradeReflection(t('broke', '  chased it  '))).toEqual({ outcome: 'broke', note: 'chased it' })
    expect(readTradeReflection(t('broke', '   '))).toEqual({ outcome: 'broke', note: null })
  })

  it('reports "not told us yet" as null rather than as 0%', () => {
    // "0% of your trades followed your rules" and "you have not answered yet"
    // are different sentences. Printing the first when the second is true is
    // exactly the kind of claim the audit's copy pass exists to remove.
    expect(followedRate(countReflections([t(null), t(null)]))).toBeNull()
    expect(followedRate(countReflections([t('followed'), t('broke')]))).toBe(0.5)
  })

  it('an unanswered trade never drags the rate down — it is counted separately', () => {
    const c = countReflections([t('followed'), t(null), t(null), t(null)])
    expect(followedRate(c)).toBe(1)
    expect(c.unreflected).toBe(3)
  })

  it('normalizeReflectionNote trims, drops empties and caps', () => {
    expect(normalizeReflectionNote('  hi  ')).toBe('hi')
    expect(normalizeReflectionNote('')).toBeNull()
    expect(normalizeReflectionNote('   ')).toBeNull()
    expect(normalizeReflectionNote(null)).toBeNull()
    expect(normalizeReflectionNote(12 as unknown as string)).toBeNull()
    expect((normalizeReflectionNote('y'.repeat(999)) ?? '').length).toBe(REFLECTION_NOTE_MAX)
  })
})

describe('lib/reflection.ts is a pure module', () => {
  it('imports no database, no React and no server-only', () => {
    // A Server Component reduces trades to counts through this file, and a
    // client component renders the same labels from it. A value imported from a
    // `'use client'` module resolves to a client-reference proxy and throws when
    // touched — that is how /admin/feedback went down on 2026-09-04 — so the
    // shared surface has to stay neutral in both directions.
    const src = readFileSync(join(process.cwd(), 'src', 'lib', 'reflection.ts'), 'utf8')
    expect(src).not.toMatch(/from '(react|next\/|server-only|@supabase)/)
    expect(src).not.toContain('@/lib/supabase')
    // Directives only bind at the top of a file, so that is where this looks —
    // the words appear in the comment above for a reason.
    expect(src.trimStart().startsWith("'use client'")).toBe(false)
    expect(src.trimStart().startsWith("'use server'")).toBe(false)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 4. The daily entry, and the cap it must not break
 * ─────────────────────────────────────────────────────────────────────────── */

describe('a per-trade reflection also completes the day’s rule_reflection', () => {
  it('records the day’s entry alongside the trade’s', async () => {
    // The alternative was strict separation, which would have meant answering
    // the same question twice — once per trade, once on the daily card — to
    // move a quest. That makes the per-trade prompt read as a tax on top of the
    // thing that pays, which is how a prompt gets dismissed forever.
    const { saveTradeReflection } = await actions()
    await saveTradeReflection(TRADE, { outcome: 'broke' })
    expect(processInsert()).toEqual({ user_id: UID, kind: 'rule_reflection', outcome: 'broke' })
  })

  it('never sends `day` — the bucket stays the server’s UTC date', () => {
    // Item 15 F7: quest bonuses used to bucket on user-supplied trade
    // timestamps, and backdating turned a bulk insert into months of
    // retroactive rewards. Reflecting today on a trade dated last March credits
    // today, because `day` defaults in Postgres and 0070 withholds the grant.
    const src = readFileSync(join(process.cwd(), 'src', 'app', 'actions', 'reflection.ts'), 'utf8')
    const insertCall = src.slice(src.indexOf(".from('process_logs')"))
    expect(insertCall).toContain('kind: ')
    expect(insertCall.slice(0, 400)).not.toMatch(/\bday\s*:/)
  })

  it('reflecting on twenty trades in a day is still one process entry', async () => {
    // The cap is not in this code and must not be: it is 0070's
    // (user_id, day, kind) unique index, and it is enforced again on the read
    // side by `xp.ts`, which counts distinct DAYS carrying a rule_reflection
    // row, never rows. A 23505 here means "already reflected today", which is a
    // success.
    processInsertResult.mockReturnValue({ error: { code: '23505' } })
    const { saveTradeReflection } = await actions()
    for (let i = 0; i < 20; i++) {
      const res = await saveTradeReflection(TRADE, { outcome: 'followed' })
      expect(res).toEqual({ ok: true })
    }
    // Twenty attempted inserts, and Postgres collapses all but the first.
    expect(inserts.filter((i) => i.table === 'process_logs')).toHaveLength(20)
  })

  it('does not amend an existing daily outcome', async () => {
    // `logProcess` amends, which is right when the user is driving the daily
    // card. Here it would mean the LAST trade answered rewrites the label on
    // the whole day, so on a mixed day (two followed, one broken) the day's
    // outcome would depend on click order. The per-trade rows are the record of
    // what happened to each trade; the daily row only records that a reflection
    // happened.
    const src = readFileSync(join(process.cwd(), 'src', 'app', 'actions', 'reflection.ts'), 'utf8')
    const daily = src.slice(src.indexOf('async function recordDailyReflection'))
    // The CALL, not the prose — the comment above the insert explains why an
    // upsert is wrong here and would otherwise trip a bare string match.
    expect(daily).not.toMatch(/\.update\(/)
    expect(daily).not.toMatch(/\.upsert\(/)
  })

  it('a failed process insert never fails the reflection', async () => {
    processInsertResult.mockReturnValue({ error: { code: '42501' } })
    const { saveTradeReflection } = await actions()
    expect((await saveTradeReflection(TRADE, { outcome: 'followed' })).ok).toBe(true)
  })

  it('0071 leaves the process_logs anti-farm index alone', () => {
    const m = sql('0071_trade_reflections.sql')
    // Named in prose in the header — that is deliberate — but never altered.
    expect(m).not.toMatch(/^\s*(create|drop|alter)[^\n]*process_logs/mi)
  })
})
