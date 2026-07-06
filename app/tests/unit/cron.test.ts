import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { authorizedCron } from '@/lib/cron'

describe('authorizedCron', () => {
  const prev = process.env.CRON_SECRET
  beforeEach(() => { process.env.CRON_SECRET = 's3cret' })
  afterEach(() => { process.env.CRON_SECRET = prev })

  it('accepts the exact bearer secret', () => {
    expect(authorizedCron('Bearer s3cret')).toBe(true)
  })
  it('rejects wrong/missing/malformed values', () => {
    expect(authorizedCron('Bearer nope')).toBe(false)
    expect(authorizedCron(null)).toBe(false)
    expect(authorizedCron('s3cret')).toBe(false)
  })
  it('rejects everything when CRON_SECRET unset', () => {
    delete process.env.CRON_SECRET
    expect(authorizedCron('Bearer ')).toBe(false)
    expect(authorizedCron(null)).toBe(false)
  })
})
