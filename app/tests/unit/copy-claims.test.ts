// app/tests/unit/copy-claims.test.ts
//
// Truthfulness guards for customer-facing copy (audit B5).
//
// Every claim pinned here was, at the time of writing, a sentence the product
// could not keep. None of them broke a test, a type or a build — marketing copy
// and the gate that contradicts it live in different files and are never
// compared. That comparison is what this file is.
//
// The pattern follows landing-proof.test.ts and plan-labels.test.ts: assert the
// runtime value where there is one, and read the source where the claim is a
// string in a page the tests cannot render.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LANDINGS } from '@/lib/landing'
import { WELCOME_TIERS } from '@/lib/welcome-tiers'
import { REFERRAL_MONTH_CAP } from '@/lib/referral'
import { FREE_ACTIVE_GOAL_LIMIT, JOURNAL_FREE_LIMIT, can, requiredPlanLabel } from '@/lib/entitlements'

// repo root is three levels up from app/tests/unit
const ROOT = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/** Collapse whitespace so an assertion cannot be defeated by a line wrap. */
const flat = (s: string) => s.replace(/\s+/g, ' ')

/** Comments out. Several of the fixes below carry a comment that QUOTES the
 *  sentence it replaced, which is exactly the wording these tests forbid — so
 *  a scan of the raw file would fail on its own explanation. Only shipped copy
 *  is scanned: HTML comments, block comments — the braced JSX form included —
 *  and whole-line `//` comments are removed first. Line comments must start a
 *  line, so the `//` in a URL survives. */
const shipped = (s: string) =>
  s
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')

// ---------------------------------------------------------------------------
// 1. Unbounded anti-fraud claims
// ---------------------------------------------------------------------------

/** The surfaces a prospect reads before signing up, plus the two app-side
 *  modules that carry the same marketing sentences. */
const CUSTOMER_FACING = [
  'index.html',
  'pricing.html',
  'blog.html',
  'for/educators.html',
  'for/mt5.html',
  'for/prop-firm.html',
  'app/src/lib/landing.ts',
  'app/src/app/_components/AuthShell.tsx',
]

/**
 * Claims of unforgeable-ness, in the several spellings the site used.
 *
 * What the product actually does is narrower, and its own explainer
 * (`app/src/app/verification/page.tsx`) says so plainly: an MT5 statement can
 * be altered before it is uploaded, account type is self-declared, and there is
 * no way to know whether a connected account is the trader's only one. What we
 * can stand behind is that every trade is LABELLED with its source and that the
 * execution fields of `statement` and `broker` trades are locked
 * (`lib/verification.ts`) — a bound, not an absolute. Copy that says "can't be
 * faked" promises the absolute.
 */
const UNBOUNDED = [
  'tamper-proof',
  'tamperproof',
  'tamper proof',
  "can't be faked",
  '&#39;t be faked',
  '’t be faked',
  'cant be faked',
  'cannot be faked',
  'unfakeable',
  'performance can be trusted',
  'results that can be trusted',
]

