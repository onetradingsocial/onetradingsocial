import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'

/**
 * Structural guard for audit item 18, F2.
 *
 * `requireAdmin()` used to run in exactly one place — `admin/layout.tsx` — and
 * 14 of the 15 admin pages had no authorisation statement of their own, while
 * 13 of them opened a **service-role** client as their first data operation.
 * Next.js's own guidance is that a layout must not be relied on for
 * authorisation: it does not re-execute on every navigation within its segment,
 * so a crafted RSC request for a nested page is the shape of a bypass, and the
 * consequence here would not be an empty shell but the full user directory —
 * the service-role client bypasses RLS entirely.
 *
 * This is a lint rule expressed as a test because the failure mode is a *new*
 * file, not a changed one. Nobody deletes a `requireAdmin()` call; somebody
 * adds `admin/payouts/page.tsx` six months from now, copies the shape of an
 * existing page, and inherits the gap. A test that walks the directory catches
 * that on the first run; a code review of the one new file probably does not.
 *
 * It reads source text rather than importing the modules on purpose: importing
 * a React Server Component into vitest drags in `next/headers`, the Supabase
 * client and a request scope that does not exist here. The question being asked
 * is "does this file contain its own check", which is a question about the
 * text.
 */

const ADMIN_DIR = join(process.cwd(), 'src', 'app', 'admin')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) out.push(full)
  }
  return out
}

const FILES = walk(ADMIN_DIR).map((f) => ({
  rel: relative(ADMIN_DIR, f).split(sep).join('/'),
  src: readFileSync(f, 'utf8'),
}))

const PAGES = FILES.filter((f) => f.rel === 'page.tsx' || f.rel.endsWith('/page.tsx'))

/** Own check = imports the gate AND calls it. Importing without calling is the
 *  exact half-done state this guard exists to catch. */
function gatesItself(src: string): boolean {
  return /from '@\/lib\/server\/admin'/.test(src) && /requireAdmin\(\)/.test(src)
}

describe('admin route gate (audit item 18, F2)', () => {
  it('finds every admin page', () => {
    // Sanity check on the walker itself: if this drops to 0 the suite below
    // passes vacuously and proves nothing.
    expect(PAGES.length).toBeGreaterThanOrEqual(15)
  })

  it('every admin page calls requireAdmin() itself, not just the layout', () => {
    const missing = PAGES.filter((p) => !gatesItself(p.src)).map((p) => p.rel)
    expect(missing).toEqual([])
  })

  it('the layout still gates too — it renders the nav and the pending counts', () => {
    const layout = FILES.find((f) => f.rel === 'layout.tsx')
    expect(layout).toBeDefined()
    expect(gatesItself(layout!.src)).toBe(true)
  })

  it('every file that opens a service-role client under /admin also gates itself', () => {
    // The property that actually matters: an RLS-bypassing query and its
    // authorisation check must live in the same file. Client components under
    // _components/ never import the service client (that would be a far worse
    // bug and lib/supabase/service.ts is `import 'server-only'`), so this
    // sweeps the whole tree rather than only pages.
    const unguarded = FILES
      .filter((f) => /@\/lib\/supabase\/service/.test(f.src))
      .filter((f) => !gatesItself(f.src))
      .map((f) => f.rel)
    expect(unguarded).toEqual([])
  })

  it('the gate runs before the page body opens a service-role client', () => {
    // Ordering matters: a page that awaits a service-role query and *then*
    // checks would still have run the query. Scoped to the default export's
    // body, because several pages define module-level helpers that call
    // createServiceClient() lazily and only ever run after the gate.
    const late = PAGES.filter((p) => {
      const bodyStart = p.src.indexOf('export default async function')
      if (bodyStart === -1) return true
      const body = p.src.slice(bodyStart)
      const svc = body.indexOf('createServiceClient(')
      if (svc === -1) return false
      const gate = body.indexOf('requireAdmin()')
      return gate === -1 || gate > svc
    }).map((p) => p.rel)
    expect(late).toEqual([])
  })
})

describe('admin server actions (audit item 18, B1 — regression guard)', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'app', 'actions', 'admin.ts'), 'utf8')

  it('every exported action opens with requireAdmin()', () => {
    // The audit confirmed all 15 were correct. This is the guard that keeps
    // them correct, including the reveal actions added by WS4 — which return
    // an email address and a broker login, so an unguarded one would be worse
    // than any of the original 15.
    const exports = [...src.matchAll(/export async function (\w+)\s*\(/g)]
    expect(exports.length).toBeGreaterThanOrEqual(17)

    const ungated = exports
      .filter((m) => {
        const body = src.slice(m.index!, m.index! + 900)
        const gate = body.indexOf('await requireAdmin()')
        const svc = body.indexOf('createServiceClient()')
        return gate === -1 || (svc !== -1 && gate > svc)
      })
      .map((m) => m[1])
    expect(ungated).toEqual([])
  })

  it('the reveal actions write an audit row', () => {
    // F3's masking is only worth having if the reveal is recorded — otherwise
    // it is a click that changes nothing except how much work the admin does.
    for (const action of ['revealUserEmail', 'revealBrokerLogin']) {
      const start = src.indexOf(`export async function ${action}`)
      expect(start).toBeGreaterThan(-1)
      const body = src.slice(start, src.indexOf('\n}', start))
      expect(body).toMatch(/logAdminAction\(/)
    }
  })
})

describe('server components never import values from client modules', () => {
  // The /admin/feedback crash of 2026-09-04. The page is a Server Component and
  // rendered its theme chips from FEEDBACK_CATEGORIES, which was exported from
  // FeedbackCategory.tsx — a 'use client' module. A server import of a plain
  // value from a client module resolves to a client-reference proxy, not the
  // array, so touching it throws during the server render.
  //
  // Nothing caught it: tsc resolves the type fine, the bundle builds, and the
  // page only renders that block when at least one row is categorised
  // (`catCounts.size > 0`). Production had no categorised feedback for months,
  // so the branch was dead until an admin picked the first theme — and the page
  // broke four seconds later.
  const ADMIN = join(process.cwd(), 'src', 'app', 'admin')

  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    ).filter((f) => f.endsWith('.tsx'))

  const files = walk(ADMIN)
  const isClient = (f: string) => readFileSync(f, 'utf8').trimStart().startsWith("'use client'")
  const clientModules = new Set(
    files.filter(isClient).map((f) => basename(f, '.tsx')),
  )

  it('no server component imports a non-component export from a client component', () => {
    const offenders: string[] = []
    for (const f of files.filter((x) => !isClient(x))) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/import \{([^}]+)\} from '([^']*\/)?([A-Za-z]+)'/g)) {
        const [, names, , mod] = m
        if (!clientModules.has(mod)) continue
        // A component is PascalCase; anything SCREAMING_CASE or camelCase is a
        // plain value and must not cross the boundary.
        const values = names
          .split(',')
          .map((n) => n.trim().split(/\s+as\s+/).pop()!.trim())
          .filter((n) => n && !/^type /.test(n) && !/^[A-Z][a-zA-Z0-9]*$/.test(n))
        if (values.length) {
          offenders.push(`${relative(process.cwd(), f)} imports { ${values.join(', ')} } from client module ${mod}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
