import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  redactText,
  redactValue,
  describeError,
  classifyClientError,
  MAX_LOG_STRING,
} from '@/lib/redact'
import { buildLogEntry } from '@/lib/server/log'

/**
 * Regression guards for the redaction layer (audit item 19 F4) and for the two
 * findings it exists to close: F2 (a live Stripe customer id in the logs) and
 * F3 (Supabase `details`/`hint` and the Reddit response body).
 *
 * The negative assertions matter as much as the positive ones. A redactor that
 * eats ordinary identifiers — `sub_…`, a user uuid, an `author_id` — gets
 * switched off by the first person it inconveniences, and then none of this
 * protects anything.
 */

describe('redactText — value-shaped rules', () => {
  it('F2: redacts a Stripe customer id', () => {
    expect(redactText('customer cus_QqLm4RtY7bNc21 not found'))
      .toBe('customer [stripe-customer] not found')
  })

  it('F2: leaves subscription ids legible — tracing depends on them', () => {
    const line = 'mirror upsert failed for sub_1PqRsTuVwXyZ0123'
    expect(redactText(line)).toBe(line)
  })

  it('redacts Stripe secret and publishable keys and webhook secrets', () => {
    expect(redactText('using sk_live_51AbcdEfghIjkl')).toContain('[stripe-key]')
    expect(redactText('using pk_test_51AbcdEfghIjkl')).toContain('[stripe-key]')
    expect(redactText('signature whsec_AbcdEfghIjklMnop')).toContain('[stripe-key]')
    expect(redactText('using sk_live_51AbcdEfghIjkl')).not.toContain('sk_live_51')
  })

  it('redacts JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcDEF-123_xyz'
    expect(redactText(`Authorization failed for ${jwt}`)).toContain('[jwt]')
    expect(redactText(jwt)).not.toContain('eyJhbGciOiJIUzI1NiJ9')
  })

  it('redacts bearer tokens', () => {
    expect(redactText('header: Bearer abc123DEF456ghi')).toBe('header: Bearer [redacted]')
  })

  it('redacts email addresses', () => {
    expect(redactText('no account for trader.jane+tag@example.co.uk'))
      .toBe('no account for [email]')
  })

  it('redacts IPv4 addresses', () => {
    expect(redactText('from 203.0.113.42')).toBe('from [ip]')
  })

  it('strips URL query strings, where fetch failures leak', () => {
    expect(redactText('GET https://api.example.com/v1/users?token=abc&email=a@b.com failed'))
      .toBe('GET https://api.example.com/v1/users?[redacted] failed')
  })

  it('leaves ordinary text and uuids alone', () => {
    const line = 'trade 22c8c0bf-423b-4419-a547-aa135590a674 for author_id 9411e6cf'
    expect(redactText(line)).toBe(line)
  })

  it('truncates very long strings', () => {
    const out = redactText('x'.repeat(MAX_LOG_STRING + 200))
    expect(out.length).toBeLessThan(MAX_LOG_STRING + 20)
    expect(out).toContain('[truncated]')
  })
})

