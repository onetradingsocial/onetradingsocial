import 'server-only'

/**
 * Minimal email sender (Sprint 4, rows 32/33). Uses Resend's REST API when
 * RESEND_API_KEY is set; otherwise no-ops and returns { sent: false } so the
 * caller can fall back to an in-app notification. No SDK dependency.
 */
export async function sendEmail(args: {
  to: string
  subject: string
  html: string
}): Promise<{ sent: boolean; error?: string }> {
  const suppressed = emailSuppression(args.to, process.env)
  if (suppressed) return { sent: false, error: suppressed }
  const key = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM || 'TradingSocial <updates@tradingsocial.io>'
  if (!key) return { sent: false, error: 'no_provider' }
  const post = () => fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from, to: args.to, subject: args.subject, html: args.html }),
  })
  try {
    let res = await post()
    // Resend's per-second limit answers 429 with a Retry-After of a second or
    // two; one short wait clears it. A long Retry-After is the DAILY quota,
    // which no wait inside a 60s function can outlast, so that is returned as
    // a transient failure for the caller to retry on the next run.
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after'))
      if (Number.isFinite(wait) && wait > 0 && wait <= MAX_INLINE_RETRY_S) {
        await new Promise((r) => setTimeout(r, wait * 1000))
        res = await post()
      }
    }
    if (!res.ok) return { sent: false, error: `resend_${res.status}` }
    return { sent: true }
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : 'send_failed' }
  }
}

const MAX_INLINE_RETRY_S = 2

/**
 * RFC 2606 / 6761 reserved names. Nobody can receive mail there, so a send can
 * only bounce, and bounces count against the sending domain's reputation.
 */
const RESERVED_TLDS = ['.test', '.example', '.invalid', '.localhost']
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org']

/**
 * Why a send must not happen, or null when it may.
 *
 * ── The incident ─────────────────────────────────────────────────────────────
 *
 * On 2026-09-15 the end-to-end suite ran on a local server against the dev
 * database. app/.env.local carries the real RESEND_API_KEY, so every test
 * account that finished onboarding was sent a real welcome email: ~90 of them,
 * to `e2e_…@tradingsocial.io` and `…@search.tradingsocial.test`, every one a
 * bounce. That spent Resend's daily quota before the production lifecycle cron
 * ran (all 12 of its sends came back 429) and put ~90 bounces on the domain's
 * record. The next suite run would have done it again.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 *
 * - `reserved_address`: never, in any environment.
 * - `not_production`: only a production Vercel deployment sends
 *   (`VERCEL_ENV === 'production'`). Local servers (dev or `next start`), the
 *   e2e suite and preview deployments all share the one real key and the one
 *   quota, and none has a reason to mail anyone. The test accounts use the real
 *   `@tradingsocial.io` domain, so they cannot be recognised by pattern; the
 *   environment is the only reliable line.
 *
 * `EMAIL_SEND_OUTSIDE_PRODUCTION=1` opts a non-production environment back in,
 * for deliberately testing a template against your own inbox. Reserved
 * addresses stay blocked even then.
 *
 * Both are permanent failures (see isTransientEmailError): retrying cannot
 * change them, so callers stamp and move on as they do for `no_provider`.
 */
export function emailSuppression(
  to: string,
  env: Record<string, string | undefined>,
): 'reserved_address' | 'not_production' | null {
  const domain = to.trim().toLowerCase().split('@').pop() ?? ''
  if (RESERVED_DOMAINS.includes(domain) || RESERVED_TLDS.some((t) => domain.endsWith(t))) {
    return 'reserved_address'
  }
  if (!isProductionDeployment(env) && env.EMAIL_SEND_OUTSIDE_PRODUCTION !== '1') {
    return 'not_production'
  }
  return null
}

/**
 * VERCEL_ENV is authoritative when present. It is a Vercel system variable,
 * which a project can choose not to expose; if that ever happens, falling back
 * to "not production" would silently stop every production email, trial
 * notices included. So when it is ABSENT, a deployment whose public site URL
 * is a real https origin counts as production. Local servers (and so the e2e
 * suite) point NEXT_PUBLIC_SITE_URL at localhost and stay blocked either way;
 * previews carry VERCEL_ENV=preview and are blocked by the first branch.
 */
