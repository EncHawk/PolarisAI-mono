import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { BACKEND_URL, SESSION_COOKIE } from '@/lib/api'

// Google Identity Services callback target (posted from the client button).
// The Google ID token is verified exactly once on the backend via
// /auth/exchange; we stash the returned Polaris api_key in an httpOnly cookie
// named `polaris_session` (the cookie the backend already accepts). JS never
// reads it.
export async function POST(req: Request) {
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ detail: 'invalid json body' }, { status: 400 })
  }

  const id_token = body?.id_token
  if (!id_token || typeof id_token !== 'string') {
    return NextResponse.json({ detail: 'missing id_token' }, { status: 400 })
  }

  const exchangeUrl = `${BACKEND_URL}/auth/exchange`
  let r: Response
  try {
    r = await fetch(exchangeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token }),
    })
  } catch (err) {
    console.error('[callback] fetch failed entirely:', err)
    return NextResponse.json(
      { detail: 'Network error reaching Polaris backend: ' + ((err as Error)?.message || 'unknown') },
      { status: 502 }
    )
  }

  let responseText: string
  try {
    responseText = await r.text()
  } catch {
    responseText = ''
  }

  console.log('[callback] backend status:', r.status, 'body preview:', responseText.slice(0, 800))

  if (!r.ok) {
    let detail: Record<string, unknown>
    try {
      detail = JSON.parse(responseText) as Record<string, unknown>
    } catch {
      detail = { detail: responseText || `Backend returned ${r.status}` }
    }
    return NextResponse.json(detail, { status: r.status })
  }

  let out: { api_key: string; email: string }
  try {
    out = JSON.parse(responseText) as { api_key: string; email: string }
  } catch {
    console.error('[callback] backend returned ok but invalid json:', responseText.slice(0, 500))
    return NextResponse.json({ detail: 'Backend returned invalid JSON' }, { status: 502 })
  }

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
