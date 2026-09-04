// app/tests/unit/trade-edit.test.ts
//
// Guards for `updateTrade` (src/app/actions/trade.ts).
//
// Editing a logged trade is the first write path that can CHANGE a stored P/L
// rather than only append one, and every journal, profile and leaderboard
// figure is a sum over those columns. Three failure modes are silent — none of
// them throws, all of them just leave a wrong number in the database — so they
// are the three this file exists to catch:
//
//   1. a recompute that disagrees with the insert path, so a no-op edit moves
//      the P/L;
//   2. a reopened trade keeping its realised figures, so a trade with no exit
//      still contributes a win and a dollar amount to every metric;
//   3. an execution column reaching an imported row, which the 0028 trigger
//      turns into a raw Postgres exception in the user's face — or, worse, does
//      not, and lets a broker-verified result be rewritten.
//
// Mocking style follows tests/unit/action-throttle.test.ts, the existing
// precedent for importing a server-action module: `vi.mock` the server-only
// edges (supabase clients, cache, tracking, entitlements) and let the real
// maths in @/lib/trade and @/lib/instruments run.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const UID = '11111111-2222-4333-8444-555555555555'

// --- the edges -------------------------------------------------------------

const getUser = vi.fn(async () => ({ data: { user: { id: UID, email: 'a@b.co' } } }))
const selectRow = vi.fn<() => Promise<{ data: Record<string, unknown> | null; error: unknown }>>()
const updatePayload = vi.fn<(p: Record<string, unknown>) => void>()
const updateError = vi.fn<() => unknown>(() => null)
const allowAction = vi.fn(async () => ({ ok: true }))
const accountBalance = vi.fn(() => 16000)

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: () => selectRow() }) }),
      }),
      update: (payload: Record<string, unknown>) => {
        updatePayload(payload)
        return { eq: () => ({ eq: async () => ({ error: updateError() }) }) }
      },
    }),
  }),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: { account_balance: accountBalance() } }) }),
      }),
    }),
  }),
}))

vi.mock('@/lib/server/action-throttle', () => ({
  allowAction: (...args: unknown[]) => allowAction(...(args as [])),
  JOURNAL_BUDGET: { scope: 'act:journal', max: 60, windowMs: 600_000 },
  UPLOAD_BUDGET: { scope: 'act:upload', max: 20, windowMs: 600_000 },
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/server/track', () => ({ trackServer: vi.fn() }))
vi.mock('@/lib/notifications', () => ({ insertSystemNotification: vi.fn() }))
vi.mock('@/lib/server/referral', () => ({ markReferralActivated: vi.fn() }))
vi.mock('@/lib/server/entitlements', () => ({ getTier: async () => 'pro' }))
vi.mock('@/lib/server/feature-flags', () => ({ getFeatureFlags: async () => ({}) }))

async function updateTrade(id: string, fd: FormData) {
  const mod = await import('@/app/actions/trade')
  return mod.updateTrade(id, fd)
}

// --- fixtures --------------------------------------------------------------

/** EUR/USD — the exact symbol, so pipInfo resolves the real $10/lot pip value
 *  rather than falling back to forex inference. 50-pip stop, 80-pip target,
 *  pipSize 0.0001, 1% of 16,000 = $160
 *  risk, so a run to target is R 1.6 and $256. Same numbers as trade.test.ts,
 *  on purpose: if the edit path ever computes something else, the two files
 *  disagree out loud. */
const OPEN_ROW = {
  source: 'manual',
  market: 'forex',
  instrument: 'EUR/USD',
  direction: 'long',
  sizing_mode: 'risk_percent',
  entry_price: 1.0856,
  stop_price: 1.0806,
  target_price: 1.0936,
  exit_price: null,
  risk_percent: 1,
  lots: null,
  traded_at: '2026-08-01T09:00:00.000Z',
  closed_at: null,
}

const CLOSED_ROW = {
  ...OPEN_ROW,
  exit_price: 1.0906,
  closed_at: '2026-08-01T15:30:00.000Z',
}

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) for (const one of v) fd.append(k, one)
    else fd.set(k, v)
  }
  return fd
}