function isProductionDeployment(env: Record<string, string | undefined>): boolean {
  if (env.VERCEL_ENV) return env.VERCEL_ENV === 'production'
  const site = env.NEXT_PUBLIC_SITE_URL ?? ''
  return site.startsWith('https://') && !/\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(site)
}

const PERMANENT_ERRORS = new Set(['no_provider', 'no_address', 'not_production', 'reserved_address'])

/**
 * Whether a `sendEmail` failure is worth retrying on a later run.
 *
 * Transient: rate limiting and quota (429), Resend server errors (5xx), and
 * network failures (anything that is not a `resend_<status>` code or one of the
 * two configuration outcomes). Permanent: no provider configured, no address,
 * and every other 4xx — a malformed request will fail the same way tomorrow.
 *
 * The distinction exists because the lifecycle cron stamps an email as handled
 * whether or not it went out, so that a missing provider cannot turn into a
 * flood the day one is configured. That rule is right for configuration and
 * wrong for a 429: on 2026-09-15 a spent daily quota turned five trial emails
 * into five stamped, never-delivered ones.
 */
export function isTransientEmailError(error: string | undefined): boolean {
  if (!error || PERMANENT_ERRORS.has(error)) return false
  const m = /^resend_(\d{3})$/.exec(error)
  if (!m) return true
  const status = Number(m[1])
  return status === 429 || status >= 500
}

const APP = process.env.NEXT_PUBLIC_SITE_URL || 'https://app.tradingsocial.io'

// The default footer points at a preferences page inside the account. That is
// right for every email except the one confirming the account no longer
// exists, where both the claim and the link are false -- so it is overridable.
const DEFAULT_FOOTER = `You're receiving this because you have a TradingSocial account.
        <a href="${APP}/settings#notifications" style="color:#6B43E0">Manage emails</a>.`

function shell(title: string, body: string, footer: string = DEFAULT_FOOTER): string {
  return `<!doctype html><html><body style="margin:0;background:#f6f6fb;font-family:system-ui,sans-serif;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #ece9f5">
      <div style="padding:20px 24px;background:linear-gradient(115deg,#3FB6E8,#7C5CE6,#C840BC,#FF7A4D)">
        <span style="color:#fff;font-weight:700;font-size:18px">TradingSocial</span>
      </div>
      <div style="padding:24px">
        <h1 style="font-size:20px;margin:0 0 12px">${title}</h1>
        ${body}
      </div>
      <div style="padding:16px 24px;color:#8b8799;font-size:12px;border-top:1px solid #ece9f5">
        ${footer}
      </div>
    </div></body></html>`
}

export function weeklyDigestHtml(x: {
  name: string; trades: number; winRate: number
  /** Null when no closed trade that week carried an r_multiple — a stop-less
   *  entry has a P/L but no R. Rendering that as "+0.0R" would state a
   *  break-even week as fact when the truth is that R was never measured, which
   *  is the one thing a performance email must never do. The row is omitted
   *  instead, and the cron swaps in an action that explains how to get it. */
  netR: number | null
  improvement: string; mistake: string; insight: string; action: string
}): string {
  const row = (k: string, v: string) => `<tr><td style="padding:6px 0;color:#56536b">${k}</td><td style="padding:6px 0;text-align:right;font-weight:700">${v}</td></tr>`
  return shell(`Your week, ${x.name}`, `
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px">
      ${row('Trades closed', String(x.trades))}
      ${row('Win rate', `${Math.round(x.winRate * 100)}%`)}
      ${x.netR == null ? '' : row('Net R', `${x.netR >= 0 ? '+' : ''}${x.netR.toFixed(1)}R`)}
    </table>
    <p style="font-size:14px;line-height:1.6"><b>Biggest improvement:</b> ${x.improvement}</p>
    <p style="font-size:14px;line-height:1.6"><b>Main mistake:</b> ${x.mistake}</p>
    <p style="font-size:14px;line-height:1.6"><b>One insight:</b> ${x.insight}</p>
    <p style="font-size:14px;line-height:1.6"><b>One action next week:</b> ${x.action}</p>
    <a href="${APP}/journal" style="display:inline-block;margin-top:12px;padding:10px 20px;background:#6B43E0;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Open your journal</a>
  `)
}

