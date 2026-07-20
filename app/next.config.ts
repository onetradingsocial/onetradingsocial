import type { NextConfig } from 'next'
import path from 'path'

// Content-Security-Policy (row 52).
//
// Report-Only for now: it logs violations without breaking anything, so we can
// confirm nothing legitimate trips it before switching to enforcing. Flip the
// header name to 'Content-Security-Policy' once the reports come back clean.
//
// 'unsafe-inline'/'unsafe-eval' on script-src are required by Next's inline
// bootstrap and by the analytics pixels; tightening that needs nonces, which is
// a bigger change than this row warrants.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.redditstatic.com https://connect.facebook.net https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  // Supabase storage, Google avatars and pixel beacons all serve images.
  "img-src 'self' data: blob: https: ",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://www.google-analytics.com https://www.googletagmanager.com https://api.twelvedata.com https://*.reddit.com https://www.facebook.com https://vitals.vercel-insights.com",
  "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
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
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default nextConfig