/** A full manual-edit submission — every field the modal posts. */
const fullForm = (over: Record<string, string | string[]> = {}) => form({
  market: 'forex',
  instrument: 'EUR/USD',
  direction: 'long',
  sizing_mode: 'risk_percent',
  entry_price: '1.0856',
  stop_price: '1.0806',
  target_price: '1.0936',
  exit_price: '1.0936',
  risk_percent: '1',
  lots: '',
  setup_type: 'Breakout',
  confidence: 'high',
  emotion: 'calm',
  note: 'held to target',
  traded_at: '2026-08-01T09:00:00.000Z',
  is_public: 'public',
  ...over,
})

const EXECUTION_COLUMNS = [
  'market', 'instrument', 'direction', 'sizing_mode', 'entry_price', 'stop_price',
  'target_price', 'exit_price', 'risk_percent', 'lots', 'risk_amount', 'sl_pips',
  'tp_pips', 'planned_rr', 'r_multiple', 'pnl_amount', 'realized_pips', 'outcome',
  'status', 'traded_at', 'closed_at', 'broker_deal_id', 'source',
]

beforeEach(() => {
  vi.clearAllMocks()
  allowAction.mockResolvedValue({ ok: true })
  getUser.mockResolvedValue({ data: { user: { id: UID, email: 'a@b.co' } } })
  updateError.mockReturnValue(null)
  accountBalance.mockReturnValue(16000)
})

// ---------------------------------------------------------------------------
// 1 — a manual edit recomputes every derived column
// ---------------------------------------------------------------------------

describe('updateTrade — manual recompute', () => {
  it('closes an open trade and derives R, P/L and pips from the new exit', async () => {
    selectRow.mockResolvedValue({ data: { ...OPEN_ROW }, error: null })

    await expect(updateTrade('t1', fullForm())).resolves.toEqual({ ok: true })

    const p = updatePayload.mock.calls[0][0]
    expect(p.status).toBe('closed')
    expect(p.outcome).toBe('win')
    expect(p.exit_price).toBe(1.0936)
    expect(p.r_multiple).toBeCloseTo(1.6, 5)
    expect(p.pnl_amount).toBeCloseTo(256, 5)
    expect(Math.round(p.realized_pips as number)).toBe(80)
    // The plan is re-derived too, not carried over from the original log.
    expect(Math.round(p.sl_pips as number)).toBe(50)
    expect(Math.round(p.tp_pips as number)).toBe(80)
    expect(p.planned_rr).toBeCloseTo(1.6, 5)
    expect(p.risk_amount).toBeCloseTo(160, 5)
  })

  it('re-sizes off the account balance, so a stale risk_amount cannot survive', async () => {
    selectRow.mockResolvedValue({ data: { ...OPEN_ROW }, error: null })
    accountBalance.mockReturnValue(32000)

    await updateTrade('t1', fullForm())

    const p = updatePayload.mock.calls[0][0]
    expect(p.risk_amount).toBeCloseTo(320, 5)
    expect(p.pnl_amount).toBeCloseTo(512, 5)
  })

  it('turns a winner into a loser when the exit is corrected below entry', async () => {
    selectRow.mockResolvedValue({ data: { ...CLOSED_ROW }, error: null })

    await updateTrade('t1', fullForm({ exit_price: '1.0806' }))

    const p = updatePayload.mock.calls[0][0]
    expect(p.outcome).toBe('loss')
    expect(p.r_multiple).toBeCloseTo(-1, 5)
    expect(p.pnl_amount).toBeCloseTo(-160, 5)
  })

  it('keeps the original closed_at when only the exit price is corrected', async () => {
    // Re-stamping would move a trade closed in August into today's bucket, and
    // the rolling leaderboard window and XP day/week buckets both read it.
    selectRow.mockResolvedValue({ data: { ...CLOSED_ROW }, error: null })

    await updateTrade('t1', fullForm({ exit_price: '1.0916' }))

    expect(updatePayload.mock.calls[0][0].closed_at).toBe(CLOSED_ROW.closed_at)
  })

  it('never stamps a closed_at earlier than traded_at (migration 0045)', async () => {
    // A trade dated inside the 60s of allowed clock skew closes "now", which is
    // fractionally BEFORE its own traded_at — the exact inversion 0045's
    // one-second grace exists to forgive. The floor stops it recurring.
    const soon = new Date(Date.now() + 30_000).toISOString()
    selectRow.mockResolvedValue({ data: { ...OPEN_ROW }, error: null })

    await updateTrade('t1', fullForm({ traded_at: soon }))

    const p = updatePayload.mock.calls[0][0]
    expect(p.traded_at).toBe(soon)
    expect(Date.parse(p.closed_at as string)).toBeGreaterThanOrEqual(Date.parse(soon))
  })

  it('stamps closed_at when an open trade gains an exit for the first time', async () => {
    selectRow.mockResolvedValue({ data: { ...OPEN_ROW }, error: null })

    await updateTrade('t1', fullForm())

    const p = updatePayload.mock.calls[0][0]
    expect(p.closed_at).toEqual(expect.any(String))
    expect(Date.parse(p.closed_at as string))
      .toBeGreaterThanOrEqual(Date.parse(OPEN_ROW.traded_at))
  })

  it('applies the stop-less quick-entry maths when the stop is cleared', async () => {
    selectRow.mockResolvedValue({ data: { ...OPEN_ROW }, error: null })

    await updateTrade('t1', fullForm({
      stop_price: '', sizing_mode: 'lots', lots: '1', risk_percent: '',
    }))

    const p = updatePayload.mock.calls[0][0]
    expect(p.sl_pips).toBe(0)
    expect(p.planned_rr).toBeNull()
    expect(p.risk_amount).toBe(0)
    expect(p.r_multiple).toBeNull()          // no stop, so no R denominator
    expect(p.realized_pips).toBeCloseTo(80, 5)
    expect(p.pnl_amount).toBeCloseTo(800, 5) // 80 pips × $10/lot × 1 lot
    expect(p.outcome).toBe('win')
  })
})

