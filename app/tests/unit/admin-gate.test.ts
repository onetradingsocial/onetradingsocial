import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

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

  it('every exported action opens with the getAdminUser() gate', () => {
    // The audit confirmed all 15 were correct. This is the guard that keeps
    // them correct, including the reveal actions added by WS4 — which return
    // an email address and a broker login, so an unguarded one would be worse
    // than any of the original 15.
    //
    // Actions gate with `getAdminUser()` + an early return, NOT `requireAdmin()`.
    // requireAdmin() raises notFound(), and notFound() inside a Server Action
    // does not fail the action — it fails the PAGE, replacing whatever the
    // admin was looking at with the not-found boundary. Pages keep it (see the
    // suite above, where 404 is the right answer and hides the route); actions
    // return an error the caller can render.
    const exports = [...src.matchAll(/export async function (\w+)\s*\(/g)]
    expect(exports.length).toBeGreaterThanOrEqual(17)

    const ungated = exports
      .filter((m) => {
        const body = src.slice(m.index!, m.index! + 900)
        const gate = body.indexOf('await getAdminUser()')
        const svc = body.indexOf('createServiceClient()')
        return gate === -1 || (svc !== -1 && gate > svc)
      })
      .map((m) => m[1])
    expect(ungated).toEqual([])
  })

  it('every action turns a failed gate into a returned error', () => {
    // `getAdminUser()` on its own gates nothing — it returns null and carries
    // on. The early return is the gate, so it is what this asserts. Without
    // this half, dropping the `if` would leave the suite above green while
    // every action ran for anyone.
    const exports = [...src.matchAll(/export async function (\w+)\s*\(/g)]
    const unhandled = exports
      .filter((m) => {
        const body = src.slice(m.index!, m.index! + 900)
        return !/if \(!admin\) return \{ error: NOT_ADMIN \}/.test(body)
      })
      .map((m) => m[1])
    expect(unhandled).toEqual([])
  })

  it('no action reaches for requireAdmin()', () => {
    expect(src).not.toContain('requireAdmin')
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
