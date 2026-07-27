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
  try {
    const r = await fetch(exchangeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token }),
    })
    const responseText = await r.text()
    console.log('[callback] backend status:', r.status, 'body:', responseText.slice(0, 500))
    if (!r.ok) {
      let detail: Record<string, unknown>
      try {
        detail = JSON.parse(responseText)
      } catch {
        detail = { detail: responseText || 'exchange failed' }
      }
      return NextResponse.json(detail, { status: r.status })
    }
    const out = JSON.parse(responseText) as { api_key: string; email: string }

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
  } catch (err) {
    console.error('[callback] exchange fetch error:', err)
    return NextResponse.json(
      { detail: 'polaris callback failed: ' + ((err as Error)?.message || 'unknown') },
      { status: 502 }
    )
  }
}