// ---------------------------------------------------------------------------
// 2 — clearing the exit reopens the trade, and clears everything it earned
// ---------------------------------------------------------------------------

describe('updateTrade — reopening', () => {
  it('clears every realised figure when the exit price is removed', async () => {
    selectRow.mockResolvedValue({ data: { ...CLOSED_ROW }, error: null })

    await expect(updateTrade('t1', fullForm({ exit_price: '' }))).resolves.toEqual({ ok: true })

    const p = updatePayload.mock.calls[0][0]
    expect(p.status).toBe('open')
    expect(p.outcome).toBe('open')
    // Each of these has to be WRITTEN as null. Omitting them leaves the old
    // P/L on a trade with no exit, and computeMetrics/leaderboard.ts count by
    // outcome and pnl_amount, so the phantom result is counted everywhere.
    expect(p.exit_price).toBeNull()
    expect(p.pnl_amount).toBeNull()
    expect(p.r_multiple).toBeNull()
    expect(p.realized_pips).toBeNull()
    expect(p.closed_at).toBeNull()
    // The plan survives — the trade is open, not unplanned.
    expect(Math.round(p.sl_pips as number)).toBe(50)
    expect(p.planned_rr).toBeCloseTo(1.6, 5)
  })

  it('sends the reopen keys explicitly rather than relying on omission', async () => {
    selectRow.mockResolvedValue({ data: { ...CLOSED_ROW }, error: null })

    await updateTrade('t1', fullForm({ exit_price: '' }))

    const keys = Object.keys(updatePayload.mock.calls[0][0])
    for (const k of ['exit_price', 'pnl_amount', 'r_multiple', 'realized_pips', 'closed_at']) {
      expect(keys).toContain(k)
    }
  })
})

// ---------------------------------------------------------------------------
// 2b — the trade date is not the user's to move
// ---------------------------------------------------------------------------

