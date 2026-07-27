# polaris client (NextJS)

NextJS (App Router) + React 19 + Tailwind v4 + motion. Replaces the legacy
Vite/React SPA. Google sign-in lives entirely here; the backend verifies the
ID token once via `/auth/exchange` and returns an API key that this app stores
in an httpOnly `polaris_session` cookie and forwards as `Authorization: Bearer`
on every backend call.

## Run
```bash
cp .env.example .env.local     # set NEXT_PUBLIC_GOOGLE_CLIENT_ID + Razorpay key
npm install
npm run dev                    # http://localhost:5173
```

`npm run dev` rewrites `/auth`, `/code`, `/ingest`, `/billing`, `/events`,
`/list`, `/plan`, `/internal`, `/api` to `BACKEND_URL` (defaults to
https://polarisai.gleeze.com). In production, point a reverse proxy at the
FastAPI backend so the cookie travels same-origin.

## Auth flow
1. User clicks **Sign in with Google** (header or hero) → modal opens.
2. The Google Identity Services pill is rendered inside the modal.
3. The GIS callback POSTs the ID token to `/api/auth/callback` (a server route
   in this app) which calls the backend's `/auth/exchange` once and writes the
   returned API key into the httpOnly `polaris_session` cookie.
4. While verification is in flight, the modal switches to a blue spinner state
   so the user sees we're working on their sign-in.
5. `middleware.ts` protects `/account`, `/ingest`, `/code`, `/plan`, `/list`.
6. `/api/auth/signout` clears the cookie and calls backend `/auth/logout`.

## Billing
The pricing CTA wires `/billing/checkout` + `/billing/verify` to Razorpay's
checkout.js. On successful capture the backend grants the plan's USD value to
the user's credit balance (visible on `/account`).