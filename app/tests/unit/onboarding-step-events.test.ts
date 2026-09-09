// app/tests/unit/onboarding-step-events.test.ts
//
// ── Why this test exists ────────────────────────────────────────────────────
//
// `onboarding_step` is the only instrument that says WHERE people abandon
// onboarding, and it is read as a per-step reach count on /admin/analytics.
// That reading only holds if each step emits once per person.
//
// Step 6 emitted twice. `go(6)` fired {step: 6} on the way to the review
// screen, and `submit()` fired {step: 6, connect} again from that screen. In
// production the ratio was exactly 2:1 — steps 1–5 read 10 raw / 10 distinct,
// step 6 read 20 / 10 — so the one step that represents completion was the one
// step reading double.
//
// A second, unfired version of the same fault: `go` is wired to Back as well
// as Next, so revisiting a step re-counted it. Nobody had gone back yet, which
// is the only reason the data looked clean; it would have inflated exactly the
// steps people hesitate on.
//
// Both are shape problems in one component, so the guard is structural, in the
// style of tests/unit/broker-instrumentation.test.ts. The component is a
// client component full of JSX and the unit suite runs in `node` with no DOM,
// so its source is what can be checked here — and the source is where this
// regresses: someone adding a seventh screen, or a "record the choice at
// submit" line, puts the second emitter straight back.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// repo root is three levels up from app/tests/unit
const ROOT = join(__dirname, '..', '..', '..')
const SRC = 'app/src/app/onboarding/OnboardingForm.tsx'
const src = readFileSync(join(ROOT, SRC), 'utf8')

/** Body of an arrow-function const, sliced on balanced braces. A regex would
 *  run past the closing brace and swallow whatever follows — and the opening
 *  brace is found after the `=>`, not after the declaration, or a default
 *  parameter value (`props: TrackProps = {}`) is mistaken for the body. */
function bodyOf(decl: string): string {
  const start = src.indexOf(decl)
  expect(start).toBeGreaterThan(-1)
  const arrow = src.indexOf('=>', start)
  expect(arrow).toBeGreaterThan(-1)
  const open = src.indexOf('{', arrow)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  throw new Error(`unbalanced braces after ${decl}`)
}

describe('onboarding step instrumentation', () => {
  it('has exactly one onboarding_step emitter in the whole component', () => {
    // The duplicate was a SECOND call site, not a loop — one emitter is the
    // invariant, and it is the cheapest one to state.
    expect(src.match(/track\(\s*'onboarding_step'/g)).toHaveLength(1)
  })

  it('emits from go(), the only function that changes step', () => {
    const go = bodyOf('const go = (')
    expect(go).toContain("track('onboarding_step'")
    // Two setStep calls exist in the file: this one, and the localStorage
    // restore. A third would be a step transition that bypasses the emitter.
    expect(src.match(/setStep\(/g)).toHaveLength(2)
    expect(go).toContain('setStep(n)')
  })

  it('emits a given step at most once per mount', () => {
    const go = bodyOf('const go = (')
    // The guard must come BEFORE the track call, or it guards nothing.
    const guard = go.indexOf('emitted.current.has(n)')
    const add = go.indexOf('emitted.current.add(n)')
    const emit = go.indexOf("track('onboarding_step'")
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(emit)
    expect(add).toBeGreaterThan(guard)
    expect(add).toBeLessThan(emit)
    // And setStep must sit above the guard: the early return is about the
    // event, never about the navigation.
    expect(go.indexOf('setStep(n)')).toBeLessThan(guard)
  })

  it('does not re-emit on Back', () => {
    // Every Back handler routes through the deduplicated go(), same as Next.
    const backs = src.match(/onBack=\{\(\) => [a-zA-Z]+\(/g) ?? []
    expect(backs.length).toBeGreaterThanOrEqual(5)
    for (const b of backs) expect(b).toContain('go(')
  })

  it('does not emit a second step-6 event at submit', () => {
    // This is the production defect in one assertion.
    const submit = bodyOf('const submit = (')
    expect(submit).not.toContain('track(')
    expect(submit).toContain('requestSubmit()')
  })

  it('keeps the connect datum on the single step-6 emit', () => {
    // The `connect` prop was worth keeping — it is the step-5 answer, the
    // chosen data-connection path — so it moved onto the surviving emit rather
    // than being deleted with the duplicate call.
    expect(src).toContain('go(6, { connect: data.connect })')
    // And it is passed through, not dropped by a fixed props shape.
    expect(bodyOf('const go = (')).toContain('...props')
  })

  it('still writes the same answer to the profile row', () => {
    // The durable copy (migration 0062) is independent of the event and must
    // survive any future change to the instrumentation.
    expect(src).toContain('name="intended_source" value={data.connect}')
  })
})
