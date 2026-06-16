import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  basePath: '/app',
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, '../'),
}

export default nextConfig