export function recoveryHtml(name: string, reason: string, cta: string, ctaHref: string): string {
  return shell(`We miss you, ${name}`, `
    <p style="font-size:14px;line-height:1.6">${reason}</p>
    <a href="${APP}${ctaHref}" style="display:inline-block;margin-top:12px;padding:10px 20px;background:#6B43E0;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">${cta}</a>
  `)
}

const button = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;margin-top:12px;padding:10px 20px;background:#6B43E0;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">${label}</a>`

export function welcomeHtml(x: {
  name: string
  /** profiles.intended_source: 'broker' | 'statement' | 'manual', or null for
   *  anyone who onboarded before 0062 existed. NULL means "never asked". */
  intent: string | null
  canAutosync: boolean
}): string {
  const wantsBroker = x.intent === 'broker'

  // Three states, in order of how much the product can do for them right now.
  const next = wantsBroker && x.canAutosync
    ? `<p style="font-size:14px;line-height:1.6">You said you'd add trades by connecting your broker, so start there. Connect your MT5 account once and every closed trade lands in your journal automatically, every hour — nothing to type, nothing to import.</p>
       ${button(`${APP}/settings#broker`, 'Connect your MT5 account')}
       <p style="font-size:13px;line-height:1.6;color:#56536b">It takes your account number, server and password. Read-only where your broker supports it.</p>`
    : wantsBroker
      ? `<p style="font-size:14px;line-height:1.6">You said you'd add trades by connecting your broker. Being straight with you: MT5 auto-sync is a <b>Pro</b> feature, and your account isn't on Pro right now — so the fastest way to get your first trade in today is to log it by hand.</p>
         ${button(`${APP}/journal`, 'Log your first trade')}
         <p style="font-size:13px;line-height:1.6;color:#56536b">Auto-sync is waiting in Settings → MT5 auto-sync whenever you upgrade. Nothing you log manually is lost when you switch.</p>`
      : `<p style="font-size:14px;line-height:1.6">One trade is all it takes to start. Log it with the entry, the exit and what you were thinking — the stats, the win rate and the patterns all build from there, and none of them exist until the first one is in.</p>
         ${button(`${APP}/journal`, 'Log your first trade')}`

  return shell(`Welcome, ${x.name}`, `
    <p style="font-size:14px;line-height:1.6">Your TradingSocial account is set up. Here's the one thing worth doing first.</p>
    ${next}
    <p style="font-size:13px;line-height:1.6;color:#56536b;margin-top:20px">Reply to this email if anything doesn't work — it reaches a person.</p>
  `)
}


/** A renewal payment failed.
 *
 *  Two variants, matching the two moments we send (see paymentFailure() in
 *  lib/billing-webhook.ts): the first failure, where the honest message is
 *  "nothing has been taken away yet, you have N days", and the final attempt,
 *  where it is "this was the last try". Naming the grace window in the email is
 *  deliberate — it is the difference between a customer who updates their card
 *  and one who assumes they have already been cut off. */
/* ── Billing lifecycle ────────────────────────────────────────────────────── */

/** The day-0 email. Sent once, at onboarding completion, by
 *  lib/server/welcome-email.ts.
 *
 *  Routed on what the user themselves said at onboarding step 5
 *  (`profiles.intended_source`, migration 0062) rather than on a guess, because
 *  that answer exists by the time this sends and measuring it was the whole
 *  point of storing it. `canAutosync` is checked SEPARATELY from that intent:
 *  MT5 auto-sync is Pro-gated (FEATURE_MIN_TIER.mt5_autosync), so a user who
 *  asked for broker sync but cannot currently use it must not be handed a CTA
 *  that lands on an upgrade wall. They get told the truth instead.
 *
 *  No positioning claims, no proof, no competitor framing: this says what
 *  happens next and links to it. That is deliberate — the homepage rewrite is
 *  parked pending customer interviews, and copy that made claims would be
 *  making them up. */
export function paymentFailedHtml(x: {
  name: string
  amount: string | null
  final: boolean
  graceDaysLeft: number
  invoiceUrl: string | null
}): string {
  const amount = x.amount ? `of <b>${x.amount}</b> ` : ''
  const lede = x.final
    ? `We tried your card one last time and the payment ${amount}didn't go through. This was the final automatic attempt.`
    : `Your latest payment ${amount}didn't go through — usually an expired card or a temporary hold from the bank. Stripe will retry automatically.`
  const access = x.final
    ? `<p style="font-size:14px;line-height:1.6"><b>Your paid features will end shortly.</b> Nothing you've logged is deleted — your trades and notes stay exactly where they are, and updating your card restores everything immediately.</p>`
    : `<p style="font-size:14px;line-height:1.6">You keep your paid features for the next <b>${x.graceDaysLeft} ${x.graceDaysLeft === 1 ? 'day' : 'days'}</b> while this is sorted out. Nothing you've logged is ever deleted.</p>`
  const invoice = x.invoiceUrl
    ? `<p style="font-size:13px;line-height:1.6;color:#56536b">You can also <a href="${x.invoiceUrl}" style="color:#6B43E0">pay this invoice directly</a>.</p>`
    : ''
  return shell(`${x.name}, your payment didn't go through`, `
    <p style="font-size:14px;line-height:1.6">${lede}</p>
    ${access}
    <p style="font-size:14px;line-height:1.6">Update your payment method from Settings → Billing → <b>Manage billing &amp; invoices</b>.</p>
    ${button(`${APP}/settings/billing`, 'Update your card')}
    ${invoice}
  `)
}

