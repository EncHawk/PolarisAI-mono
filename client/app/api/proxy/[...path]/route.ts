import { NextRequest } from 'next/server'
import { BACKEND_URL, SESSION_COOKIE } from '@/lib/api'

// Catch-all proxy: reads the httpOnly polaris_session cookie and forwards it
// as `Authorization: Bearer <key>` to the FastAPI backend. All client-side
// fetches go through /api/proxy/<backend-path> so the backend always sees a
// proper auth header without the browser ever touching the key.

async function forward(req: NextRequest, pathSegments: string[]): Promise<Response> {
  const path = '/' + pathSegments.join('/')
  const targetUrl = new URL(`${BACKEND_URL}${path}`)
  const reqUrl = new URL(req.url)
  reqUrl.searchParams.forEach((v, k) => targetUrl.searchParams.set(k, v))

  const key = req.cookies.get(SESSION_COOKIE)?.value
  const headers = new Headers(req.headers)
  headers.delete('cookie')
  headers.delete('host')
  if (key) {
    headers.set('Authorization', `Bearer ${key}`)
  }

  const init: RequestInit = {
    method: req.method,
    headers,
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.text()
  }

  const isSSE = path.startsWith('/events/')
  const res = await fetch(targetUrl.toString(), init)

  if (isSSE && res.body) {
    return new Response(res.body, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    })
  }

  const contentType = res.headers.get('Content-Type') || 'application/json'
  const body = await res.text()
  return new Response(body, {
    status: res.status,
    headers: { 'Content-Type': contentType },
  })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  return forward(req, path)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  return forward(req, path)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  return forward(req, path)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  return forward(req, path)
}