describe('redactValue — key-name rules and bounds', () => {
  it('redacts values behind sensitive key names', () => {
    expect(redactValue({ password: 'hunter2', access_token: 'abc', apiKey: 'k' })).toEqual({
      password: '[redacted]', access_token: '[redacted]', apiKey: '[redacted]',
    })
  })

  it('does NOT redact ordinary identifiers that merely contain a substring', () => {
    const v = { author_id: 'a1', keyboard: 'qwerty', session_count: 3, authorised: true }
    expect(redactValue(v)).toEqual(v)
  })

  it('F3: drops `details` and `hint` wherever they appear', () => {
    const v = redactValue({ code: '23505', message: 'duplicate key', details: 'Key (email)=(a@b.com) already exists.', hint: 'try again' })
    expect(v).toEqual({ code: '23505', message: 'duplicate key' })
  })

  it('recurses, and redacts nested values', () => {
    expect(redactValue({ outer: { customer: 'cus_QqLm4RtY7bNc21' } }))
      .toEqual({ outer: { customer: '[stripe-customer]' } })
  })

  it('bounds array length', () => {
    const out = redactValue(Array.from({ length: 30 }, (_, i) => i)) as unknown[]
    expect(out).toHaveLength(21)
    expect(out[20]).toBe('…10 more')
  })

  it('bounds recursion depth', () => {
    expect(redactValue({ a: { b: { c: { d: { e: 'deep' } } } } }))
      .toEqual({ a: { b: { c: { d: '[depth]' } } } })
  })

  it('passes through primitives and dates', () => {
    expect(redactValue(42)).toBe(42)
    expect(redactValue(true)).toBe(true)
    expect(redactValue(null)).toBe(null)
    expect(redactValue(new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02T03:04:05.000Z')
  })
})

describe('describeError', () => {
  it('F3: a PostgrestError keeps code and message and loses details/hint', () => {
    const pg = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "profiles_username_key"',
      details: 'Key (username)=(janedoe) already exists.',
      hint: null,
    }
    const out = describeError(pg)
    expect(out.code).toBe('23505')
    expect(out.name).toBe('PostgrestError')
    expect(out.message).toContain('duplicate key value')
    expect(JSON.stringify(out)).not.toContain('janedoe')
    expect(JSON.stringify(out)).not.toContain('details')
  })

  it('reduces an Error to name and message, redacted', () => {
    const out = describeError(new Error('could not resolve user for customer cus_QqLm4RtY7bNc21'))
    expect(out.name).toBe('Error')
    expect(out.message).toContain('[stripe-customer]')
    expect(out.message).not.toContain('cus_Qq')
  })

  it('never prints a stack', () => {
    expect(Object.keys(describeError(new Error('boom')))).not.toContain('stack')
  })

  it('handles strings, null and odd values without throwing', () => {
    expect(describeError('plain failure').message).toBe('plain failure')
    expect(describeError(null).message).toBe('unknown')
    expect(describeError(undefined).message).toBe('unknown')
    expect(describeError(42).message).toBe('42')
  })

  it('keeps a Next.js digest when one is present', () => {
    const e = Object.assign(new Error('server crash'), { digest: '1234567890' })
    expect(describeError(e).digest).toBe('1234567890')
  })
})

describe('classifyClientError — F1', () => {
  it.each([
    ['ChunkLoadError: Loading chunk 42 failed', 'chunk_load'],
    ['Failed to fetch dynamically imported module: /x.js', 'chunk_load'],
    ['Hydration failed because the initial UI does not match', 'hydration'],
    ['TypeError: Failed to fetch', 'network'],
    ['The operation was aborted', 'aborted'],
    ['Request timed out', 'timeout'],
    ['QuotaExceededError: storage full', 'storage_quota'],
    ['ResizeObserver loop completed with undelivered notifications', 'resize_observer'],
    ['Script error.', 'cross_origin_script'],
    ["Cannot read properties of undefined (reading 'map')", 'type_error'],
    ['Minified React error #418; visit https://react.dev/errors/418', 'react_418'],
  ])('classifies %s', (message, expected) => {
    expect(classifyClientError(message)).toBe(expected)
  })

  it('falls back to a bounded constructor name', () => {
    expect(classifyClientError('some novel failure', 'RangeError')).toBe('js_rangeerror')
  })

  it('returns `unclassified` rather than echoing unknown text', () => {
    const secret = 'duplicate key value: Key (email)=(jane@example.com) already exists'
    expect(classifyClientError(secret)).toBe('unclassified')
  })

  it('never returns any substring of the caller message', () => {
    const label = classifyClientError('account_balance=45000 for jane@example.com')
    expect(label).toBe('unclassified')
    expect(label).not.toContain('jane')
    expect(label).not.toContain('45000')
  })

  it('survives non-string input', () => {
    expect(classifyClientError(undefined)).toBe('unclassified')
    expect(classifyClientError({ toString: () => 'x' })).toBe('unclassified')
  })
})

describe('buildLogEntry — the house logger', () => {
  it('F2: before/after on the Stripe webhook line', () => {
    // BEFORE: console.error('[stripe webhook] could not resolve user for
    //   customer', 'cus_QqLm4RtY7bNc21', 'sub', 'sub_1PqRsTuVwXyZ0123')
    const entry = buildLogEntry('stripe webhook', undefined, {
      note: 'could not resolve user for customer',
      customerId: 'cus_QqLm4RtY7bNc21',
      id: 'sub_1PqRsTuVwXyZ0123',
    })
    expect(entry.customerId).toBe('[stripe-customer]')
    expect(entry.id).toBe('sub_1PqRsTuVwXyZ0123')
    expect(entry.err).toBeUndefined()
  })

  it('F3: before/after on a Supabase error object', () => {
    const entry = buildLogEntry('stripe webhook', {
      code: '23514',
      message: 'new row violates check constraint',
      details: 'Failing row contains (uuid, jane@example.com, 45000).',
      hint: 'widen the constraint',
    }, { note: 'trial ack failed' })
    const serialised = JSON.stringify(entry)
    expect(serialised).not.toContain('jane@example.com')
    expect(serialised).not.toContain('45000')
    expect(serialised).not.toContain('widen the constraint')
    expect(entry.err?.code).toBe('23514')
  })

  it('meta cannot overwrite the reserved keys', () => {
    const entry = buildLogEntry('scope', new Error('real'), { err: 'fake', scope: 'fake' })
    expect(entry.scope).toBe('scope')
    expect(entry.err?.message).toBe('real')
  })

  it('is serialisable and prefixed by the scope when emitted', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { logError } = await import('@/lib/server/log')
    logError('reddit-capi', undefined, { note: 'non-ok response', status: 401 })
    expect(spy).toHaveBeenCalledWith('[reddit-capi]', expect.stringContaining('"status":401'))
    expect(spy.mock.calls[0][1]).toContain('"note":"non-ok response"')
  })

  it('never throws on a circular meta value', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { logError } = await import('@/lib/server/log')
    const circular: Record<string, unknown> = { name: 'loop' }
    circular.self = circular
    expect(() => logError('scope', undefined, { circular })).not.toThrow()
    expect(spy).toHaveBeenCalled()
  })
})

