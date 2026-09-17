import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep, dirname, resolve } from 'node:path'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { APP_LOCALE, formatDate, formatNumber } from '@/lib/locale-format'
import { LocalTime } from '@/app/_components/LocalTime'
import { clock, dayLabel, isNewDay, shortWhen } from '@/app/messages/_components/format'

/**
 * Locale-dependent formatting in client components raised React #418 on
 * hydration: the server formats in its own locale and UTC, the browser in the
 * viewer's. React recovers silently, so no error boundary runs and nothing
 * reaches `client_error` — see lib/locale-format.ts. These tests pin the fix
 * and guard against the pattern coming back.
 */

describe('the server/hydration pass is stable', () => {
  const iso = '2026-09-16T23:30:00.000Z' // 09:30 on the 17th in Sydney

  it('formats dates in APP_LOCALE and UTC when not local', () => {
    expect(formatDate(iso, { year: 'numeric', month: 'short', day: 'numeric' }, false))
      .toBe(new Date(iso).toLocaleString('en-AU', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }))
    expect(APP_LOCALE).toBe('en-AU')
  })

  it('renders an empty string, not "Invalid Date", for bad input', () => {
    expect(formatDate('not a date', { dateStyle: 'medium' }, false)).toBe('')
    expect(formatDate('not a date', { dateStyle: 'medium' }, true)).toBe('')
  })

  it('formats numbers identically regardless of the runtime default locale', () => {
    expect(formatNumber(1234567)).toBe('1,234,567')
    expect(formatNumber(1234.56, { maximumFractionDigits: 0 })).toBe('1,235')
  })

  it('LocalTime server-renders the stable UTC string, which is what hydration compares against', () => {
    const html = renderToString(createElement(LocalTime, { iso, options: { hour: '2-digit', minute: '2-digit' } }))
    expect(html).toContain(`dateTime="${iso}"`)
    expect(html).toContain(formatDate(iso, { hour: '2-digit', minute: '2-digit' }, false))
  })

  it('message helpers bucket by UTC calendar day before hydration', () => {
    expect(clock(iso, false)).toBe(formatDate(iso, { hour: '2-digit', minute: '2-digit' }, false))
    // 23:30Z and 00:30Z the next day straddle a UTC midnight.
    expect(isNewDay('2026-09-16T23:30:00.000Z', '2026-09-17T00:30:00.000Z', false)).toBe(true)
    expect(isNewDay('2026-09-16T00:30:00.000Z', '2026-09-16T23:30:00.000Z', false)).toBe(false)
    expect(dayLabel(new Date().toISOString(), false)).toBe('Today')
    expect(shortWhen(new Date().toISOString(), false)).toBe('now')
  })
})

/**
 * Structural guard, in the style of admin-gate.test.ts: a lint rule as a test,
 * because the failure mode is a new line in a new file.
 *
 * Any `'use client'` module — and any module one of them imports by relative
 * path or `@/` alias — must not call toLocaleString / toLocaleDateString /
 * toLocaleTimeString with no locale or `undefined`. Use APP_LOCALE for numbers
 * and formatDate + useIsClient for dates.
 */
const SRC = join(process.cwd(), 'src')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(SRC, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null
  if (!base) return null
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    try { if (statSync(cand).isFile()) return cand } catch { /* next */ }
  }
  return null
}

describe('no runtime-default locale formatting in client code', () => {
  const files = walk(SRC)
  const text = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]))
  const isClient = (s: string) => /^\s*['"]use client['"]/.test(s)

  // Client modules plus everything they import, transitively.
  const client = new Set<string>()
  const queue = files.filter((f) => isClient(text.get(f)!))
  while (queue.length) {
    const f = queue.pop()!
    if (client.has(f)) continue
    client.add(f)
    for (const m of text.get(f)!.matchAll(/^\s*import\s+(?!type\b)[^'"]*['"]([^'"]+)['"]/gm)) {
      const dep = resolveImport(f, m[1])
      if (dep && text.has(dep) && !client.has(dep)) queue.push(dep)
    }
  }

  // Legitimately runtime-dependent: the helper that deliberately uses the
  // viewer's locale after hydration, and a comment-only mention.
  const ALLOWED = new Set([join(SRC, 'lib', 'locale-format.ts'), join(SRC, 'lib', 'time.ts')])
  const BAD = /\.toLocale(?:Date|Time)?String\(\s*(?:\)|undefined\b)/

  it('finds the client graph (sanity)', () => {
    expect(client.size).toBeGreaterThan(20)
  })

  it('every client-reachable module passes an explicit locale', () => {
    const offenders: string[] = []
    for (const f of client) {
      if (ALLOWED.has(f)) continue
      text.get(f)!.split('\n').forEach((line, i) => {
        if (BAD.test(line) && !line.trim().startsWith('*') && !line.trim().startsWith('//')) {
          offenders.push(`${relative(process.cwd(), f).split(sep).join('/')}:${i + 1}`)
        }
      })
    }
    expect(offenders, `Runtime-default locale formatting in client code (React #418 on hydration). Use APP_LOCALE / formatDate + useIsClient from lib/locale-format.ts:\n${offenders.join('\n')}`).toEqual([])
  })
})