/** A Stripe trial with a card on file is about to convert.
 *
 *  ── THIS IS THE PRE-CHARGE NOTICE ───────────────────────────────────────────
 *
 *  It used to be reachable only from the referral flow, because the advertised
 *  14-day trial took no card and created no Stripe subscription. Every string
 *  here was written for that one case, which is why it talked about "free Pro
 *  months" and "the card you saved when you claimed the reward".
 *
 *  Once the advertised trial runs on Stripe, this fires on day 11 for every
 *  signup. It stops being a courtesy to a handful of referrers and becomes the
 *  notice the whole customer base gets before money leaves their account — the
 *  document a chargeback or an ACCC complaint would be argued from. Three
 *  things therefore have to be true of it, on every branch:
 *
 *    1. it names the AMOUNT, from Stripe's own price, never a hardcoded figure;
 *    2. it names the DATE; and
 *    3. it names the way out, and says that taking it costs nothing.
 *
 *  `kind` only changes the noun — "your free trial" or "your free Pro months".
 *  It must never change points 1 to 3.
 *
 *  The `willCharge: false` branch exists so we never assert a charge we cannot
 *  see a payment method for. */
export function trialEndingHtml(x: {
  name: string
  amount: string | null
  interval: string | null
  endsOn: string | null
  willCharge: boolean
  /** 'trial' = the advertised signup trial, 'reward' = referral free months. */
  kind?: 'trial' | 'reward'
}): string {
  const when = x.endsOn ? ` on <b>${x.endsOn}</b>` : ' shortly'
  const per = x.interval ? `/${x.interval}` : ''
  // No hardcoded plan in the fallback. This used to read "the standard Pro
  // monthly price", which named the wrong plan and the wrong interval for a
  // Trader or annual subscriber whenever the amount was missing.
  const price = x.amount ? `<b>${x.amount}${per}</b>` : 'the price shown on your billing page'
  const subject = x.kind === 'reward' ? 'free Pro months' : 'free trial'
  const noun = x.kind === 'reward' ? 'Your free Pro months are' : 'Your free trial is'
  const card = x.kind === 'reward' ? 'the card you saved when you claimed the reward' : 'the card on file'
  const body = x.willCharge
    ? `<p style="font-size:14px;line-height:1.6">${noun} ending${when}. After that your subscription continues automatically at ${price} and ${card} will be charged.</p>
       <p style="font-size:14px;line-height:1.6">If you'd rather not continue, cancel before that date and you won't be charged anything. Settings → Billing → <b>Manage billing &amp; invoices</b>.</p>
       <p style="font-size:13px;line-height:1.6;color:#56536b">Prices are in Australian dollars (AUD). No GST is charged — the amount above is the total that will be taken.</p>`
    : `<p style="font-size:14px;line-height:1.6">${noun} ending${when}. We don't have a payment method on file, so nothing will be charged — your subscription will simply end and the account moves to Free.</p>
       <p style="font-size:14px;line-height:1.6">To keep your plan, add a card from Settings → Billing.</p>`
  return shell(`${x.name}, your ${subject} ${x.willCharge ? 'ends soon' : 'is nearly up'}`, `
    ${body}
    ${button(`${APP}/settings/billing`, x.willCharge ? 'Review or cancel your plan' : 'Review your plan')}
  `)
}

