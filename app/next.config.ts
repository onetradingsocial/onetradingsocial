import type { NextConfig } from 'next'
import path from 'path'

// Content-Security-Policy (row 52; audit item 17 finding 8, item 2 finding 3).
//
// STILL REPORT-ONLY, AND THAT IS A DECISION, NOT AN OVERSIGHT.
//
// The previous state was Report-Only with no report-uri and no report-to, which
// collects nothing: the browser computed every violation and discarded it. That
// is exactly why the live tag set drifted past the policy unnoticed — two GA4
// properties that exist nowhere in this repository, and a Meta Conversions API
// Gateway on AWS us-west-2, all firing on every page load with no signal. A
// reporting endpoint now exists (app/src/app/api/csp-report/route.ts) and both
// origins report to it.
//
// It is NOT being promoted to enforcing in this change because two of the
// things it would block are still unidentified, and enforcing a policy against
// hosts nobody has decided about breaks the site to protect it. Promote when
// ALL of the following are true:
//
//   1. Audit item 17 finding 1 is closed — the owner has identified who owns
//      GA4 properties G-8KLKEXS42J and G-XYC3QYS733 and removed the ones that
//      are not the business's. Until then the correct connect-src is unknown.
//   2. The Meta CAPI Gateway question is answered. The pixel config at
//      connect.facebook.net/signals/config/1056839790113606 provisions
//      https://fh-118116076e9a4c2a96a99fbb70bea2a0.ecs.us-west-2.on.aws/ with a
//      fallback of https://bded8a3c6ae-1-1053047382554.us-central1.run.app.
//      Neither is allowlisted here on purpose — leaving them in the violation
//      reports is how they stay visible until someone decides whether that
//      gateway should exist at all.
//   3. A week of reports from this endpoint comes back with nothing but those
//      known items.
//
// Promoting also matters beyond tracking: the auth work identified an enforcing
// CSP as the real mitigation for the non-HttpOnly Supabase cookies, so this is
// on the critical path for that finding too.
//
// 'unsafe-inline'/'unsafe-eval' on script-src are required by Next's inline
// bootstrap and by the analytics pixels; tightening that needs nonces, which is
// a bigger change than this row warrants.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.redditstatic.com https://connect.facebook.net",
  // Fonts are self-hosted by next/font at build time — the Google Fonts hosts
  // were never contacted at runtime.
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  // Was the wildcard `https:`, which permitted any image-shaped tracker on any
  // host and so could never report an injected pixel. Supabase storage, Google
  // avatars and the ad-network beacons are what actually serve images here.
  "img-src 'self' data: blob: https://*.supabase.co https://lh3.googleusercontent.com https://www.google-analytics.com https://www.google.com https://www.facebook.com https://*.reddit.com",
  // Removed: api.twelvedata.com (server-only — the browser never calls it) and
  // vitals.vercel-insights.com (@vercel/speed-insights is not installed).
  // Added: www.google.com, which Google Signals beacons to.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://www.google-analytics.com https://www.googletagmanager.com https://www.google.com https://*.reddit.com https://www.facebook.com",
  // Removed the Stripe frame hosts: there is no Stripe.js anywhere, checkout is
  // a full-page redirect.
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  'report-uri /api/csp-report',
].join('; ')

// Baseline security headers for the app deployment. The static marketing
// site gets its equivalents from vercel.json at the repo root.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Content-Security-Policy-Report-Only', value: csp },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, '../'),
  // ccxt is a large, server-only dependency (crypto exchange sync) that uses a
  // dynamic require in its base Exchange class. Keeping it external stops
  // webpack bundling it into the serverless functions — removes the benign
  // "Critical dependency" build warning and shrinks bundle/cold-start.
  serverExternalPackages: ['ccxt'],
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default nextConfig
