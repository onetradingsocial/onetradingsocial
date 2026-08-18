import { describe, it, expect } from 'vitest'
import { maskEmail, maskAccountId, deletedActorLabel } from '@/lib/admin-mask'

describe('maskEmail', () => {
  it('keeps the first character and the domain, hides the rest of the local part', () => {
    expect(maskEmail('edrian@gmail.com')).toBe('e•••@gmail.com')
  })

  it('hides the length of the local part', () => {
    // Both sides must produce the same number of dots. A variable-length mask
    // leaks how long the address is, which narrows a guess.
    expect(maskEmail('ab@x.io')).toBe('a•••@x.io')
    expect(maskEmail('averylonglocalpart@x.io')).toBe('a•••@x.io')
  })

  it('does not echo a single-character local part', () => {
    expect(maskEmail('a@x.io')).toBe('•••@x.io')
  })

  it('keeps the domain intact — it is the operationally useful half', () => {
    // An admin has to be able to spot a seed row or a disposable domain
    // without revealing anybody. Masking the domain too makes the directory
    // unreadable, which just pushes the work into a SQL console that logs
    // nothing at all.
    expect(maskEmail('someone@tradingsocial.io')).toContain('@tradingsocial.io')
  })

  it('is case- and whitespace-tolerant', () => {
    expect(maskEmail('  Nathan@Example.COM ')).toBe('N•••@Example.COM')
  })

  it('renders an em dash rather than a half-parsed identifier', () => {
    expect(maskEmail(null)).toBe('—')
    expect(maskEmail(undefined)).toBe('—')
    expect(maskEmail('')).toBe('—')
    expect(maskEmail('no-at-sign')).toBe('—')
    expect(maskEmail('@nolocal.com')).toBe('—')
    expect(maskEmail('trailing@')).toBe('—')
  })

  it('never returns the input unchanged, and never leaks past the first character', () => {
    for (const e of ['abc@b.co', 'onetradingsocial@gmail.com', 'x.y+z@sub.domain.io']) {
      const local = e.split('@')[0]
      expect(maskEmail(e)).not.toBe(e)
      expect(maskEmail(e)).not.toContain(local.slice(1))
    }
  })
})

describe('maskAccountId', () => {
  it('keeps the last four digits of an MT5 login', () => {
    expect(maskAccountId('51234567')).toBe('••••4567')
    expect(maskAccountId(51234567)).toBe('••••4567')
  })

  it('masks entirely when the value is too short for last-4 to be a mask', () => {
    expect(maskAccountId('1234')).toBe('•••')
    expect(maskAccountId('99')).toBe('•••')
  })

  it('handles absent values', () => {
    expect(maskAccountId(null)).toBe('—')
    expect(maskAccountId(undefined)).toBe('—')
    expect(maskAccountId('   ')).toBe('—')
  })
})

describe('deletedActorLabel', () => {
  it('gives a departed admin a stable pseudonym, not their address', () => {
    const hash = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
    expect(deletedActorLabel(hash)).toBe('deleted admin (a1b2c3d4)')
    // Same person, same label — that is the whole point of keeping a hash.
    expect(deletedActorLabel(hash)).toBe(deletedActorLabel(hash))
  })

  it('degrades rather than crashing when there is no hash', () => {
    expect(deletedActorLabel(null)).toBe('deleted admin')
    expect(deletedActorLabel(undefined)).toBe('deleted admin')
  })
})