/** The card-free 14-day Pro trial has lapsed.
 *
 *  Until now this happened in total silence: TRIAL_WALL_ENABLED ships false, no
 *  email existed, and the last signal a user got was a dismissible day-14
 *  banner. The copy leads with what they KEEP, because the single most common
 *  fear at this moment is that the journal has been wiped. */
export function trialExpiredHtml(x: { name: string; kept: number }): string {
  return shell(`${x.name}, your Pro trial has ended`, `
    <p style="font-size:14px;line-height:1.6">Your 14 days of Pro are up, so your account has moved to the <b>Free</b> plan. You were never charged and there's nothing to cancel — the trial never asked for a card.</p>
    <p style="font-size:14px;line-height:1.6"><b>Nothing you logged has been deleted.</b> Every trade, note and screenshot is still there. Free shows your most recent ${x.kept} trades; the rest come straight back the moment you upgrade.</p>
    <p style="font-size:14px;line-height:1.6">What you no longer have: unlimited journal history, advanced stats, strategy and mistake tagging, and MT5 import.</p>
    ${button(`${APP}/settings/billing`, 'See the plans')}
    <p style="font-size:13px;line-height:1.6;color:#56536b">Happy on Free? Nothing more to do — keep logging.</p>
  `)
}

/** One of the three in-trial emails (days 1, 7, 12). See lib/trial-sequence.ts
 *  for why the trial was silent until this existed, and why `trialEndingHtml`
 *  does not cover it.
 *
 *  ── THE PAYMENT CLAIM IS NOW CONDITIONAL, AND THAT IS THE WHOLE POINT ───────
 *
 *  This copy used to rest on one rule: **the trial takes no card, so nothing
 *  can be charged.** That was true of every trial this product could create,
 *  so the reassurance was hardcoded into all three stages.
 *
 *  It stopped being true when the trial moved to Stripe. The same three emails
 *  now reach two populations at once for the length of the grandfathering
 *  window: grandfathered users on the old card-free trial, for whom the
 *  original copy is still exactly right, and Stripe trialists with a card on
 *  file and a charge scheduled. Sending "Nothing will be charged" to the second
 *  group is a written promise not to charge someone we are about to charge —
 *  the most dangerous sentence this codebase can emit.
 *
 *  So `cardOnFile` drives every payment line, and `endsOn` names the date a
 *  charge lands. The failure mode to design against has INVERTED: it used to be
 *  a user cancelling a subscription that does not exist; it is now a user who
 *  does not cancel one that does.
 *
 *  Day 12 is the sharp edge. For a card-free trial it is notice of a downgrade.
 *  For a Stripe trial it would be notice of a charge — except Stripe's own
 *  `customer.subscription.trial_will_end` already fires on day 11 and owns that
 *  notice, so the caller suppresses stage 12 for card-on-file trials rather
 *  than send two contradictory emails a day apart. The branch below is still
 *  written correctly for that case: a template must not depend on its caller to
 *  keep it honest about money.
 *
 *  Day 1 and 7 lead with connecting a broker because the trial is the one
 *  window where that CTA is honest — `mt5_autosync` is Pro-gated, and a trial
 *  user is on Pro. `canAutosync` is still passed rather than assumed, so a
 *  comped or otherwise unusual account cannot be promised a feature it lacks. */
