import type { NextConfig } from 'next'
import path from 'path'

// Baseline security headers for the app deployment. The static marketing
// site gets its equivalents from vercel.json at the repo root.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, '../'),
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default nextConfig
