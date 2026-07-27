import { describe, it, expect } from 'vitest'
import { validatePairs } from '@/lib/crypto/exchange-symbols'

describe('validatePairs', () => {
  it('keeps splittable pairs in exchange form, upper-cased', () => {
    expect(validatePairs(['btc/usdt', 'ETH/USDT'])).toEqual({
      pairs: ['BTC/USDT', 'ETH/USDT'], invalid: [],
    })
  })
  it('de-duplicates', () => {
    expect(validatePairs(['BTC/USDT', 'btc/usdt']).pairs).toEqual(['BTC/USDT'])
  })
  it('collects unsplittable inputs as invalid', () => {
    const r = validatePairs(['BTC/USDT', 'garbage'])
    expect(r.pairs).toEqual(['BTC/USDT'])
    expect(r.invalid).toEqual(['garbage'])
  })
  it('ignores blank entries', () => {
    expect(validatePairs(['', '  ', 'BTC/USDT']).pairs).toEqual(['BTC/USDT'])
  })
})
