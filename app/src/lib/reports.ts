// Report reasons live here, not in actions/reports.ts: a 'use server' module may
// only export async functions, and shipping a plain const from one breaks the
// whole route's action bundle ("A 'use server' file can only export async
// functions, found object") — which 500s every server action on any page that
// renders ReportButton.
export const REPORT_REASONS = [
  ['suspicious_performance', 'Suspicious performance'],
  ['misleading_claims', 'Misleading profile claims'],
  ['impersonation', 'Impersonation'],
  ['manipulated_screenshots', 'Manipulated screenshots'],
  ['spam', 'Spam'],
  ['advice_violation', 'Financial-advice violation'],
] as const

export const REPORT_REASON_KEYS = new Set<string>(REPORT_REASONS.map(([k]) => k))