describe('updateTrade — the trade date', () => {
  // The date IS editable on a manual trade. That was a product decision taken
  // with the leaderboard-window and XP-bucket gaming risk on the table; see
  // migration 0067, which says so in as many words rather than pretending the
  // grant is defended. What these tests hold is the one preventive control
  // that survived — the future-date rejection — plus the two ways the column
  // can corrupt a row around it.

  it('writes a corrected date on a manual trade', async () => {
    selectRow.mockResolvedValue({ data: { ...OPEN_ROW }, error: null })

    await expect(updateTrade('t1', fullForm({ traded_at: '2026-07-15T11:22:00.000Z' })))
      .resolves.toEqual({ ok: true })

    expect(updatePayload.mock.calls[0][0].traded_at).toBe('2026-07-15T11:22:00.000Z')
  })

  it('rejects a future date with the message createTrade gives', async () => {
    // The ONLY thing between the 0067 grant and a fabricated 2031 entry on the
    // public board. If this assertion ever needs deleting, the grant needs
    // revisiting first.
    selectRow.mockResolvedValue({ data: { ...OPEN_ROW }, error: null })

    await expect(updateTrade('t1', fullForm({ traded_at: '2031-01-01T00:00:00.000Z' })))
      .resolves.toEqual({ error: 'Trade date cannot be in the future.' })
    expect(updatePayload).not.toHaveBeenCalled()
  })

  it('rejects an unparseable date rather than writing a broken one', async () => {
    selectRow.mockResolvedValue({ data: { ...OPEN_ROW }, error: null })

    await expect(updateTrade('t1', fullForm({ traded_at: 'not-a-date' })))
      .resolves.toEqual({ error: 'Invalid trade date.' })
    expect(updatePayload).not.toHaveBeenCalled()
  })

  it('keeps the stored date when the form omits the field entirely', async () => {
    // Falling through to `now` here would silently re-date every trade edited
    // by any caller that does not render a date input.
    const fd = fullForm()
    fd.delete('traded_at')
    selectRow.mockResolvedValue({ data: { ...OPEN_ROW }, error: null })

    await updateTrade('t1', fd)

    expect(updatePayload.mock.calls[0][0].traded_at).toBe(OPEN_ROW.traded_at)
  })

  it('keeps the stored date when the field is submitted blank', async () => {
    selectRow.mockResolvedValue({ data: { ...OPEN_ROW }, error: null })

    await updateTrade('t1', fullForm({ traded_at: '' }))

    expect(updatePayload.mock.calls[0][0].traded_at).toBe(OPEN_ROW.traded_at)
  })

  it('drags closed_at forward when the date moves past it (0045 check)', async () => {
    // The new failure mode the editable date opens: CLOSED_ROW closed on
    // 1 Aug 15:30, and the user re-dates the trade to 2 Aug. Sending that pair
    // violates trades_closed_after_traded and the user gets a raw 23514 for
    // something the form let them do.
    selectRow.mockResolvedValue({ data: { ...CLOSED_ROW }, error: null })

    await expect(updateTrade('t1', fullForm({ traded_at: '2026-08-02T00:00:00.000Z' })))
      .resolves.toEqual({ ok: true })

    const p = updatePayload.mock.calls[0][0]
    expect(p.traded_at).toBe('2026-08-02T00:00:00.000Z')
    expect(p.closed_at).toBe('2026-08-02T00:00:00.000Z')
    expect(Date.parse(p.closed_at as string))
      .toBeGreaterThanOrEqual(Date.parse(p.traded_at as string))
  })

  it('leaves closed_at alone when the date moves but stays behind it', async () => {
    // A floor, not a re-stamp: it moves closed_at only as far as it must.
    selectRow.mockResolvedValue({ data: { ...CLOSED_ROW }, error: null })

    await updateTrade('t1', fullForm({ traded_at: '2026-07-01T00:00:00.000Z' }))

    expect(updatePayload.mock.calls[0][0].closed_at).toBe(CLOSED_ROW.closed_at)
  })
})

// ---------------------------------------------------------------------------
// 3 — the source gate
// ---------------------------------------------------------------------------