export function trialSequenceHtml(x: {
  name: string
  stage: 1 | 7 | 12
  daysLeft: number
  trades: number
  hasBroker: boolean
  canAutosync: boolean
  kept: number
  /** A card is on file and a charge follows this trial. See the note above. */
  cardOnFile?: boolean
  /** Card on file, but the customer has cancelled: no charge follows. Checked
   *  before `cardOnFile` on every payment line. */
  cancelling?: boolean
  /** The date the trial converts or lapses, already formatted for display
   *  (en-AU, Australia/Sydney) by the caller. Only read when `cardOnFile`. */
  endsOn?: string | null
}): string {
  // "on 29 September" when we know the date, "when your trial ends" when we do
  // not. Never an empty string or an "Invalid Date" in front of a customer.
  const when = x.endsOn ? `on ${x.endsOn}` : 'when your trial ends'
  // The one next action, shared by days 1 and 7 and chosen the same way the
  // recovery nudge chooses it (lib/recovery.ts) so the two never contradict.
  const action = x.hasBroker
    ? `<p style="font-size:14px;line-height:1.6">Your broker is connected, so there is nothing to set up. Closed trades land in the journal on their own, usually within the hour.</p>
       ${button(`${APP}/journal`, 'Open your journal')}`
    : x.canAutosync
      ? `<p style="font-size:14px;line-height:1.6">Connect your MT5 account and you never type a trade in: every closed position lands in the journal automatically, every hour. It is the one setup step worth doing while you have Pro.</p>
         ${button(`${APP}/settings#broker`, 'Connect your MT5 account')}`
      : `<p style="font-size:14px;line-height:1.6">Log one trade — the entry, the exit, and what you were thinking. Everything else in here builds from the first one.</p>
         ${button(`${APP}/journal`, 'Log your first trade')}`

  if (x.stage === 1) {
    return shell(`${x.name}, one thing to do today`, `
      <p style="font-size:14px;line-height:1.6">You have Pro for the next ${x.daysLeft} days. Rather than list everything it unlocks, here is the single thing that makes the rest of it work.</p>
      ${action}
      <p style="font-size:13px;line-height:1.6;color:#56536b">${x.cardOnFile && x.cancelling
        ? `You have cancelled, so nothing will be charged. Your account moves to the Free plan ${when}.`
        : x.cardOnFile
        ? `Your card is on file and nothing has been charged yet. Your plan starts ${when} — cancel before then in Settings &rarr; Billing and you will not be charged.`
        : 'No card was taken and none is needed. Nothing will be charged at any point in the trial.'}</p>
    `)
  }

  if (x.stage === 7) {
    const progress = x.trades === 0
      ? `<p style="font-size:14px;line-height:1.6">Your journal is still empty, which means the stats, the weekly review and the patterns all have nothing to work from yet. That is fixable in about a minute.</p>`
      : `<p style="font-size:14px;line-height:1.6">You have <b>${x.trades} ${x.trades === 1 ? 'trade' : 'trades'}</b> logged. That is enough for the journal to start showing you something — win rate, average R, and which setups are actually carrying you.</p>`
    return shell(`${x.name}, halfway through your trial`, `
      <p style="font-size:14px;line-height:1.6">A week in, ${x.daysLeft} days of Pro left.</p>
      ${progress}
      ${x.trades === 0 ? action : `${button(`${APP}/journal`, 'See what your trades say')}`}
      <p style="font-size:13px;line-height:1.6;color:#56536b">${x.cardOnFile && x.cancelling
        ? `You have cancelled, so nothing will be charged. Your account moves to the Free plan ${when}.`
        : x.cardOnFile
        ? `Your card is on file. Nothing is charged until your plan starts ${when}; cancel before then in Settings &rarr; Billing and you will not be charged.`
        : 'Still no card on file. Nothing will be charged.'}</p>
    `)
  }

  // Stage 12. Notice of a state change, not a sales email and not a bill.
  //
  // With a card on file it is notice of a CHARGE, so it says so first and names
  // the date and the route out before anything else. Normally unreachable —
  // Stripe's trial_will_end owns the pre-charge notice on day 11 and the caller
  // suppresses this stage for card-on-file trials — but correct here regardless,
  // because a template that depends on its caller to stay honest about money is
  // one refactor away from lying.
  if (x.cardOnFile && x.cancelling) {
    return shell(`${x.name}, your Pro trial ends in ${x.daysLeft} ${x.daysLeft === 1 ? 'day' : 'days'}`, `
      <p style="font-size:14px;line-height:1.6">Your ${x.daysLeft === 1 ? 'last day' : 'final days'} of the free trial.</p>
      <p style="font-size:14px;line-height:1.6"><b>You will not be charged.</b> You cancelled, so your account moves to the <b>Free</b> plan ${when}.</p>
      <p style="font-size:14px;line-height:1.6"><b>Nothing you have logged is deleted.</b> Every trade, note and screenshot stays exactly where it is.</p>
      ${button(`${APP}/settings/billing`, 'Review your plan')}
    `)
  }

  if (x.cardOnFile) {
    return shell(`${x.name}, your Pro trial ends in ${x.daysLeft} ${x.daysLeft === 1 ? 'day' : 'days'}`, `
      <p style="font-size:14px;line-height:1.6">Your ${x.daysLeft === 1 ? 'last day' : 'final days'} of the free trial. Here is exactly what happens next, so none of it is a surprise.</p>
      <p style="font-size:14px;line-height:1.6"><b>Your paid plan starts ${when}, and the card you saved will be charged.</b> If you would rather not continue, cancel before then in <b>Settings &rarr; Billing</b> and you will not be charged anything.</p>
      <p style="font-size:14px;line-height:1.6"><b>Nothing you have logged is deleted</b> either way. Every trade, note and screenshot stays exactly where it is.</p>
      ${button(`${APP}/settings/billing`, 'Review or cancel your plan')}
      <p style="font-size:13px;line-height:1.6;color:#56536b">Prices are in Australian dollars (AUD). You can cancel at any time.</p>
    `)
  }

  return shell(`${x.name}, your Pro trial ends in ${x.daysLeft} ${x.daysLeft === 1 ? 'day' : 'days'}`, `
    <p style="font-size:14px;line-height:1.6">Your ${x.daysLeft === 1 ? 'last day' : 'final days'} of Pro. Here is exactly what happens next, so none of it is a surprise.</p>
    <p style="font-size:14px;line-height:1.6"><b>You will not be charged.</b> The trial never asked for a card and there is nothing to cancel. When it ends your account simply moves to the <b>Free</b> plan.</p>
    <p style="font-size:14px;line-height:1.6"><b>Nothing you have logged is deleted.</b> Every trade, note and screenshot stays exactly where it is. Free shows your most recent ${x.kept} trades; the rest come straight back if you upgrade later.</p>
    <p style="font-size:14px;line-height:1.6">What stops: automatic MT5 sync, unlimited journal history, advanced stats, and strategy and mistake tagging.</p>
    ${button(`${APP}/settings/billing`, 'See the plans')}
    <p style="font-size:13px;line-height:1.6;color:#56536b">Happy to carry on with Free? Nothing to do — keep logging.</p>
  `)
}

