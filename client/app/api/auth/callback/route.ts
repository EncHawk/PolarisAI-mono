import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { BACKEND_URL, SESSION_COOKIE } from '@/lib/api'

// Google Identity Services callback target (posted from the client button).
// The Google ID token is verified exactly once on the backend via
// /auth/exchange; we stash the returned Polaris api_key in an httpOnly cookie
// named `polaris_session` (the cookie the backend already accepts). JS never
// reads it.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const id_token = body?.id_token
  if (!id_token) return NextResponse.json({ detail: 'missing id_token' }, { status: 400 })

  const r = await fetch(`${BACKEND_URL}/auth/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_token }),
  })
  if (!r.ok) {
    const detail = await r.json().catch(() => ({ detail: 'exchange failed' }))
    return NextResponse.json(detail, { status: r.status })
  }
  const out = (await r.json()) as { api_key: string; email: string }

  const secure = process.env.NODE_ENV === 'production'
  ;(await cookies()).set({
    name: SESSION_COOKIE,
    value: out.api_key,
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  return NextResponse.json({ ok: true, email: out.email })
}