describe('updateTrade — imported trades', () => {
  const IMPORTED = { ...CLOSED_ROW, source: 'broker' }

  /** The stored row echoed back exactly, the way the modal's hidden inputs
   *  post it — so a test can vary ONE field and know that field caused the
   *  refusal. */
  const echoForm = (over: Record<string, string | string[]> = {}) => fullForm({
    exit_price: String(IMPORTED.exit_price),
    traded_at: IMPORTED.traded_at,
    lots: '',
    ...over,
  })


  it('writes journal fields only, and no execution column at all', async () => {
    selectRow.mockResolvedValue({ data: { ...IMPORTED }, error: null })

    const res = await updateTrade('t1', form({
      note: 'chased this one', confidence: 'low', emotion: 'anxious',
      setup_type: 'News Play', strategy_tags: ['Breakout', 'London'], is_public: 'private',
    }))
    expect(res).toEqual({ ok: true })

    const p = updatePayload.mock.calls[0][0]
    // The exact list 0028's protect_imported_trade_fields compares.
    for (const col of EXECUTION_COLUMNS) expect(p).not.toHaveProperty(col)
    expect(p).toEqual({
      setup_type: 'News Play',
      confidence: 'low',
      emotion: 'anxious',
      note: 'chased this one',
      strategy_tags: ['Breakout', 'London'],
      is_public: false,
    })
  })

  it('refuses in words when the form tries to change execution data', async () => {
    // Silently dropping the change would leave the user staring at the old
    // entry price after a "saved" toast. The trigger would raise a raw
    // Postgres exception instead; neither is an answer.
    selectRow.mockResolvedValue({ data: { ...IMPORTED }, error: null })

    const res = await updateTrade('t1', fullForm({ instrument: 'EUR/USD', entry_price: '1.2000' }))

    expect(res.error).toMatch(/as the broker reported it/)
    expect(updatePayload).not.toHaveBeenCalled()
  })

  it('accepts a form that echoes the stored execution values unchanged', async () => {
    // A read-only (not disabled) input still posts its value. That is not an
    // edit and must not be refused.
    selectRow.mockResolvedValue({ data: { ...IMPORTED }, error: null })

    const res = await updateTrade('t1', echoForm())

    expect(res).toEqual({ ok: true })
    for (const col of EXECUTION_COLUMNS) {
      expect(updatePayload.mock.calls[0][0]).not.toHaveProperty(col)
    }
  })

  it('still validates the journal enums on the imported path', async () => {
    selectRow.mockResolvedValue({ data: { ...IMPORTED }, error: null })

    await expect(updateTrade('t1', form({ confidence: 'nuclear' })))
      .resolves.toEqual({ error: 'Invalid confidence.' })
    expect(updatePayload).not.toHaveBeenCalled()
  })

  it('refuses a moved trade date — it is an execution field too', async () => {
    // Verified, not assumed. traded_at is in 0028's locked tuple, and the edit
    // form posts the stored ISO string for an imported trade, so the mismatch
    // is detectable: the user gets the refusal rather than a success toast
    // over a date that did not move.
    selectRow.mockResolvedValue({ data: { ...IMPORTED }, error: null })

    // Same form, unchanged date: proves the baseline is clean.
    await expect(updateTrade('t1', echoForm())).resolves.toEqual({ ok: true })

    updatePayload.mockClear()
    const res = await updateTrade('t1', echoForm({ traded_at: '2026-07-01T00:00:00.000Z' }))

    expect(res.error).toMatch(/as the broker reported it/)
    expect(updatePayload).not.toHaveBeenCalled()
  })

  it('does not refuse over a zone-less date it cannot honestly compare', async () => {
    // A datetime-local input posts "2026-08-01T09:00", which Date.parse reads
    // as browser-local against a timestamptz column. Comparing those would
    // lock a user out of editing an imported trade's NOTES over a difference
    // that may not exist. Skipped, and left to the trigger — which still
    // refuses the write, and which never sees one, because the imported path
    // does not put traded_at in the payload.
    selectRow.mockResolvedValue({ data: { ...IMPORTED }, error: null })

    const res = await updateTrade('t1', echoForm({ traded_at: '2026-08-01T09:00' }))

    expect(res).toEqual({ ok: true })
    expect(updatePayload.mock.calls[0][0]).not.toHaveProperty('traded_at')
  })

  it('treats a statement import the same as a broker sync', async () => {
    selectRow.mockResolvedValue({ data: { ...CLOSED_ROW, source: 'statement' }, error: null })

    const res = await updateTrade('t1', fullForm({ entry_price: '9.9' }))
    expect(res.error).toMatch(/as the broker reported it/)
  })
})

