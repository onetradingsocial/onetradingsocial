import { describe, it, expect } from 'vitest'
import {
  passwordProblem,
  scorePassword,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  STRENGTH_LABELS,
} from '@/lib/password'

const ok = (pw: string, ids: (string | null)[] = []) => expect(passwordProblem(pw, ids)).toBeNull()
const bad = (pw: string, ids: (string | null)[] = []) => expect(passwordProblem(pw, ids)).toBeTypeOf('string')

describe('passwordProblem — the single enforced rule', () => {
  describe('length', () => {
    it('rejects an empty password', () => bad(''))
    it('rejects the old 8-character minimum', () => bad('abcd1234'))
    it('rejects 9 characters', () => bad('abcde1234'))
    it(`accepts exactly ${PASSWORD_MIN_LENGTH}`, () => ok('abcdef1234'))
    it('accepts comfortably longer', () => ok('correct-horse-battery-staple-9'))

    it('rejects past the bcrypt 72-byte ceiling rather than letting it be truncated', () => {
      bad('a1' + 'x'.repeat(PASSWORD_MAX_LENGTH))
    })
    it(`accepts exactly ${PASSWORD_MAX_LENGTH} bytes`, () => {
      ok('a1' + 'x'.repeat(PASSWORD_MAX_LENGTH - 2))
    })
    it('measures the ceiling in BYTES, so a multi-byte password cannot sneak past it', () => {
      // 40 four-byte emoji = 160 bytes but only 40 code points.
      bad('a1' + '😀'.repeat(40))
    })
  })

  describe('composition', () => {
    it('rejects letters with no digit', () => bad('abcdefghijkl'))
    it('rejects digits with no letter', () => bad('1234567890123'))
    it('accepts letters + digits without demanding a symbol', () => ok('abcdefgh12'))
    it('accepts symbols as a bonus, not a requirement', () => ok('Abcdefgh12!'))
  })

  describe('obvious choices that clear every mechanical rule', () => {
    it('rejects password123', () => bad('password123'))
    it('rejects PASSWORD123 regardless of case', () => bad('PASSWORD123'))
    it('rejects the product name', () => bad('tradingsocial123'))
    it('rejects a single repeated character padded with digits', () => bad('aaaaaaaaaa1'))
    it('does not reject an ordinary password that merely repeats a letter twice', () => {
      ok('aabbccdd12')
    })
  })

  describe('must not contain the user identifiers', () => {
    it('rejects a password containing the email local part', () => {
      bad('alexander99xyz', ['alexander@example.com'])
    })
    it('rejects a password containing the username', () => {
      bad('tradingjoe12', [null, 'tradingjoe'])
    })
    it('is case-insensitive about it', () => {
      bad('ALEXANDER1234', ['alexander@example.com'])
    })
    it('matches on the local part only, not the whole address', () => {
      // "example.com" appearing in a password is not the interesting case.
      ok('unrelatedpw12', ['alexander@example.com'])
    })
    it('ignores identifiers under 4 characters, which would false-positive', () => {
      ok('joeisgreat12', ['joe@example.com'])
    })
    it('tolerates null/undefined/empty identifiers', () => {
      ok('abcdefgh12', [null, undefined as unknown as null, ''])
    })
    it('applies every other rule even when no identifiers are supplied', () => {
      bad('abcd1234')
    })
  })

  describe('problem messages', () => {
    it('names the minimum length so the user knows the target', () => {
      expect(passwordProblem('abc1')).toContain(String(PASSWORD_MIN_LENGTH))
    })
    it('never echoes the password back', () => {
      const pw = 'sup3rsecret-do-not-echo'
      expect(passwordProblem(pw, ['sup3rsecret-do-not-echo'])).not.toContain(pw)
    })
  })
})

describe('scorePassword — advisory meter only', () => {
  it('scores an empty password 0', () => expect(scorePassword('')).toBe(0))

  it('never exceeds the label table', () => {
    for (const pw of ['', 'a', 'abcdefgh12', 'Abcdefghij12', 'Abcdefghijklmn12!@']) {
      const s = scorePassword(pw)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThan(STRENGTH_LABELS.length)
    }
  })

  it('rises monotonically with genuinely stronger passwords', () => {
    const weak = scorePassword('abcdefgh12')
    const mixed = scorePassword('Abcdefgh12')
    const long = scorePassword('AbcdefghIjklmn12!')
    expect(mixed).toBeGreaterThanOrEqual(weak)
    expect(long).toBeGreaterThan(mixed)
  })

  it('scores the strongest passwords 4', () => {
    expect(scorePassword('Tr0ub4dor&3-Horse-Battery')).toBe(4)
  })

  it('no longer awards a point at 8 characters, matching the raised minimum', () => {
    // The old meter gave "abcd1234" a point for reaching 8. It is now below the
    // policy minimum, so the meter must not imply it is acceptable.
    expect(scorePassword('abcd1234')).toBe(0)
  })
})

describe('the meter and the rule never disagree', () => {
  // The forms gate submit on passwordProblem(), never on the score — this
  // pins the invariant that makes that safe: nothing the policy accepts is
  // shown as score 0 ("no bar at all"), which would read as "not allowed".
  const accepted = [
    'abcdefgh12',
    'Abcdefgh12',
    'correct-horse-9-battery',
    'Tr0ub4dor&3-Horse-Battery',
  ]
  for (const pw of accepted) {
    it(`accepted password scores at least 1: ${pw.slice(0, 12)}…`, () => {
      expect(passwordProblem(pw)).toBeNull()
      expect(scorePassword(pw)).toBeGreaterThanOrEqual(1)
    })
  }
})
