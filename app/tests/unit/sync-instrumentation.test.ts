import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// repo root is three levels up from app/tests/unit
const ROOT = join(__dirname, '..', '..', '..')
const SRC = 'app/src/app/api/mt5-sync/collect/route.ts'
const src = readFileSync(join(ROOT, SRC), 'utf8')

/** `fail()` only — from its declaration to the `try` that follows it. */
function failBody(): string {
  const start = src.indexOf('const fail = async')
  const end = src.indexOf('    try {', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return src.slice(start, end)
}

/** The success path — the `status: 'active'` write through to the catch. */
function successBody(): string {
  const start = src.indexOf("status: 'active'")
  const end = src.indexOf('} catch (e)', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return src.slice(start, end)
}

/** The market-closed guard — top of GET down to the service client. */
function marketClosedGuard(): string {
  const start = src.indexOf('if (!isForexOpen')
  const end = src.indexOf('const svc = createServiceClient()', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return src.slice(start, end)
}

// ---------------------------------------------------------------------------
// The invariant this instrumentation exists to protect
//
// `broker_accounts` is last-write-wins: a successful cycle nulls `sync_error`,
// erasing the failure before it. State therefore cannot answer "what fraction
// of cycles worked" — the number the /status trust page has to publish. Every
// per-account outcome must leave an append-only row, and the guard has to be
// structural: a future contributor adding another early exit must not be able
// to reintroduce an unrecorded one.
// ---------------------------------------------------------------------------

describe('mt5 sync per-cycle instrumentation', () => {
  it('records every outcome exactly once — one emission per exit shape', () => {
    // Two call sites, three outcomes — the failure site picks its event name.
    expect(src.match(/trackServer\(/g) ?? []).toHaveLength(2)
    expect(failBody().match(/trackServer\(/g) ?? []).toHaveLength(1)
    expect(successBody().match(/trackServer\(/g) ?? []).toHaveLength(1)
    for (const e of ['broker_sync_succeeded', 'broker_sync_failed', 'broker_sync_skipped']) {
      expect(src.match(new RegExp(`'${e}'`, 'g')) ?? []).toHaveLength(1)
    }
  })

  it('has no failure path that skips fail()', () => {
    // `status: 'error'` is the failure write. If it appears outside fail(),
    // an account can be marked broken without the cycle being counted.
    expect(src.match(/status: 'error'/g) ?? []).toHaveLength(1)
    expect(failBody()).toContain("status: 'error'")
  })

  it('counts an entitlement stop as skipped, never as a failure', () => {
    // A lapsed plan is a product decision, not a fault. If it landed in the
    // failed bucket the published reliability rate would drop every time
    // somebody downgraded.
    expect(failBody()).toContain("opts.entitlement ? 'broker_sync_skipped' : 'broker_sync_failed'")
    const gate = src.slice(src.indexOf("canFlag(flags, tier, 'mt5_autosync')"))
    const call = gate.slice(0, gate.indexOf('continue'))
    expect(call).toContain('entitlement: true')
    // ...and it is the ONLY caller that may claim it.
    expect(src.match(/entitlement: true/g) ?? []).toHaveLength(1)
  })

  it('keeps deploy failures attributable to the deploy phase', () => {
    // Same attribution the sync_error write uses: a collect error caused by a
    // failed deploy must not be filed as a collect fault.
    expect(failBody()).toContain("deployFailedThisCycle ? 'deploy' : 'collect'")
  })

  it('emits nothing when the market is closed', () => {
    // No attempt was made. A weekend of "not attempted" in the denominator
    // would understate reliability by roughly 30%.
    expect(marketClosedGuard()).not.toContain('trackServer')
    expect(marketClosedGuard()).toContain('market_closed')
  })

  it('redacts the failure reason before storing it', () => {
    // A fetch failure carries the upstream URL, and `props` outlives the row.
    expect(failBody()).toContain('reason: redactText(msg)')
  })

  it('reports the success separately from the trade count it imported', () => {
    expect(successBody()).toContain("trackServer('broker_sync_succeeded'")
    expect(successBody()).toContain('trades: imported')
  })

  it('leaves the response shape alone — the n8n asserts read it', () => {
    expect(src).toContain('return NextResponse.json({ synced, total: rows?.length ?? 0 })')
    expect(src).toContain("skipped: 'market_closed'")
  })
})
