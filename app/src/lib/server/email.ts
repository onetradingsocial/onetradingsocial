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

function shell(title: string, body: string): string {
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
        You're receiving this because you have a TradingSocial account.
        <a href="${APP}/settings#notifications" style="color:#6B43E0">Manage emails</a>.
      </div>
    </div></body></html>`
}

export function weeklyDigestHtml(x: {
  name: string; trades: number; winRate: number; netR: number
  improvement: string; mistake: string; insight: string; action: string
}): string {
  const row = (k: string, v: string) => `<tr><td style="padding:6px 0;color:#56536b">${k}</td><td style="padding:6px 0;text-align:right;font-weight:700">${v}</td></tr>`
  return shell(`Your week, ${x.name}`, `
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px">
      ${row('Trades closed', String(x.trades))}
      ${row('Win rate', `${Math.round(x.winRate * 100)}%`)}
      ${row('Net R', `${x.netR >= 0 ? '+' : ''}${x.netR.toFixed(1)}R`)}
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

/* ── Billing lifecycle ────────────────────────────────────────────────────── */

const button = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;margin-top:12px;padding:10px 20px;background:#6B43E0;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">${label}</a>`

/** A renewal payment failed.
 *
 *  Two variants, matching the two moments we send (see paymentFailure() in
 *  lib/billing-webhook.ts): the first failure, where the honest message is
 *  "nothing has been taken away yet, you have N days", and the final attempt,
 *  where it is "this was the last try". Naming the grace window in the email is
 *  deliberate — it is the difference between a customer who updates their card
 *  and one who assumes they have already been cut off. */
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
