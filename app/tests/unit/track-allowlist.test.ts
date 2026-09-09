import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Structural guard for the client event vocabulary.
 *
 * `lib/track.ts` posts to /api/track, which drops any event name outside its
 * ALLOWED set with a 400. The beacon is fire-and-forget — `sendBeacon` ignores
 * the status and the fetch fallback never reads the response — so an event that
 * is not on the list fails in complete silence: the call site looks correct, no
 * error appears in the console or the server logs, and the rows simply never
 * arrive. It is indistinguishable from nobody performing the action.
 *
 * That is not hypothetical. `welcome_popup_shown` and `welcome_popup_dismissed`
 * were added with WelcomeModal in 038a90c and rejected by this route from that
 * day until the commit that added this test, so the welcome popup has never been
 * measured once.
 *
 * Source text rather than imports, for the reason admin-gate.test.ts gives:
 * importing the route drags in next/server and a request scope that does not
 * exist in vitest. The question is about the text.
 */

const SRC = join(process.cwd(), 'src')

/** Every .ts/.tsx file under src, recursively. */
function sources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sources(full))
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const ROUTE = readFileSync(join(SRC, 'app', 'api', 'track', 'route.ts'), 'utf8')

/** The event names in the route's ALLOWED set. */
function allowedEvents(): Set<string> {
  const block = ROUTE.slice(ROUTE.indexOf('const ALLOWED'), ROUTE.indexOf('])', ROUTE.indexOf('const ALLOWED')))
  return new Set([...block.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]))
}

/** Every literal event name passed to `track(...)` anywhere under src. */
function emittedEvents(): { event: string; file: string }[] {
  const out: { event: string; file: string }[] = []
  for (const file of sources(SRC)) {
    // Skip the helper itself; it has no literal call sites.
    if (file.endsWith(join('lib', 'track.ts'))) continue
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/(?<![.\w])track\(\s*'([a-z0-9_]+)'/g)) {
      out.push({ event: m[1], file: file.slice(SRC.length + 1).replace(/\\/g, '/') })
    }
  }
  return out
}

describe('client event allowlist', () => {
  it('finds the allowlist and the call sites', () => {
    expect(allowedEvents().size).toBeGreaterThan(5)
    expect(emittedEvents().length).toBeGreaterThan(0)
  })

  it('accepts every event the client actually fires', () => {
    const allowed = allowedEvents()
    const offenders = emittedEvents()
      .filter(({ event }) => !allowed.has(event))
      .map(({ event, file }) => `${file} fires "${event}"`)

    expect(
      offenders,
      'These events are posted to /api/track but are not in its ALLOWED set, so ' +
      'the route answers 400 and the rows are never written. track() ignores the ' +
      'response, so nothing surfaces the failure:\n  ' + offenders.join('\n  '),
    ).toEqual([])
  })

  it('keeps both halves of the broker card funnel', () => {
    // The server event counts settings renders; the client event counts the card
    // reaching the viewport. Dropping either one collapses them back into a
    // single number that cannot separate "never saw it" from "saw it and walked
    // away" — see settings/page.tsx and settings/BrokerCard.tsx.
    expect(allowedEvents()).toContain('broker_card_seen')
    const funnel = readFileSync(join(SRC, 'lib', 'server', 'funnel.ts'), 'utf8')
    expect(funnel).toContain("eventCount('broker_card_viewed')")
    expect(funnel).toContain("eventCount('broker_card_seen')")
  })
})
