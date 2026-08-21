import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LANDINGS } from '@/lib/landing'

// repo root is three levels up from app/tests/unit
const ROOT = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const PAGE = 'app/src/app/for/[audience]/page.tsx'
const page = read(PAGE)

// ---------------------------------------------------------------------------
// The placeholder, and the script that is allowed to replace it
// ---------------------------------------------------------------------------

describe('/for/<audience> social proof', () => {
  it('server-renders a neutral placeholder, not a number', () => {
    // Whatever ships in the HTML is what a user sees with JS off, with the API
    // down, and for the whole window before the fetch resolves.
    expect(page).toMatch(/<div id="landing-proof"[^>]*>—<\/div>/)
  })

  it('has no "|| 0" fallback left anywhere in the fill script', () => {
    // The original bug in one line: `(d.tradesJournaled||0).toLocaleString()`
    // turned every empty/absent value into a confident "0".
    expect(extractFillScript()).not.toMatch(/\|\|\s*0/)
  })
})

// ---------------------------------------------------------------------------
// The fill script, actually executed
// ---------------------------------------------------------------------------

function extractFillScript(): string {
  const m = page.match(/<Script id="landing-proof-fill"[^>]*>\{`([\s\S]*?)`\}<\/Script>/)
  expect(m, `no landing-proof-fill script found in ${PAGE}`).not.toBeNull()
  return (m as RegExpMatchArray)[1]
}

const PLACEHOLDER = '—'

/** Run the real inline script against a fake fetch + a one-element fake DOM. */
async function runFill(fetchImpl: () => Promise<unknown>): Promise<string> {
  const el = { textContent: PLACEHOLDER }
  const document = { getElementById: (id: string) => (id === 'landing-proof' ? el : null) }
  const fn = new Function('fetch', 'document', extractFillScript())
  fn(fetchImpl, document)
  // flush the promise chain (macrotask turn drains all pending microtasks)
  await new Promise((r) => setTimeout(r, 0))
  return el.textContent
}

const responding = (body: unknown, ok = true) => () =>
  Promise.resolve({ ok, json: () => Promise.resolve(body) })

describe('the fill script keeps the placeholder unless there is a real number', () => {
  // The local/CI database is empty and a brand-new deployment's is too, so this
  // is the DEFAULT state of the page, not an edge case.
  it('leaves the placeholder alone when the count is zero', async () => {
    expect(await runFill(responding({ activeBetaUsers: 0 }))).toBe(PLACEHOLDER)
  })

  it('leaves the placeholder alone for a negative count', async () => {
    expect(await runFill(responding({ activeBetaUsers: -3 }))).toBe(PLACEHOLDER)
  })

  for (const [name, body] of [
    ['the field is missing', {}],
    ['the field is null', { activeBetaUsers: null }],
    ['the field is a string', { activeBetaUsers: '1200' }],
    ['the field is NaN', { activeBetaUsers: Number.NaN }],
    ['the field is Infinity', { activeBetaUsers: Number.POSITIVE_INFINITY }],
    ['the payload is not an object', 'nope'],
    ['the payload is null', null],
  ] as const) {
    it(`leaves the placeholder alone when ${name}`, async () => {
      expect(await runFill(responding(body))).toBe(PLACEHOLDER)
    })
  }

  it('leaves the placeholder alone on a non-OK response (the API 503s)', async () => {
    expect(await runFill(responding({ activeBetaUsers: 4000 }, false))).toBe(PLACEHOLDER)
  })

  it('leaves the placeholder alone when the body is not valid JSON', async () => {
    const fetchImpl = () =>
      Promise.resolve({ ok: true, json: () => Promise.reject(new Error('bad json')) })
    expect(await runFill(fetchImpl)).toBe(PLACEHOLDER)
  })

  it('leaves the placeholder alone when the fetch itself fails', async () => {
    expect(await runFill(() => Promise.reject(new Error('offline')))).toBe(PLACEHOLDER)
  })

  it('shows the number — formatted — once there is a real, positive one', async () => {
    expect(await runFill(responding({ activeBetaUsers: 1234 }))).toBe((1234).toLocaleString())
  })
})

// ---------------------------------------------------------------------------
// The number and the sentence under it have to mean the same thing
// ---------------------------------------------------------------------------

describe('the metric agrees with the caption', () => {
  it('binds a count of TRADERS, not a count of trades', () => {
    // The caption says "Traders". `tradesJournaled` counts trade rows, so the
    // old binding put a trade count under a people noun.
    const script = extractFillScript()
    expect(script).toContain('activeBetaUsers')
    expect(script).not.toContain('tradesJournaled')
  })

  it('binds a field /api/stats actually returns', () => {
    expect(read('app/src/app/api/stats/route.ts')).toContain('activeBetaUsers:')
  })

  for (const [key, l] of Object.entries(LANDINGS)) {
    it(`${key}: the caption says traders and claims no audience scoping`, () => {
      // No field in /api/stats is filtered by instrument or audience, so a
      // caption like "Crypto traders" or "Traders journaling forex" would
      // describe a site-wide figure as a segment of one. Until the API can
      // scope a count, the caption stays global.
      expect(l.proof).toMatch(/traders/i)
      expect(l.proof).not.toMatch(/forex|crypto|futures|mt5|prop|educator/i)
    })
  }
})