// ---------------------------------------------------------------------------
// 4 — ownership, existence and the guards shared with createTrade
// ---------------------------------------------------------------------------

describe('updateTrade — refusals', () => {
  it('reports a missing or foreign trade id identically', async () => {
    // The read is scoped .eq(user_id), so someone else's trade comes back
    // empty — the caller cannot tell the two apart, which is the point.
    selectRow.mockResolvedValue({ data: null, error: null })

    await expect(updateTrade('someone-elses-id', fullForm()))
      .resolves.toEqual({ error: 'Trade not found.' })
    expect(updatePayload).not.toHaveBeenCalled()
  })

  it('surfaces a read error instead of reporting the trade missing', async () => {
    selectRow.mockResolvedValue({ data: null, error: { message: 'statement timeout' } })

    await expect(updateTrade('t1', fullForm()))
      .resolves.toEqual({ error: 'statement timeout' })
  })

  it('refuses an anonymous caller before touching the throttle', async () => {
    getUser.mockResolvedValue({ data: { user: null } } as never)

    await expect(updateTrade('t1', fullForm()))
      .resolves.toEqual({ error: 'Not authenticated.' })
    expect(allowAction).not.toHaveBeenCalled()
  })

  it('returns the throttle message in { error }, before reading the row', async () => {
    allowAction.mockResolvedValue({
      ok: false, message: "You're doing that too quickly. Try again in 5 minutes.",
    } as never)

    await expect(updateTrade('t1', fullForm())).resolves.toEqual({
      error: "You're doing that too quickly. Try again in 5 minutes.",
    })
    expect(selectRow).not.toHaveBeenCalled()
  })

  it('inherits createTrade\'s validation, message for message', async () => {
    selectRow.mockResolvedValue({ data: { ...OPEN_ROW }, error: null })

    const cases: [Record<string, string>, string][] = [
      [{ instrument: '' }, 'Instrument is required.'],
      [{ entry_price: '' }, 'Entry is required.'],
      [{ entry_price: '0' }, 'Entry price must be greater than zero.'],
      [{ exit_price: '-1' }, 'Exit price must be greater than zero.'],
      [{ stop_price: '' }, 'Without a stop loss, enter your position size in lots.'],
      [{ direction: 'sideways' }, 'Invalid direction.'],
      [{ sizing_mode: 'vibes' }, 'Invalid sizing mode.'],
      [{ emotion: 'hangry' }, 'Invalid emotion.'],
      [{ stop_price: '1.0856' }, 'Stop cannot equal entry.'],
      [{ traded_at: 'not-a-date' }, 'Invalid trade date.'],
      [{ traded_at: '2031-01-01T00:00:00.000Z' }, 'Trade date cannot be in the future.'],
    ]
    for (const [over, message] of cases) {
      updatePayload.mockClear()
      await expect(updateTrade('t1', fullForm(over)), message).resolves.toEqual({ error: message })
      expect(updatePayload).not.toHaveBeenCalled()
    }
  })

  it('passes a write error straight back', async () => {
    selectRow.mockResolvedValue({ data: { ...OPEN_ROW }, error: null })
    updateError.mockReturnValue({ message: 'permission denied for table trades' })

    await expect(updateTrade('t1', fullForm()))
      .resolves.toEqual({ error: 'permission denied for table trades' })
  })
})

// ---------------------------------------------------------------------------
// 5 — an edit is not a new trade
// ---------------------------------------------------------------------------