/** The account is gone. Sent AFTER the hard delete, to the address captured
 *  before it — by then auth.users no longer holds it, which is the point.
 *
 *  This is the only remaining channel to a deleted user, so it carries the two
 *  disclosures that have nowhere else to live (item 6 F6.6): what deletion
 *  could not reach at third parties, and the exchange API keys we have no
 *  power to revoke on their behalf. Saying "we deleted everything" and leaving
 *  those out is the misrepresentation the audit flagged; this is the honest
 *  version of the same sentence.
 *
 *  No login link, no "we're sorry to see you go" upsell, no reactivation
 *  offer: there is no account to come back to, and pretending otherwise in an
 *  email that confirms an erasure would be worse than useless. */
export function accountDeletedHtml(x: {
  residue: readonly { name: string; holds: string; removal: string }[]
  exchanges: readonly string[]
}): string {
  const rows = x.residue.map((r) => `
    <li style="margin-bottom:10px"><b>${r.name}</b> — ${r.holds}.<br />
      <span style="color:#56536b">${r.removal}</span></li>`).join('')
  const exchangeWarning = x.exchanges.length
    ? `<p style="font-size:14px;line-height:1.6;padding:12px 14px;background:#fff6ed;border-radius:10px">
         <b>Revoke your exchange API key.</b> Your ${x.exchanges.join(' and ')} API key has been deleted
         from our database, but only you can revoke it at the exchange. Log in to your exchange account
         and delete the key you created for TradingSocial.</p>`
    : ''
  return shell('Your TradingSocial account has been deleted', `
    <p style="font-size:14px;line-height:1.6">Your account is gone. Your profile, trades, journal notes,
    posts, messages and uploaded images have been permanently deleted, your subscription has been
    cancelled and your card detached, and any connected broker account has been removed. This email
    address is free to sign up again with if you ever want to.</p>
    <p style="font-size:14px;line-height:1.6">If you did not ask for this, reply to this email
    immediately.</p>
    ${exchangeWarning}
    <h2 style="font-size:15px;margin:22px 0 8px">What we could not delete for you</h2>
    <p style="font-size:14px;line-height:1.6">These companies received information while you were using
    TradingSocial. We have no way to delete it on your behalf, so here is exactly who holds what:</p>
    <ul style="font-size:14px;line-height:1.6;padding-left:18px">${rows}</ul>
    <h2 style="font-size:15px;margin:22px 0 8px">What we kept, and why</h2>
    <p style="font-size:14px;line-height:1.6">Two things survive deliberately. If you ever paid us,
    Australian tax law requires us to keep the invoice record for five years. And if anyone reported
    your account to us, that report is kept without your name attached so the same issue can be
    recognised if it recurs. Nothing else is retained.</p>
    <p style="font-size:13px;line-height:1.6;color:#56536b">Questions about any of this: reply to this
    email or write to onetradingsocial@gmail.com.</p>
  `, 'This is the last email we will send to this address. There is no longer a TradingSocial account attached to it.')
}

