import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  profileLevel, profileRecordLabel, SYNCING_BROKER_STATUSES,
  type SourceCounts,
} from '@/lib/verification'

// repo root is three levels up from app/tests/unit
const ROOT = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const PHASES = ['collect', 'deploy', 'undeploy'] as const
const routeSrc = (phase: string) => read(`app/src/app/api/mt5-sync/${phase}/route.ts`)

const counts = (c: Partial<SourceCounts>): SourceCounts =>
  ({ manual: 0, statement: 0, broker: 0, ...c })

/**
 * `disconnected` was declared in BrokerStatus and then written by nothing and
 * read by nothing — three years of vocabulary with no meaning behind it. It now
 * means RETIRED, and these fix what that has to be worth.
 *
 * The incident: /TheTradingSocial, the company's own public profile, sat in
 * `error` from 2026-09-14 to 09-24 behind a MetaApi connection that had never
 * imported a single trade. Because `error` is checked before the trade counts,
 * the profile was titled "trading track record" with a Failed chip while
 * thirteen statement-imported trades sat on the page. Retiring the connection
 * is what cleared it, so the retirement must not read as a fault.
 */
describe('a retired broker connection', () => {
  it('claims nothing by itself, but never reads as failed', () => {
    // The whole point of the retirement: it is not a fault, so the profile
    // falls through to whatever its trades already prove.
    expect(profileLevel(counts({ statement: 13, manual: 4 }), 'disconnected'))
      .toBe('statement_imported')
    expect(profileLevel(counts({ manual: 4 }), 'disconnected')).toBe('self_reported')

    // And the wording that follows from it — the thing that was actually wrong
    // on the live page for ten days.
    expect(profileRecordLabel(profileLevel(counts({ statement: 13 }), 'disconnected')))
      .toBe('statement-verified trading track record')

    // Contrast: a BROKEN connection still says so, ahead of the trades. That
    // ordering is deliberate and must not be "fixed" by flattening the two.
    expect(profileLevel(counts({ statement: 13 }), 'error')).toBe('verification_failed')
  })

  it('keeps trades that did arrive from the broker broker-verified', () => {
    // The evidence is in the trade, not in the link. Retiring a connection must
    // not retroactively demote what it already imported.
    expect(profileLevel(counts({ broker: 9 }), 'disconnected')).toBe('broker_connected')
    expect(profileLevel(counts({ broker: 9 }), null)).toBe('broker_connected')
  })
})

describe('the hourly sync', () => {
  it('leaves retired accounts alone', () => {
    expect(SYNCING_BROKER_STATUSES).not.toContain('disconnected')
    expect([...SYNCING_BROKER_STATUSES].sort()).toEqual(['active', 'error', 'pending'])
  })

  it('reads its status filter from one place, in every phase', () => {
    // Three routes each carried their own copy of ['pending','active','error'].
    // A fourth status added to two of the three is how a retired account gets
    // quietly picked back up by one phase and not the others.
    for (const phase of PHASES) {
      const src = routeSrc(phase)
      expect(src, phase).toMatch(/\.in\('status', SYNCING_BROKER_STATUSES\)/)
      expect(src, phase).not.toMatch(/\.in\('status', \[/)
    }
  })
})
