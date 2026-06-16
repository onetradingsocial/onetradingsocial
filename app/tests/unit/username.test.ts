import { describe, it, expect } from 'vitest'
import { validateUsername, RESERVED_USERNAMES } from '@/lib/username'

describe('validateUsername', () => {
  it('accepts a valid username', () => {
    expect(validateUsername('alex_07')).toEqual({ ok: true })
  })
  it('rejects too short', () => {
    expect(validateUsername('ab')).toEqual({ ok: false, error: 'Username must be 3-20 characters.' })
  })
  it('rejects too long', () => {
    expect(validateUsername('a'.repeat(21))).toEqual({ ok: false, error: 'Username must be 3-20 characters.' })
  })
  it('rejects invalid characters', () => {
    expect(validateUsername('bad name!')).toEqual({ ok: false, error: 'Use letters, numbers, and underscores only.' })
  })
  it('rejects reserved names case-insensitively', () => {
    expect(validateUsername('Login')).toEqual({ ok: false, error: 'That username is reserved.' })
  })
  it('reserved list includes route names', () => {
    expect(RESERVED_USERNAMES).toContain('settings')
    expect(RESERVED_USERNAMES).toContain('onboarding')
  })
})
