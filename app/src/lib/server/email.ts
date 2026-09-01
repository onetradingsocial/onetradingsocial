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
  const key = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM || 'TradingSocial <updates@tradingsocial.io>'
  if (!key) return { sent: false, error: 'no_provider' }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ from, to: args.to, subject: args.subject, html: args.html }),
    })
    if (!res.ok) return { sent: false, error: `resend_${res.status}` }
    return { sent: true }
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : 'send_failed' }
  }
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
 *  Only the referral flow can produce this — the advertised 14-day Pro trial
 *  takes no card and creates no Stripe subscription, so it can never charge
 *  anyone. Terms §8 draws that distinction and this email is where the code
 *  keeps it: the amount, the date and the cancel route, all named, before any
 *  money moves. The `willCharge: false` branch exists so we never assert a
 *  charge we cannot see a payment method for. */
export function trialEndingHtml(x: {
  name: string
  amount: string | null
  interval: string | null
  endsOn: string | null
  willCharge: boolean
}): string {
  const when = x.endsOn ? ` on <b>${x.endsOn}</b>` : ' shortly'
  const per = x.interval ? `/${x.interval}` : ''
  const price = x.amount ? `<b>${x.amount}${per}</b>` : 'the standard Pro monthly price'
  const body = x.willCharge
    ? `<p style="font-size:14px;line-height:1.6">Your free Pro months are ending${when}. After that your subscription renews automatically at ${price} and the card you saved when you claimed the reward will be charged.</p>
       <p style="font-size:14px;line-height:1.6">If you'd rather not continue, cancel before that date and you won't be charged anything. Settings → Billing → <b>Manage billing &amp; invoices</b>.</p>`
    : `<p style="font-size:14px;line-height:1.6">Your free Pro months are ending${when}. We don't have a payment method on file, so nothing will be charged — your subscription will simply end and the account moves to Free.</p>
       <p style="font-size:14px;line-height:1.6">To keep Pro, add a card from Settings → Billing.</p>`
  return shell(`${x.name}, your free Pro months are nearly up`, `
    ${body}
    ${button(`${APP}/settings/billing`, 'Review your plan')}
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
 *  The single most important rule in this copy: **the trial takes no card, so
 *  nothing can be charged.** `trialExpiredHtml` already says so after the fact;
 *  the day-12 email is the one most likely to be misread as a billing warning,
 *  and a user cancelling a subscription that does not exist is the failure mode
 *  to design against. Every stage says what happens in plain terms and none of
 *  them mentions payment.
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
}): string {
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
      <p style="font-size:13px;line-height:1.6;color:#56536b">No card was taken and none is needed. Nothing will be charged at any point in the trial.</p>
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
      <p style="font-size:13px;line-height:1.6;color:#56536b">Still no card on file. Nothing will be charged.</p>
    `)
  }

  // Stage 12. Notice of a state change, not a sales email and not a bill.
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
