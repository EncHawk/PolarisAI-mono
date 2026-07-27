import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE } from '@/lib/api'

// Protect app routes that require an authenticated user. The marketing pages
// (/, /#how, /#pricing) and the auth callbacks stay public.
const PROTECTED = ['/account', '/ingest', '/code', '/plan', '/list']

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const protect = PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  if (!protect) return NextResponse.next()

  const key = req.cookies.get(SESSION_COOKIE)?.value
  if (key && key.length > 0) return NextResponse.next()

  const url = req.nextUrl.clone()
  url.pathname = '/'
  url.searchParams.set('signin', '1')
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/account/:path*', '/ingest/:path*', '/code/:path*', '/plan/:path*', '/list/:path*'],
}