/* ── Milestones ───────────────────────────────────────────────────────────── */

/** Interpolated values in this file are mostly ours. `firstTradeHtml`'s are
 *  not: `instrument` is free text off the log-trade form and `name` is a
 *  display name, so both get escaped before they land in markup. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** The first logged trade. Sent once, by lib/server/first-trade-email.ts.
 *
 *  This one is deliberately a joke, because it is the only lifecycle email we
 *  send that is not asking for anything. Everything else in here is a bill, a
 *  warning, a nudge or a digest; this is the single moment where the product
 *  can just be pleased with someone. Activation is the metric this email
 *  exists to move (`first_trade_logged`, lib/server/funnel.ts) and the thing
 *  that moves it is trade number two, so the reward has to arrive fast and
 *  feel disproportionate to what they did.
 *
 *  ── THE ONE RULE THE HUMOUR ANSWERS TO ──────────────────────────────────────
 *
 *  It branches on `outcome`, and the loss branch is the whole reason it does.
 *  A generic "🎉 Congratulations!" landing on someone who just logged a losing
 *  first trade reads as a product that did not look at the data it was given,
 *  and this product's entire pitch is that it looks at the data. So the joke
 *  is never at the expense of the result: the win branch teases the 100% win
 *  rate, the loss branch is warm and says the useful true thing, and neither
 *  ever congratulates anyone on losing money.
 *
 *  No P/L figure, no R, no win rate as a number. One trade cannot support a
 *  statistic, and printing one would be the weekly digest's sin (`netR == null`)
 *  committed for a laugh. */
export function firstTradeHtml(x: {
  name: string
  instrument: string
  direction: 'long' | 'short'
  /** The row's own `outcome` column. 'open' when they logged an entry with no
   *  exit yet — a first trade that is still running is a real and common case,
   *  and celebrating a result it does not have would be a lie. */
  outcome: 'win' | 'loss' | 'breakeven' | 'open'
}): string {
  const ticket = `${x.direction === 'long' ? 'Long' : 'Short'} ${esc(x.instrument)}`

  const reaction = {
    win: `<p style="font-size:14px;line-height:1.6">It's a win, so your all-time win rate is currently <b>100%</b>. Enjoy that number. It is never going to be that high again, and we will not be bringing it up.</p>`,
    loss: `<p style="font-size:14px;line-height:1.6">It's a loss — which is, annoyingly, the more useful first entry. Anyone can log the good ones. The traders who get somewhere are the ones whose journals still have the red trades in them six months later, and yours starts with one.</p>`,
    breakeven: `<p style="font-size:14px;line-height:1.6">Breakeven. The most anticlimactic possible way to open a trading journal, and honestly a bit rude of the market. The chart has to start somewhere.</p>`,
    open: `<p style="font-size:14px;line-height:1.6">It's still open, so this is less a celebration and more a cliffhanger. Close it out when it's done and the stats will catch up.</p>`,
  }[x.outcome]

  return shell(`${esc(x.name)}, that's one.`, `
    <p style="font-size:14px;line-height:1.6">You logged your first trade. <b>${ticket}</b> is now in the journal forever, or until you delete it, which we would notice.</p>
    ${reaction}
    <p style="font-size:14px;line-height:1.6">Here is the unfunny part. Your win rate, your average R, which setups actually carry you, the weekly review, the patterns you have not spotted yet — all of it is arithmetic over the trades in your journal. There is currently one. That is not a sample, it's an anecdote.</p>
    <p style="font-size:14px;line-height:1.6">Two makes it a line. Twenty makes it an argument.</p>
    ${button(`${APP}/journal`, 'Log trade number two')}
    <p style="font-size:13px;line-height:1.6;color:#56536b;margin-top:20px">Yes, we sent an email about one trade. This is the only one — we will not be doing this at number seven.</p>
  `)
}