describe('no copy claims a record cannot be faked', () => {
  for (const file of CUSTOMER_FACING) {
    it(`${file} makes no unbounded anti-fraud claim`, () => {
      const src = shipped(read(file)).toLowerCase()
      for (const needle of UNBOUNDED) {
        expect(
          src.includes(needle.toLowerCase()),
          `${file} contains "${needle}". The verification explainer says a ` +
          `statement can be altered and account type is self-declared, so this ` +
          `is a promise the product contradicts on its own page. Bound it: ` +
          `source-labelled records, locked imported execution fields.`,
        ).toBe(false)
      }
    })
  }

  it('keeps the bounded phrasing the codebase already got right', () => {
    // The two anchors every rewrite was aligned to.
    expect(LANDINGS.mt5.points[2].body).toContain("Imported prices and results can't be edited")
    expect(flat(read('for/educators.html'))).toContain(
      'Manually logged trades stay clearly labelled as manual',
    )
  })

  it('never claims the lock covers manually logged trades', () => {
    // Only 'statement' and 'broker' sources lock execution fields; a manual
    // trade stays editable by its owner forever. Copy saying the whole track
    // record or history "can't be edited" overstates that by a whole source.
    for (const file of CUSTOMER_FACING) {
      const src = flat(shipped(read(file))).toLowerCase()
      for (const claim of [
        "track record can't be edited",
        "history can't be edited",
        "record can't be edited",
        'track record can&#39;t be edited',
      ]) {
        expect(src.includes(claim), `${file} contains "${claim}"`).toBe(false)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 2. Referral share text
// ---------------------------------------------------------------------------

describe('the referral share text', () => {
  const SRC = read('app/src/app/_components/ReferralModal.tsx')

  it('does not promise the recipient a reward', () => {
    // `creditReferral` grants free Pro months to the REFERRER only. The person
    // clicking the link gets the same 14-day trial as any other signup, so
    // "we both get Pro free" was a reward no code path issues — and the one
    // sentence in the whole modal that the referred trader actually reads.
    const m = SRC.match(/const SHARE_TEXT = ([`'"])([\s\S]*?)\1/)
    expect(m, 'no SHARE_TEXT literal found in ReferralModal.tsx').not.toBeNull()
    const text = (m as RegExpMatchArray)[2]
    expect(text.toLowerCase()).not.toContain('we both')
    expect(text.toLowerCase()).not.toMatch(/both (get|earn)/)
  })

  it('reads the month cap off the constant rather than guessing', () => {
    // The fallback was a hand-written 12 against a cap of 6: with the summary
    // still loading it drew a 12-step track and a "12 months free" caption for
    // a programme that stops at half that.
    expect(REFERRAL_MONTH_CAP).toBe(6)
    expect(SRC).toContain('REFERRAL_MONTH_CAP')
    expect(
      /cap\s*=\s*summary\?\.cap\s*\?\?\s*\d/.test(SRC),
      'the cap fallback is a numeric literal again',
    ).toBe(false)
    // No literal month count anywhere in the copy — the body used to spell "6".
    expect(
      /up to <b>\d+ months<\/b>/.test(SRC),
      'the modal body hardcodes the month cap',
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3. Blog cadence
// ---------------------------------------------------------------------------

describe('the blog hero', () => {
  const SRC = read('blog.html')

  it('promises no publishing cadence', () => {
    // "Updated weekly" was true of an intention, never of the feed. The newest
    // post is months old, and a cadence claim goes stale silently — nothing
    // rebuilds the page when a week passes without a post.
    const m = flat(shipped(SRC)).match(/updated\s+(weekly|daily|monthly|every\s+week)/i)
    expect(m?.[0] ?? null, 'blog.html promises a publishing cadence').toBeNull()
  })

  it('states a date that comes from the posts themselves', () => {
    expect(SRC).toContain('id="blogLatest"')
    expect(SRC).toMatch(/blogLatest[\s\S]{0,400}posts\[0\]\.published_date/)
  })

  it('degrades to no claim at all when the fetch fails', () => {
    // The span ships empty, so JS off or /data/posts.json down leaves the bare
    // title — never a stale cadence promise baked into the HTML.
    expect(SRC).toMatch(/<span id="blogLatest"><\/span>/)
  })
})

// ---------------------------------------------------------------------------
// 4. The Free welcome popup
// ---------------------------------------------------------------------------

describe('the Free welcome popup', () => {
  const free = WELCOME_TIERS.free
  const copy = free.feats.map((f) => `${f.t} ${f.d}`).join(' ').toLowerCase()

  it('states the premise: which of these are Free features and which are not', () => {
    // Mistake tagging IS free as of the "Basic Cycle" change — writing down
    // what went wrong is a reflection input. The three below are not.
    expect(can('free', 'mistake_tagging')).toBe(true)
    expect(can('free', 'strategy_tracking')).toBe(false)
    expect(can('free', 'advanced_stats')).toBe(false)
    expect(can('free', 'leaderboard_ranking')).toBe(false)
  })

  it('offers mistake tagging, which Free now has', () => {
    // The original assertion here was "does not offer tagging", because at the
    // time all tagging was Trader+ and the mockup's 'tag how each one went' was
    // a promise the gate broke. Half of that is now inverted: withholding the
    // claim would understate the plan and leave the one habit Free is built
    // around unmentioned. So the list must say it.
    expect(copy).toMatch(/mistake tagging/)
  })

  it('still does not offer STRATEGY tagging, which Free does not have', () => {
    // The other half of the original assertion, unchanged in substance. The two
    // tagging features read alike in copy and are on opposite sides of the
    // free/paid line, so the Free list may name mistakes and may not name
    // strategies.
    expect(can('free', 'strategy_tracking')).toBe(false)
    expect(copy).not.toMatch(/strateg/)
  })

  it('does not promise the mistake ANALYSIS that stays paid', () => {
    // Free writes the tag; `mistake_analysis` (Trader+) is the card that scores
    // those tags against results. A Free list that says "see which mistakes
    // cost you most" describes a card the reader will never be shown.
    expect(can('free', 'mistake_analysis')).toBe(false)
    expect(copy).not.toMatch(/mistake analysis|which mistakes? (cost|are costing)/)
  })

  it('says how many process goals Free actually gets', () => {
    // Goals shipped ungated and uncapped; Free now holds FREE_ACTIVE_GOAL_LIMIT
    // active ones. An unqualified "process goals" line would read as unlimited.
    expect(can('free', 'multiple_goals')).toBe(false)
    const goal = free.feats.find((f) => f.t.toLowerCase().includes('process goal'))
    expect(goal, 'the Free tier should advertise the one process goal it has').toBeDefined()
    expect(goal!.t.toLowerCase()).toContain(FREE_ACTIVE_GOAL_LIMIT === 1 ? 'one' : String(FREE_ACTIVE_GOAL_LIMIT))
    // Names the plan that lifts the cap from the gate, not from a literal.
    expect(goal!.d).toContain(requiredPlanLabel('multiple_goals'))
  })

  it('does not offer win rate "at a glance"', () => {
    // Win rate is the locked tile in the journal's StatCards: without
    // advanced_stats it renders a padlock, which is the opposite of at a glance.
    expect(copy).not.toContain('win rate')
  })

  it('says who can rank rather than implying the reader can', () => {
    // 'See where you rank against the community' — a Free account is filtered
    // out by boardEligibleIds and never appears on any board.
    expect(copy).not.toMatch(/where you rank|see where you/)
    const board = free.feats.find((f) => f.t.toLowerCase().includes('leaderboard'))
    expect(board, 'the Free tier should still advertise leaderboard access').toBeDefined()
    // Names the plan from the gate, so it cannot drift the way a literal would.
    expect(board!.d).toContain(requiredPlanLabel('leaderboard_ranking'))
  })

  it('quotes the journal cap from the constant that enforces it', () => {
    expect(copy).toContain(String(JOURNAL_FREE_LIMIT))
    expect(read('app/src/lib/welcome-tiers.tsx')).toContain('JOURNAL_FREE_LIMIT')
  })
})

// ---------------------------------------------------------------------------
// 5. The dashboard onboarding checklist
// ---------------------------------------------------------------------------

describe('the onboarding checklist', () => {
  const SRC = read('app/src/app/page.tsx')

  /** The `checklist` array literal only — the surrounding page mentions these
   *  features for other reasons. */
  function checklistBody(): string {
    const start = SRC.indexOf('const checklist: ChecklistItem[] = [')
    expect(start, 'no checklist literal found in page.tsx').toBeGreaterThan(-1)
    const end = SRC.indexOf('\n  ]', start)
    expect(end, 'checklist literal is not closed').toBeGreaterThan(start)
    return SRC.slice(start, end)
  }

  // The invariant is that no step is offered which the account cannot finish.
  // OnboardingChecklist only hides itself once every item is done, so a step a
  // plan forbids is a card that never goes away on a bar that can never fill.
  //
  // There are two honest ways to satisfy that, and the checklist now uses both:
  // hide the step, or give it a route the plan allows. Tagging has no ungated
  // route, so it is hidden. The review step does — a self-recorded review — so
  // it stays visible and ticks on that instead.

  it('only offers "Tag your first strategy" to accounts that hold strategy_tracking', () => {
    expect(can('free', 'strategy_tracking')).toBe(false)
    const body = checklistBody()
    const at = body.indexOf('Tag your first strategy')
    expect(at, 'the tagging step is not in the checklist literal').toBeGreaterThan(-1)
    // The entry must sit inside a conditional spread, not be a bare element.
    const before = body.slice(Math.max(0, at - 160), at)
    expect(
      /\.\.\.\(\s*can\w+\s*\?/.test(before),
      'the tagging step is an unconditional checklist entry. It must be spread ' +
      'in behind the same gate the feature reads, or given an ungated route.',
    ).toBe(true)
    expect(SRC).toContain(`canFlag(flags, tier, 'strategy_tracking')`)
  })

  it('keeps the review step reachable on Free rather than hiding it', () => {
    // `weekly_review_viewed` fires only from WeeklyReviewCard, which renders
    // nothing below Trader — so a review step resting on that signal alone is
    // permanently unticked for every Free account. It must also read a source
    // that Free can actually write.
    expect(can('free', 'weekly_review')).toBe(false)
    const body = checklistBody()
    const at = body.indexOf("key: 'review'")
    expect(at, 'no review step in the checklist literal').toBeGreaterThan(-1)
    const entry = body.slice(at).split('\n')[0]
    expect(
      entry.includes('processLogs'),
      'the review step ticks only on weekly_review_viewed, which Free users ' +
      'can never emit. Tick it on the self-recorded review as well, or hide it.',
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 6. The end-of-trial wall
// ---------------------------------------------------------------------------

describe('the end-of-trial wall', () => {
  const SRC = read('app/src/app/_components/TrialGateModal.tsx')

  it('does not imply Free keeps a place on the leaderboard', () => {
    // This modal is the moment the user LOSES leaderboard_ranking, so listing
    // "the leaderboard" among what Free keeps is wrong exactly where it is most
    // expensive to be wrong.
    expect(
      flat(shipped(SRC)).includes('the feed and the leaderboard'),
      'the wall still lists "the leaderboard" among what Free keeps',
    ).toBe(false)
    expect(SRC).toContain("requiredPlanLabel('leaderboard_ranking')")
  })

  it('reads the retained trade count off the gate', () => {
    expect(SRC).toContain('JOURNAL_FREE_LIMIT')
    expect(
      /last 30 trades/.test(flat(shipped(SRC))),
      'the wall hardcodes the free trade cap instead of reading JOURNAL_FREE_LIMIT',
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 7. The ranking paywall, disclosed
// ---------------------------------------------------------------------------

describe('the pricing comparison table', () => {
  const SRC = read('pricing.html')

  it('has a row for ranking, not just for viewing', () => {
    expect(SRC).toContain('>View public leaderboard<')
    expect(
      /<td class="ct-feat">Rank on the public leaderboard/.test(SRC),
      'The table listed only "View public leaderboard". Ranking is a separate ' +
      'gate (leaderboard_ranking, Trader+), so a Free reader had no way to ' +
      'learn their name can never appear on the board being advertised.',
    ).toBe(true)
  })

  it('marks ranking unavailable on Free and available on both paid tiers', () => {
    const start = SRC.indexOf('<td class="ct-feat">Rank on the public leaderboard')
    const row = SRC.slice(start, SRC.indexOf('</tr>', start))
    const cells = row.split('<td class="ct-cell').slice(1)
    expect(cells).toHaveLength(3)          // Free, Trader, Pro
    expect(cells[0]).toContain('ct-no')
    expect(cells[1]).toContain('ct-yes')
    expect(cells[2]).toContain('ct-yes')
  })

  it('does not sell the leaderboard to Free without saying it is read-only', () => {
    expect(
      SRC.includes('Follow traders, newsfeed &amp; public leaderboard'),
      'the Free plan card lists the leaderboard without saying it is view-only',
    ).toBe(false)
  })
})

describe('the home page leaderboard panel', () => {
  it('names the tier that can rank, and says the trial grants it', () => {
    // Worded to match the in-app leaderboard header, so the marketing page and
    // the product make the same promise once both land.
    const panel = flat(read('index.html'))
    expect(panel).toContain('Trader level and above')
    expect(panel).toContain('which the 14-day trial also grants')
  })
})
