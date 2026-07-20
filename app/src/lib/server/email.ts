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
