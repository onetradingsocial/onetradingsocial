import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// repo root is three levels up from app/tests/unit
const ROOT = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const SRC = 'app/src/app/actions/broker.ts'
const src = read(SRC)

/** The body of connectBroker only — disconnectBroker has its own shape. */
function connectBody(): string {
  const start = src.indexOf('export async function connectBroker')
  const end = src.indexOf('export async function disconnectBroker')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return src.slice(start, end)
}


/** Every trackServer(...) call in the file, sliced on balanced parentheses.
 *  A lazy regex silently runs past the closing paren and swallows whatever
 *  follows, which is how a credential three statements later can look like an
 *  argument — so the bounds are found by counting depth instead. */
function trackServerCalls(): string[] {
  const out: string[] = []
  const NEEDLE = 'trackServer('
  for (let i = src.indexOf(NEEDLE); i !== -1; i = src.indexOf(NEEDLE, i + 1)) {
    let depth = 0
    for (let j = i + NEEDLE.length - 1; j < src.length; j++) {
      if (src[j] === '(') depth++
      else if (src[j] === ')') {
        depth--
        if (depth === 0) { out.push(src.slice(i, j + 1)); break }
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// The invariant this instrumentation exists to protect
//
// `broker_accounts` only ever gains a row on success. For the first two months
// of production that made a zero unreadable: nobody trying and everybody
// failing produced identical data. Every failed exit must therefore leave a
// trace, and the guard has to be structural — a future contributor adding a
// twelfth early return must not be able to reintroduce a silent one.
// ---------------------------------------------------------------------------

describe('connectBroker failure instrumentation', () => {
  it('has no bare error return outside the fail() helper itself', () => {
    const body = connectBody()
    const bare = [...body.matchAll(/return\s*\{\s*error/g)]
    // Exactly one, and it is fail()'s own return — it must sit above the first
    // branch that calls fail(), or it belongs to a branch that skipped it.
    expect(bare).toHaveLength(1)
    expect(bare[0].index).toBeLessThan(body.indexOf('return fail('))
  })

  it('leaves exactly one success return and no other shape', () => {
    const body = connectBody()
    const returns = body.match(/return\s+\S+/g) ?? []
    const offenders = returns.filter(
      (r) => !r.startsWith('return fail(') && !r.startsWith('return {'),
    )
    expect(offenders).toEqual([])
    expect(body.match(/return\s*\{\s*ok:\s*true\s*\}/g)).toHaveLength(1)
  })

  it('emits the attempt before the Pro gate, so a blocked attempt still counts', () => {
    const body = connectBody()
    const submitted = body.indexOf("trackServer('broker_connect_submitted'")
    const gate = body.indexOf("canFlag(flags, tier, 'mt5_autosync')")
    expect(submitted).toBeGreaterThan(-1)
    expect(gate).toBeGreaterThan(submitted)
  })

  it('records the success separately from the table write', () => {
    expect(connectBody()).toContain("trackServer('broker_connected'")
  })

  it('uses only reasons declared in the ConnectFailure union', () => {
    const union = src.slice(
      src.indexOf('export type ConnectFailure'),
      src.indexOf('export async function connectBroker'),
    )
    const declared = new Set([...union.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))
    const used = [...connectBody().matchAll(/fail\(\s*'([a-z_]+)'/g)].map((m) => m[1])
    expect(used.length).toBeGreaterThan(0)
    for (const r of used) expect(declared).toContain(r)
  })
})

// ---------------------------------------------------------------------------
// A live broker credential is the highest-consequence value the platform
// collects. Analytics is the last place it may ever appear.
// ---------------------------------------------------------------------------

describe('connectBroker never sends credentials to analytics', () => {
  it('passes no credential variable into any trackServer call', () => {
    const calls = trackServerCalls()
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call).not.toMatch(/\bpassword\b/)
      expect(call).not.toMatch(/\blogin\b/)
      expect(call).not.toMatch(/\bserver\b/)
    }
  })

  it('truncates the one free-text field it does forward', () => {
    expect(connectBody()).toMatch(/detail.*slice\(0,\s*120\)/s)
  })
})
