import { describe, it, expect } from 'vitest'
import { brokerSyncNotice, lastSyncPhrase, FAILED_GRACE_MS } from '@/lib/broker-sync-notice'

const NOW = Date.parse('2026-09-25T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

describe('brokerSyncNotice', () => {
  it('says nothing without a connection, or for a retired one', () => {
    expect(brokerSyncNotice(null, true, NOW)).toBeNull()
    expect(brokerSyncNotice(null, false, NOW)).toBeNull()
    expect(brokerSyncNotice({ status: 'disconnected', last_sync_at: ago(10 * DAY) }, true, NOW)).toBeNull()
    expect(brokerSyncNotice({ status: 'disconnected', last_sync_at: ago(10 * DAY) }, false, NOW)).toBeNull()
  })

  it('says nothing while a Pro connection is healthy or still pending', () => {
    expect(brokerSyncNotice({ status: 'active', last_sync_at: ago(10 * DAY) }, true, NOW)).toBeNull()
    expect(brokerSyncNotice({ status: 'pending', last_sync_at: null }, true, NOW)).toBeNull()
  })

  it('reports a lapsed plan as paused, whatever the row status says', () => {
    // The 2026-09 case: status `error`, sync_error "Pro plan required…".
    expect(brokerSyncNotice({ status: 'error', last_sync_at: ago(11 * DAY) }, false, NOW))
      .toEqual({ kind: 'paused', lastSyncAt: ago(11 * DAY) })
    expect(brokerSyncNotice({ status: 'active', last_sync_at: ago(HOUR) }, false, NOW))
      .toEqual({ kind: 'paused', lastSyncAt: ago(HOUR) })
  })

  it('does not flag a single failed cycle', () => {
    expect(brokerSyncNotice({ status: 'error', last_sync_at: ago(HOUR) }, true, NOW)).toBeNull()
    expect(brokerSyncNotice({ status: 'error', last_sync_at: ago(FAILED_GRACE_MS - 1) }, true, NOW)).toBeNull()
  })

  it('flags an error that has outlasted the grace window', () => {
    expect(brokerSyncNotice({ status: 'error', last_sync_at: ago(FAILED_GRACE_MS) }, true, NOW))
      .toEqual({ kind: 'failed', lastSyncAt: ago(FAILED_GRACE_MS) })
  })

  it('flags an error on an account that has never synced', () => {
    expect(brokerSyncNotice({ status: 'error', last_sync_at: null }, true, NOW))
      .toEqual({ kind: 'failed', lastSyncAt: null })
  })
})

describe('lastSyncPhrase', () => {
  it('counts whole days back from now', () => {
    expect(lastSyncPhrase(ago(2 * HOUR), NOW)).toBe('today')
    expect(lastSyncPhrase(ago(DAY + HOUR), NOW)).toBe('yesterday')
    expect(lastSyncPhrase(ago(11 * DAY), NOW)).toBe('11 days ago')
  })

  it('returns null when there is nothing to say', () => {
    expect(lastSyncPhrase(null, NOW)).toBeNull()
    expect(lastSyncPhrase('not a date', NOW)).toBeNull()
  })
})
