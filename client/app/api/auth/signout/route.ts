import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { BACKEND_URL, SESSION_COOKIE } from '@/lib/api'

// Wipe the api_key on the backend and clear the httpOnly cookie.
export async function POST() {
  const cookieStore = await cookies()
  const key = cookieStore.get(SESSION_COOKIE)?.value
  if (key) {
    await fetch(`${BACKEND_URL}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
    }).catch(() => {})
  }
  const response = NextResponse.json({ ok: true })
  response.cookies.delete(SESSION_COOKIE)
  return response
}