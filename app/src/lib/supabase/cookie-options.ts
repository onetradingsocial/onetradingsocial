/**
 * Explicit cookie attributes for the Supabase auth cookies (item 9 F4/F5c).
 *
 * `@supabase/ssr` ships
 *   DEFAULT_COOKIE_OPTIONS = { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 400d }
 * (`node_modules/@supabase/ssr/dist/main/utils/constants.js`) and sets no
 * `Secure` attribute at all. Every client in this app previously took those
 * defaults untouched. The options below are merged over them by
 * `createServerClient`/`createBrowserClient`, so anything not named here keeps
 * the library default.
 *
 * ── `httpOnly` is deliberately NOT set, and that is a considered decision ────
 * Flipping it to true is a one-word change that would break the product. The
 * browser Supabase client needs to read the session out of `document.cookie`,
 * and eleven client components depend on it:
 *
 *   realtime  hooks/{useConversation,useNotifications,useTyping,useUnreadMessages}.ts
 *   uploads   _components/{AvatarUploader,CoverUploader}.tsx,
 *             messages/_components/MessageComposer.tsx,
 *             feed/_components/{PostComposer,home/Composer}.tsx
 *   other     _components/TradeModalProvider.tsx, _components/GoogleButton.tsx
 *
 * With `httpOnly: true` every realtime subscription and every direct-to-storage
 * upload stops working. Making the cookies HttpOnly is not a hardening task, it
 * is an architecture change: those paths would have to move behind server
 * actions / route handlers, or the session would have to be handed to the
 * browser client through a separate non-HttpOnly channel — which puts the token
 * back in JS and buys nothing.
 *
 * So the token stays JS-readable, and the control that actually bounds the
 * damage is the CSP. It is currently `Content-Security-Policy-Report-Only` with
 * `'unsafe-inline'` and `'unsafe-eval'` on `script-src`
 * (`next.config.ts:15,36`) — i.e. it reports and permits. Promoting it to
 * enforcing, with nonces instead of `unsafe-inline`, is the real fix and is
 * platform work, not auth work. Written up in ws2-auth.md; left for WS8.
 *
 * ── What this DOES fix ───────────────────────────────────────────────────────
 * `Secure`, which was simply absent. HSTS with `preload` already makes a
 * cleartext request to this origin practically impossible, so this is defence
 * in depth rather than a live hole — but the attribute costs nothing and its
 * absence is the kind of thing that only stays harmless while every other
 * control holds.
 *
 * Gated on NODE_ENV because `Secure` cookies are dropped over plain http, which
 * is how `next dev` and the Playwright e2e suite run.
 */
export const AUTH_COOKIE_OPTIONS = {
  path: '/',
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
} as const

/**
 * NOTE ON LIFETIME: `maxAge` is intentionally not set here — it would be
 * ignored. `@supabase/ssr` hard-overrides it back to its own 400-day default
 * on every write (`cookies.js:393`). Session lifetime is a GoTrue concern and
 * has to be set in the Supabase dashboard (Authentication → Sessions:
 * time-box + inactivity timeout). See item 9 F3.
 */
