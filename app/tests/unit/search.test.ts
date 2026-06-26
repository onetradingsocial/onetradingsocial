import { describe, it, expect } from 'vitest'
import { normalizeQuery, escapeIlike } from '@/lib/search'

describe('normalizeQuery', () => {
  it('trims and returns query of 2+ chars', () => {
    expect(normalizeQuery('  ab ')).toBe('ab')
    expect(normalizeQuery('trading')).toBe('trading')
  })
  it('returns null for under 2 chars after trim', () => {
    expect(normalizeQuery(' a ')).toBeNull()
    expect(normalizeQuery('')).toBeNull()
    expect(normalizeQuery('   ')).toBeNull()
  })
  it('strips filter-unsafe characters', () => {
    expect(normalizeQuery('ab,c(d)')).toBe('abcd')
    expect(normalizeQuery('a.b:c')).toBe('abc')
  })
  it('returns null when stripping leaves under 2 chars', () => {
    expect(normalizeQuery('a,(')).toBeNull()
  })
  it('keeps @ _ - and spaces', () => {
    expect(normalizeQuery('@jane_doe')).toBe('@jane_doe')
    expect(normalizeQuery('break out')).toBe('break out')
  })
})

describe('escapeIlike', () => {
  it('escapes % and _ wildcards', () => {
    expect(escapeIlike('50%_win')).toBe('50\\%\\_win')
  })
  it('leaves normal text unchanged', () => {
    expect(escapeIlike('normal')).toBe('normal')
  })
})