/**
 * The structural guard. Item 19 F4's actual diagnosis was not "four call sites
 * are wrong" — it was "there is nowhere for the decision to live, so every call
 * site decides for itself, and four of them decided wrong." Fixing the four
 * without this test just resets the clock.
 */
describe('no bare console logging in server code', () => {
  const ALLOWED = new Set([
    // The logger itself, and the client-side files it cannot reach.
    'src/lib/server/log.ts',
    'src/app/admin/_components/AdminNav.tsx',
  ])

  it('routes every server log through lib/server/log.ts', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const { join, relative, sep } = await import('node:path')

    const root = new URL('../../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
    const offenders: string[] = []

    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) { walk(full); continue }
        if (!/\.tsx?$/.test(name)) continue
        const rel = relative(join(root, '..'), full).split(sep).join('/')
        if (ALLOWED.has(rel)) continue
        const src = readFileSync(full, 'utf8')
        if (/^\s*['"]use client['"]/.test(src)) continue
        src.split('\n').forEach((line, i) => {
          // Ignore mentions inside comments; only real calls matter.
          if (/^\s*(\*|\/\/)/.test(line)) return
          if (/\bconsole\.(log|info|warn|error|debug)\s*\(/.test(line)) {
            offenders.push(`${rel}:${i + 1}`)
          }
        })
      }
    }
    walk(root)

    expect(offenders).toEqual([])
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})
