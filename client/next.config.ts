import type { NextConfig } from 'next'

const backendTarget = process.env.BACKEND_URL ?? 'https://polarisai.gleeze.com'

// In dev, rewrite all API prefixes to the FastAPI backend so the httpOnly
// `polaris_session` cookie travels with the request. In production, a reverse
// proxy (or the deploy platform) should handle this same-origin.
const rewritten = ['/auth', '/code', '/ingest', '/billing', '/events', '/list', '/plan', '/internal']

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return rewritten.map((p) => ({
      source: `${p}/:path*`,
      destination: `${backendTarget}${p}/:path*`,
    }))
  },
}

export default nextConfig