describe('updateTrade — side effects', () => {
  it('fires no analytics, referral or notification side effects', async () => {
    selectRow.mockResolvedValue({ data: { ...OPEN_ROW }, error: null })
    const { trackServer } = await import('@/lib/server/track')
    const { markReferralActivated } = await import('@/lib/server/referral')
    const { insertSystemNotification } = await import('@/lib/notifications')

    await updateTrade('t1', fullForm())

    expect(trackServer).not.toHaveBeenCalled()
    expect(markReferralActivated).not.toHaveBeenCalled()
    expect(insertSystemNotification).not.toHaveBeenCalled()
  })

  it('revalidates the journal so the edited row is not served from cache', async () => {
    selectRow.mockResolvedValue({ data: { ...OPEN_ROW }, error: null })
    const { revalidatePath } = await import('next/cache')

    await updateTrade('t1', fullForm())

    expect(revalidatePath).toHaveBeenCalledWith('/journal')
  })

  it('does not revalidate when the write failed', async () => {
    selectRow.mockResolvedValue({ data: { ...OPEN_ROW }, error: null })
    updateError.mockReturnValue({ message: 'nope' })
    const { revalidatePath } = await import('next/cache')

    await updateTrade('t1', fullForm())

    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('throttles on the journal budget, like every other trade action', async () => {
    selectRow.mockResolvedValue({ data: { ...OPEN_ROW }, error: null })

    await updateTrade('t1', fullForm())

    expect(allowAction).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'act:journal' }), UID,
    )
  })
})

// ---------------------------------------------------------------------------
// 6 — entitlement gating, and the data it must not destroy
// ---------------------------------------------------------------------------

describe('updateTrade — visibility is one-way once settled', () => {
  // ranking.ts:111 builds every board from `is_public = true` rows, and 0067
  // granted UPDATE on the column for the first time. Without this guard the
  // leaderboard is a per-trade opt-out exercised after seeing the outcome.
  it('refuses to take a closed public trade private', async () => {
    selectRow.mockResolvedValue({
      data: { ...CLOSED_ROW, status: 'closed', is_public: true }, error: null,
    })

    const res = await updateTrade('t1', fullForm({ is_public: 'private' }))

    expect(res.error).toMatch(/cannot be made private/)
    expect(updatePayload).not.toHaveBeenCalled()
  })

  it('refuses when the same edit is what closes the trade', async () => {
    // The loophole a stored-status check would leave: add an exit price and
    // switch to private in one submission.
    selectRow.mockResolvedValue({
      data: { ...OPEN_ROW, status: 'open', is_public: true }, error: null,
    })

    const res = await updateTrade('t1', fullForm({ exit_price: '1.0806', is_public: 'private' }))

    expect(res.error).toMatch(/cannot be made private/)
    expect(updatePayload).not.toHaveBeenCalled()
  })

  it('still lets an open trade be made private', async () => {
    selectRow.mockResolvedValue({
      data: { ...OPEN_ROW, status: 'open', is_public: true }, error: null,
    })

    await updateTrade('t1', fullForm({ exit_price: '', is_public: 'private' }))

    expect(updatePayload.mock.calls[0][0].is_public).toBe(false)
  })

  it('always allows publishing a private trade', async () => {
    selectRow.mockResolvedValue({
      data: { ...CLOSED_ROW, status: 'closed', is_public: false }, error: null,
    })

    await updateTrade('t1', fullForm({ is_public: 'public' }))

    expect(updatePayload.mock.calls[0][0].is_public).toBe(true)
  })

  it('guards an imported trade too — 0028 does not cover visibility', async () => {
    selectRow.mockResolvedValue({
      data: { ...CLOSED_ROW, source: 'broker', status: 'closed', is_public: true }, error: null,
    })

    // Execution values echoed back the way the modal posts them for an
    // imported trade, so the refusal can only be about visibility.
    const res = await updateTrade('t1', fullForm({
      exit_price: String(CLOSED_ROW.exit_price),
      traded_at: CLOSED_ROW.traded_at,
      lots: '',
      is_public: 'private',
    }))

    expect(res.error).toMatch(/cannot be made private/)
    expect(updatePayload).not.toHaveBeenCalled()
  })
})

