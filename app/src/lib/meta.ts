// Pure Meta-pixel helpers. Deliberately NOT in MetaPixel.tsx: that file is
// 'use client', so every export from it becomes a client reference and a server
// component calling one throws "Attempted to call X from the server but X is on
// the client". The billing page is a server component and needs these values to
// build the Subscribe event's params, so they live in a plain module both sides
// can import.

/** First-invoice amounts in USD (mirrors PLANS in settings/billing). */
const SUBSCRIBE_VALUE: Record<string, number> = {
  trader_monthly: 30,
  trader_annual: 72,
  pro_monthly: 50,
  pro_annual: 120,
}

/** Params for the Subscribe standard event, from the tier/interval the
 *  checkout route appends to its success URL. Unknown combos → no params. */
export function subscribeParams(tier?: string, interval?: string) {
  const value = SUBSCRIBE_VALUE[`${tier}_${interval}`]
  return value ? { value, currency: 'USD', content_name: `${tier}_${interval}` } : undefined
}
