import 'server-only'
import { cookies } from 'next/headers'

/**
 * Server-side fetch wrapper that forwards the httpOnly `polaris_session`
 * cookie as `Authorization: Bearer …` to the FastAPI backend. The cookie
 * itself never leaves the server.
 */

export const SESSION_COOKIE = 'polaris_session'

// Server-side fetch needs an absolute URL (Next route handlers run in Node).
// The browser uses relative paths via the `rewrites` in next.config.ts.
export const BACKEND_URL =
  process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'https://polarisai.gleeze.com'

function abs(path: string): string {
  return path.startsWith('http') ? path : `${BACKEND_URL}${path}`
}

export async function getApiKey(): Promise<string | null> {
  const key = (await cookies()).get(SESSION_COOKIE)?.value
  return key && key.length > 0 ? key : null
}

export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const key = await getApiKey()
  const headers = new Headers(init.headers)
  if (key) headers.set('Authorization', `Bearer ${key}`)
  return fetch(abs(path), { ...init, headers, cache: 'no-store' })
}

export interface Account {
  id: string
  email: string
  name: string | null
  username: string | null
  github: string | null
  x: string | null
  credits: number
  subscription_tier: string | null
  renews_at: string | null
}

export async function getAccount(): Promise<Account | null> {
  const res = await authedFetch('/auth/account')
  if (!res.ok) return null
  return (await res.json()) as Account
}