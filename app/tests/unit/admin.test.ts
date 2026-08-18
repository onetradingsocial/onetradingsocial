import { describe, it, expect } from 'vitest'
import { parseAdminEmails, emailIsAdmin, validateSlug, validateNonNegInt, validateQuizOptions } from '@/lib/admin'

describe('parseAdminEmails', () => {
  it('splits, trims, lowercases, drops empties', () => {
    expect(parseAdminEmails(' Owner@Gmail.com , ,Second@Example.com ')).toEqual([
      'owner@gmail.com',
      'second@example.com',
    ])
  })
  it('drops a bare @domain entry instead of treating it as a wildcard', () => {
    // Regression guard. This used to parse as a domain suffix wildcard, so
    // '@admin.tradingsocial.test' made every address under a permanently
    // unclaimable RFC 6761 domain a production admin. Dropping it at parse
    // time means an operator who pastes the old value gets NO admins from
    // that entry rather than a whole namespace of them.
    expect(parseAdminEmails('owner@gmail.com,@admin.test')).toEqual(['owner@gmail.com'])
  })
  it('drops malformed entries', () => {
    expect(parseAdminEmails('no-at-sign,two@@ats.com,trailing@,owner@gmail.com')).toEqual([
      'owner@gmail.com',
    ])
  })
  it('handles undefined', () => {
    expect(parseAdminEmails(undefined)).toEqual([])
  })
})

describe('emailIsAdmin', () => {
  const allow = ['owner@gmail.com', 'second@example.com']
  it('matches exact email case-insensitively', () => {
    expect(emailIsAdmin('Owner@Gmail.com', allow)).toBe(true)
  })
  it('does NOT grant a whole domain', () => {
    // The escalation path: with open signup and email confirmation off,
    // anyone could register under an unclaimable domain and inherit admin.
    expect(emailIsAdmin('anyone@admin.test', allow)).toBe(false)
    expect(emailIsAdmin('attacker@admin.test', [...allow, '@admin.test'])).toBe(false)
  })
  it('rejects non-listed', () => {
    expect(emailIsAdmin('user@tradingsocial.io', allow)).toBe(false)
  })
  it('rejects null email', () => {
    expect(emailIsAdmin(null, allow)).toBe(false)
  })
})

describe('validators', () => {
  it('validateSlug accepts good slugs, rejects bad', () => {
    expect(validateSlug('risk-basics')).toBeNull()
    expect(validateSlug('Bad Slug')).toBeTruthy()
    expect(validateSlug('')).toBeTruthy()
  })
  it('validateNonNegInt', () => {
    expect(validateNonNegInt(0)).toBeNull()
    expect(validateNonNegInt(-1)).toBeTruthy()
    expect(validateNonNegInt(1.5)).toBeTruthy()
  })
  it('validateQuizOptions requires >=2 and exactly one correct', () => {
    expect(validateQuizOptions([{ label: 'a', isCorrect: true }, { label: 'b', isCorrect: false }])).toBeNull()
    expect(validateQuizOptions([{ label: 'a', isCorrect: true }])).toBeTruthy()
    expect(validateQuizOptions([{ label: 'a', isCorrect: false }, { label: 'b', isCorrect: false }])).toBeTruthy()
    expect(validateQuizOptions([{ label: 'a', isCorrect: true }, { label: 'b', isCorrect: true }])).toBeTruthy()
  })
})
