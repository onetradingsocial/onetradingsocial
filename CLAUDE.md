# Working notes

## Debugging a "Something went wrong" page

`app/src/app/error.tsx` and `global-error.tsx` report themselves before they
render. Every time a user hits that page, the boundary writes a row to
`public.analytics_events` in the production Supabase project
(`jmpanzrjxflovdfwcbye`). **Read that table first.** It answers "which route,
which build, since when" in one query, before touching git history.

```sql
select created_at, path, props->>'digest' as digest,
       props->>'code' as code, props->>'kind' as kind
from public.analytics_events
where event = 'client_error'
order by created_at desc limit 25;
```

How to read the result:

- **`path`** — the route that broke. Narrows the search to one page.
- **`created_at`** — when it *started*. Line the first row up against deploys
  and against production data changes; the trigger is often neither a deploy
  nor a code change but the first row of data that reaches a previously dead
  branch.
- **`digest`** — present only for errors thrown during a **Server Components
  render**. Its absence means the throw was client-side. The value is a
  per-build hash, so the same underlying bug gets a new digest after every
  deploy — a digest changing is not a different bug.
- **`code`** — a label from a fixed vocabulary in `app/src/lib/redact.ts`
  (`classifyClientError`), not the raw message. `react_<n>` is a minified React
  error number; `unclassified` means the message matched no rule, which is
  common and is not itself a signal.

The raw message is deliberately not stored — audit item 19, F1: it used to be,
and an uncontrolled string joined to a named account by `anon_id` in a table
with no retention policy is attributable data. Do not add it back. The digest
is the value that correlates to the full stack in Vercel's runtime logs.

### A server render can throw after its queries succeed

Supabase edge logs showing `200` for a page's queries does **not** mean the page
rendered. The throw can happen afterwards, while building JSX. If the query logs
look healthy but the page is down, that combination points at the render, and
`digest` being present confirms it is server-side.

### Watch for branches that production data has never reached

The 2026-09-04 `/admin/feedback` outage: a Server Component imported a plain
value (`FEEDBACK_CATEGORIES`) from a `'use client'` module, which resolves to a
client-reference proxy rather than the value, and throws when touched. It sat
behind `{catCounts.size > 0 && ...}`. No feedback row had ever been categorised,
so the line had never run. It broke four seconds after an admin picked the first
theme — with no deploy involved.

`tsc` resolves those imports, the bundle builds, and tests pass. There is now a
structural guard in `app/tests/unit/admin-gate.test.ts` that fails on any
non-component import from a `'use client'` module under `app/src/app/admin`.

## Server actions: gate with `getAdminUser()`, never `requireAdmin()`

`requireAdmin()` raises `notFound()`. Inside a Server Action that does not fail
the action, it fails the **page** — Next renders the not-found boundary in place
of whatever the user was looking at. Pages and layouts keep `requireAdmin()`,
where 404 is correct and hides the route. Actions use `getAdminUser()` and
return `{ error: NOT_ADMIN }`. Both sit on the same `cache()`d call, so the check
and its freshness are identical; only the failure representation differs.

A returned error is only an improvement if the caller reads it. Any client
component invoking an admin action must check the `{ error }` and put its
control back to the value the server still holds.

## Client components calling server actions

Always `await` the action inside an `async` transition callback:

```tsx
start(async () => { const res = await someAction(...); if (res?.error) { ... } })
```

A synchronous callback returns before the action settles, so React closes the
transition immediately: the control is never really disabled, the router may not
apply the revalidated tree, and the write can silently fail to land. This was the
feedback triage bug — the status dropdown was the only one of four sibling
controls that did not await, and its writes never reached the database.