describe('updateTrade — entitlements', () => {
  it('omits the gated journal fields on Free rather than nulling them', async () => {
    // Writing null here would erase the setup, emotion and note a user
    // recorded while on Trader from every trade they later edit on Free.
    vi.doMock('@/lib/server/entitlements', () => ({ getTier: async () => 'free' }))
    vi.resetModules()
    selectRow.mockResolvedValue({ data: { ...OPEN_ROW }, error: null })

    const mod = await import('@/app/actions/trade')
    await mod.updateTrade('t1', fullForm())

    const p = updatePayload.mock.calls[0][0]
    for (const k of ['setup_type', 'confidence', 'emotion', 'note', 'strategy_tags']) {
      expect(p).not.toHaveProperty(k)
    }
    // Execution data still recomputes — the maths is not a paid feature.
    expect(p.pnl_amount).toBeCloseTo(256, 5)

    vi.doUnmock('@/lib/server/entitlements')
    vi.resetModules()
  })

  it('caps a Trader at one strategy tag', async () => {
    vi.doMock('@/lib/server/entitlements', () => ({ getTier: async () => 'trader' }))
    vi.resetModules()
    selectRow.mockResolvedValue({ data: { ...OPEN_ROW }, error: null })

    const mod = await import('@/app/actions/trade')
    await mod.updateTrade('t1', fullForm({ strategy_tags: ['A', 'B', 'C'] }))

    expect(updatePayload.mock.calls[0][0].strategy_tags).toEqual(['A'])

    vi.doUnmock('@/lib/server/entitlements')
    vi.resetModules()
  })

  it('keeps stored tags a downgraded user is over the cap for', async () => {
    // Pro allows 8 tags, Trader 1. A lapsed Pro editing a three-tag trade must
    // not have two of them deleted by an edit they made for another reason —
    // the cap limits adding, it does not destroy what is already there.
    vi.doMock('@/lib/server/entitlements', () => ({ getTier: async () => 'trader' }))
    vi.resetModules()
    selectRow.mockResolvedValue({
      data: { ...OPEN_ROW, strategy_tags: ['Breakout', 'London', 'Trend'] }, error: null,
    })

    const mod = await import('@/app/actions/trade')
    await mod.updateTrade('t1', fullForm({ strategy_tags: ['Breakout', 'London', 'Trend'] }))

    expect(updatePayload.mock.calls[0][0].strategy_tags)
      .toEqual(['Breakout', 'London', 'Trend'])

    vi.doUnmock('@/lib/server/entitlements')
    vi.resetModules()
  })

  it('lets a user over the cap remove a tag but not add one', async () => {
    vi.doMock('@/lib/server/entitlements', () => ({ getTier: async () => 'trader' }))
    vi.resetModules()
    selectRow.mockResolvedValue({
      data: { ...OPEN_ROW, strategy_tags: ['Breakout', 'London', 'Trend'] }, error: null,
    })

    const mod = await import('@/app/actions/trade')
    // Drops 'Trend' and tries to slip 'Scalp' in past the cap of 1.
    await mod.updateTrade('t1', fullForm({ strategy_tags: ['Breakout', 'London', 'Scalp'] }))

    expect(updatePayload.mock.calls[0][0].strategy_tags).toEqual(['Breakout', 'London'])

    vi.doUnmock('@/lib/server/entitlements')
    vi.resetModules()
  })

  it('still fills the cap with new tags when under it', async () => {
    vi.doMock('@/lib/server/entitlements', () => ({ getTier: async () => 'trader' }))
    vi.resetModules()
    selectRow.mockResolvedValue({ data: { ...OPEN_ROW, strategy_tags: [] }, error: null })

    const mod = await import('@/app/actions/trade')
    await mod.updateTrade('t1', fullForm({ strategy_tags: ['Scalp', 'Swing'] }))

    expect(updatePayload.mock.calls[0][0].strategy_tags).toEqual(['Scalp'])

    vi.doUnmock('@/lib/server/entitlements')
    vi.resetModules()
  })
})
