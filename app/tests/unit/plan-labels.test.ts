// app/tests/unit/plan-labels.test.ts
//
// Guards copy that names the plan a feature needs.
//
// The journal empty state advertised broker sync as "(Trader plan)". Broker
// sync is `mt5_autosync`, which has always required Pro — the card had been
// given the label belonging to the statement importer next to it, because both
// cards read the same `canImport` prop and the plan name was hand-written.
//
// Nothing about that fails: the gate was correct, the copy was correct English,
// and the two were never compared. A user could pay A$30 for Trader on the
// strength of that line and not receive the feature they bought it for. It is
// found by reading the page against the pricing table, or not at all.
//
// So the label is now derived from the same FEATURE_MIN_TIER map the gate
// reads, and these tests pin both halves: the derivation, and the fact that the
// broker card asks about autosync rather than import.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { requiredPlanLabel, FEATURE_MIN_TIER, TIER_LABEL, type Feature } from '@/lib/entitlements'

describe('requiredPlanLabel', () => {
  it('names the plan the two MT5 features actually require', () => {
    // The pair that was conflated. Statement upload is Trader, broker sync is
    // Pro, and the whole bug was that one line claimed otherwise.
    expect(requiredPlanLabel('mt5_import')).toBe('Trader')
    expect(requiredPlanLabel('mt5_autosync')).toBe('Pro Trader')
  })

  it('agrees with the gate for every feature', () => {
    for (const feature of Object.keys(FEATURE_MIN_TIER) as Feature[]) {
      expect(requiredPlanLabel(feature)).toBe(TIER_LABEL[FEATURE_MIN_TIER[feature]])
    }
  })

  it('sells the top tier by its real name', () => {
    // Billing, checkout and the pricing page all say "Pro Trader". A label
    // saying "Pro" sends someone looking for a plan that is not listed.
    expect(TIER_LABEL.pro).toBe('Pro Trader')
  })
})

describe('the journal empty state', () => {
  const SRC = readFileSync(
    join(process.cwd(), 'src', 'app', 'journal', '_components', 'JournalEmptyState.tsx'),
    'utf8',
  )

  /** One of the three "ways to get data in" cards: heading, copy and gate.
   *  Each card ends with its `v-badge` setup-time chip, which is the boundary. */
  function card(heading: string): string {
    // Search inside the JSX only. The doc comment above the component names
    // these cards too, and matching there would slice the wrong region.
    const grid = SRC.indexOf('ts-grid3')
    const start = SRC.indexOf(heading, grid)
    expect(start, `card "${heading}" not found`).toBeGreaterThan(-1)
    const end = SRC.indexOf('v-badge', start)
    expect(end, `card "${heading}" has no v-badge to bound it`).toBeGreaterThan(start)
    return SRC.slice(start, end)
  }

  it('gates the broker sync card on autosync, not import', () => {
    const broker = card('Broker sync')
    expect(
      broker.includes('canAutosync'),
      'The broker sync card must key on canAutosync. Keyed on canImport it ' +
      'advertises the Trader plan for a Pro feature, which is a promise the ' +
      'product does not keep for anyone who pays on the strength of it.',
    ).toBe(true)
    expect(broker).not.toContain('canImport')
  })

  it('gates the statement card on import', () => {
    const statement = card('MT5 statement')
    expect(statement).toContain('canImport')
    expect(statement).not.toContain('canAutosync')
  })

  it('never hardcodes a plan name in the card copy', () => {
    // A literal is what let the two drift. The label has to come from the map.
    expect(SRC).not.toMatch(/\((Free|Trader|Pro|Pro Trader) plan\)/)
    expect(SRC).toContain('requiredPlanLabel')
  })
})
