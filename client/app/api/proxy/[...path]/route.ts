import { cookies } from 'next/headers'
import { BACKEND_URL, SESSION_COOKIE } from '@/lib/api'

// Catch-all proxy: reads the httpOnly polaris_session cookie and forwards it
// as `Authorization: Bearer <key>` to the FastAPI backend. All client-side
// fetches go through /api/proxy/<backend-path> so the backend always sees a
// proper auth header without the browser ever touching the key.

async function forward(req: Request, pathSegments: string[]): Promise<Response> {
  const path = '/' + pathSegments.join('/')
  const reqUrl = new URL(req.url)
  const targetUrl = new URL(`${BACKEND_URL}${path}`)
  reqUrl.searchParams.forEach((v, k) => targetUrl.searchParams.set(k, v))

  const key = (await cookies()).get(SESSION_COOKIE)?.value
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

  // For SSE, stream the response
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

  // For JSON, read and re-serialize
  const contentType = res.headers.get('Content-Type') || 'application/json'
  const body = await res.text()
  return new Response(body, {
    status: res.status,
    headers: { 'Content-Type': contentType },
  })
}

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  return forward(req, path)
}

export async function POST(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  return forward(req, path)
}

export async function PUT(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  return forward(req, path)
}

export async function DELETE(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  return forward(req, path)
}