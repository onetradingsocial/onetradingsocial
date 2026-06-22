import { describe, it, expect } from 'vitest'
import { parseAdminEmails, emailIsAdmin, validateSlug, validateNonNegInt, validateQuizOptions } from '@/lib/admin'

describe('parseAdminEmails', () => {
  it('splits, trims, lowercases, drops empties', () => {
    expect(parseAdminEmails(' Owner@Gmail.com , ,@Admin.Test ')).toEqual(['owner@gmail.com', '@admin.test'])
  })
  it('handles undefined', () => {
    expect(parseAdminEmails(undefined)).toEqual([])
  })
})

describe('emailIsAdmin', () => {
  const allow = ['owner@gmail.com', '@admin.test']
  it('matches exact email case-insensitively', () => {
    expect(emailIsAdmin('Owner@Gmail.com', allow)).toBe(true)
  })
  it('matches a @domain entry by suffix', () => {
    expect(emailIsAdmin('anyone@admin.test', allow)).toBe(true)
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
