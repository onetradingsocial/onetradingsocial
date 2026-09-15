import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateUsername, RESERVED_USERNAMES } from '@/lib/username'

describe('validateUsername', () => {
  it('accepts a valid username, and hands back the name to store', () => {
    expect(validateUsername('alex_07')).toEqual({ ok: true, name: 'alex_07' })
  })

  // 2026-09-15: " jennifer_johnson" reached profiles.username from a real
  // signup. validateUsername trimmed for the CHECK and returned only { ok },
  // so every caller validated one string and then stored a different one. A
  // stored space breaks the profile URL and makes " name" and "name" two
  // distinct usernames that the unique index is happy to hold side by side.
  it.each([' jennifer_johnson', 'alex_07 ', '  alex_07  '])(
    'normalises %j rather than merely accepting it',
    (raw) => {
      const v = validateUsername(raw)
      expect(v.ok).toBe(true)
      if (v.ok) {
        expect(v.name).toBe(raw.trim())
        expect(v.name).not.toMatch(/^\s|\s$/)
      }
    },
  )

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

/**
 * The bug was not in the validator, it was in the gap between validating and
 * storing. These pin the three call sites to the normalised value, which is the
 * part a future edit is most likely to undo.
 */
describe('callers store the normalised name, not their own input', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', '..', '..', p), 'utf8')

  it.each([
    ['app/src/app/actions/auth.ts', 'signUp metadata'],
    ['app/src/app/actions/profile.ts', 'saveOnboarding and updateProfile'],
  ])('%s writes v.name', (file) => {
    const src = read(file)
    const validations = src.split('validateUsername(').length - 1
    expect(validations, 'no validateUsername call — did it move?').toBeGreaterThan(0)
    expect(src.split('username: v.name').length - 1).toBe(validations)
  })
})
