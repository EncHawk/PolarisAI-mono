'use client'

import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void
      on: (event: string, handler: (response: unknown) => void) => void
    }
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            callback: (response: { credential?: string }) => void
          }) => void
          renderButton: (
            parent: HTMLElement,
            options: {
              type?: 'standard' | 'icon'
              size?: 'large' | 'medium' | 'small'
              text?: 'signin' | 'signup' | 'continue' | 'signin_with'
              shape?: 'rectangular' | 'pill' | 'circle' | 'square'
              theme?: 'outline' | 'filled_blue' | 'filled_black'
              width?: number
              locale?: string
            },
          ) => void
        }
      }
    }
  }
}

type PlanId = 'starter' | 'pro' | 'lab'

/*  Reveal helpers  */

function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 36 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-12% 0px' }}
      transition={{ duration: 0.8, delay: delay / 1000, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}

/*  Scroll-drawn line  */

function ScrollLine() {
  const pathRef = useRef<SVGPathElement | null>(null)
  useEffect(() => {
    const path = pathRef.current
    if (!path) return
    const length = path.getTotalLength()
    path.style.strokeDasharray = `${length}`
    path.style.strokeDashoffset = `${length}`
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight
        if (max <= 0) return
        const progress = Math.min(1, Math.max(0, window.scrollY / max))
        path.style.strokeDashoffset = `${length * (1 - progress)}`
      })
    }
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    update()
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      cancelAnimationFrame(frame)
    }
  }, [])
  return (
    <svg
      className="pointer-events-none absolute inset-x-0 top-0 z-0 h-full w-full"
      viewBox="0 0 1200 3600"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path
        ref={pathRef}
        className="scroll-path"
        d="M180 40 C180 420 1020 520 1020 980 C1020 1440 180 1540 180 2000 C180 2460 1020 2560 1020 3000 C1020 3300 620 3400 620 3560"
      />
    </svg>
  )
}

function PolarisWordmark() {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className="group inline-flex w-full cursor-default justify-center select-none"
      initial="idle"
      animate="idle"
      whileHover={reduce ? undefined : 'draw'}
    >
      <svg viewBox="0 0 1100 200" className="w-full max-w-[1100px]" aria-label="POLARIS" role="img">
        <motion.text
          x="550"
          y="150"
          textAnchor="middle"
          fontFamily="'Space Grotesk', sans-serif"
          fontWeight={600}
          fontSize={180}
          letterSpacing="-9"
          stroke="var(--color-blue)"
          strokeWidth={1.4}
          strokeLinejoin="round"
          strokeLinecap="round"
          fill="var(--color-blue)"
          style={{ strokeDasharray: 2400 }}
          variants={{
            draw: {
              strokeDashoffset: [2400, 0],
              fillOpacity: [0, 0, 1],
              transition: { duration: 1.6, ease: 'easeInOut', times: [0, 0.55, 1] },
            },
            idle: {
              strokeDashoffset: 0,
              fillOpacity: 0,
              transition: { duration: 0.7, ease: 'easeOut' },
            },
          }}
        >
          POLARIS
        </motion.text>
      </svg>
    </motion.div>
  )
}

/*  Google Identity Services login — modal flow  */

function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve()
  return new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => resolve()
    document.head.appendChild(script)
  })
}

type SignInStep = 'pick' | 'verifying' | 'error'

function SignInModal({
  open,
  onClose,
  onSignedIn,
}: {
  open: boolean
  onClose: () => void
  onSignedIn: (email: string) => void
}) {
  const btnRef = useRef<HTMLDivElement | null>(null)
  const [step, setStep] = useState<SignInStep>('pick')
  const [error, setError] = useState('')
  const [hint, setHint] = useState('Closing Google picker…')
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID

  // Reset to the picker step every time the modal opens.
  useEffect(() => {
    if (!open) return
    setStep('pick')
    setError('')
  }, [open])

  // Render the Google Identity Services pill into btnRef once per open.
  useEffect(() => {
    if (!open || !clientId) return
    let cancelled = false
    const render = () => {
      if (cancelled || !window.google?.accounts?.id || !btnRef.current) return
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (resp: { credential?: string }) => {
          const idToken = resp.credential
          if (!idToken) {
            setStep('error')
            setError('Google did not return a credential. Try again.')
            return
          }
          // Google picker closed → switch to the blue loading state immediately
          // so the user sees we're working on their sign-in.
          setStep('verifying')
          setHint('Verifying your Google account…')
          try {
            const r = await fetch('/api/auth/callback', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id_token: idToken }),
            })
            if (!r.ok) {
              const detail = await r.json().catch(() => ({ detail: 'Sign-in failed.' }))
              setStep('error')
              setError(typeof detail.detail === 'string' ? detail.detail : 'Sign-in failed.')
              return
            }
            setHint('Issuing your Polaris API key…')
            const data = (await r.json()) as { email: string }
            onSignedIn(data.email)
            onClose()
          } catch {
            setStep('error')
            setError('Could not reach the Polaris API. Check your connection and try again.')
          }
        },
      })
      window.google.accounts.id.renderButton(btnRef.current, {
        type: 'standard',
        size: 'large',
        text: 'signin_with',
        shape: 'pill',
        theme: 'outline',
        width: 280,
      })
    }
    if (window.google?.accounts?.id) render()
    else loadGoogleIdentity().then(render)
    return () => {
      cancelled = true
    }
  }, [open, clientId, onSignedIn, onClose])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && step !== 'verifying') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, step, onClose])

  if (!open) return null

  return (
    <AnimatePresence>
      <motion.div
        className="polaris-modal-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={() => step !== 'verifying' && onClose()}
      >
        <motion.div
          className="polaris-modal-card"
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Sign in to Polaris"
        >
          <button
            type="button"
            onClick={onClose}
            disabled={step === 'verifying'}
            aria-label="Close sign-in"
            className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-text4 transition hover:bg-surface-blue hover:text-text disabled:opacity-40"
          >
            ×
          </button>

          {step === 'pick' && (
            <div className="flex flex-col items-center text-center">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-blue">Sign in</span>
              <h2 className="mt-3 font-display text-2xl font-medium tracking-tight text-text">
                Sign in to Polaris
              </h2>
              <p className="mt-2 max-w-[34ch] text-sm leading-relaxed text-text3">
                Use your Google account. We verify it once, issue your API key, and never see Google again.
              </p>
              <div className="mt-7 flex min-h-[52px] items-center justify-center">
                <div ref={btnRef} className="gis-wrap" aria-label="Sign in with Google" />
              </div>
              <p className="mt-5 font-mono text-[11px] text-text4">
                By signing in you accept our terms. New accounts start with $3.00 in credits.
              </p>
            </div>
          )}

          {step === 'verifying' && (
            <div className="flex flex-col items-center text-center">
              <div className="polaris-spinner" role="status" aria-live="polite" />
              <h2 className="mt-6 font-display text-xl font-medium tracking-tight text-text">
                Signing you in
              </h2>
              <motion.p
                key={hint}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="mt-2 font-mono text-[12px] tracking-wide text-blue"
              >
                {hint}
              </motion.p>
              <p className="mt-5 max-w-[34ch] text-xs leading-relaxed text-text4">
                Hang tight — this usually takes a second.
              </p>
            </div>
          )}

          {step === 'error' && (
            <div className="flex flex-col items-center text-center">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-text4">Sign-in failed</span>
              <h2 className="mt-3 font-display text-xl font-medium tracking-tight text-text">
                We couldn’t sign you in
              </h2>
              <p className="mt-2 max-w-[36ch] text-sm leading-relaxed text-text3">{error}</p>
              <button
                type="button"
                onClick={() => setStep('pick')}
                className="btn-sheen mt-7 inline-flex h-10 items-center rounded-[10px] bg-blue px-5 text-xs font-bold text-white shadow-sm transition hover:-translate-y-0.5"
              >
                Try again
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

/*  Rotating hero feature text  */

const HERO_FEATURES = [
  'Read the paper. Trace the evidence.',
  'Plan the build. Run the proof.',
  'Reproduce falsified benchmarks.',
  'From arXiv link to running code.',
  'Every claim gets a witness.',
]

function RotatingHero() {
  const reduce = useReducedMotion()
  const [i, setI] = useState(0)
  useEffect(() => {
    if (reduce) return
    const t = setInterval(() => setI((v) => (v + 1) % HERO_FEATURES.length), 2800)
    return () => clearInterval(t)
  }, [reduce])
  return (
    <div className="relative h-7 overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.p
          key={i}
          className="font-mono text-[13px] font-medium tracking-[0.12em] text-blue uppercase"
          initial={reduce ? false : { y: 18, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduce ? undefined : { y: -18, opacity: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          {HERO_FEATURES[i]}
        </motion.p>
      </AnimatePresence>
    </div>
  )
}

/*  Agents  */

const agents = [
  {
    label: 'READ',
    title: 'Understand the paper',
    features: ['Claim extraction', 'Method parsing', 'Baseline tables', 'Citation graph'],
    log: [
      '[READ] arXiv:2403.12345 → parsing PDF…',
      '[READ] 6 claims, 3 baselines, 2 ablations.',
      '[READ] Citation graph built (14 refs).',
    ],
  },
  {
    label: 'RESEARCH',
    title: 'Trace the evidence',
    features: ['Citation retracing', 'Context reconstruction', 'Numbers cross-check', 'Red flags flagged'],
    log: [
      '[RESEARCH] Retracing 14 citations…',
      '[RESEARCH] ⚠ Table 3 reproduces only within ±0.4%.',
      '[RESEARCH] Context reconstructed.',
    ],
  },
  {
    label: 'PLAN',
    title: 'Make it buildable',
    features: ['Module blueprint', 'Test scaffold', 'Risk review', 'Approve / reject'],
    log: [
      '[PLAN] Drafting build plan: 4 modules, 12 tests.',
      '[PLAN] Awaiting user approval…',
      '[PLAN] Plan approved. Handing to CODE.',
    ],
  },
  {
    label: 'CODE',
    title: 'Run the proof',
    features: ['Sandbox spin-up', 'Dep install', 'pytest run', 'Reproduction verified'],
    log: [
      '[CODE] Spinning up sandbox → installing deps…',
      '[CODE] pytest 11/12 passed.',
      '[CODE] ✓ Reproduction verified.',
    ],
  },
]

function AgentMarquee({ active, onHover }: { active: number; onHover: (i: number) => void }) {
  const loop = [...agents, ...agents]
  return (
    <div className="relative overflow-hidden">
      <div className="marquee gap-4">
        {loop.map((agent, idx) => {
          const i = idx % agents.length
          const isActive = i === active
          return (
            <div
              key={idx}
              onMouseEnter={() => onHover(i)}
              className={[
                'card-shine w-[260px] shrink-0 cursor-pointer rounded-2xl border bg-white p-6 transition-colors duration-300',
                isActive ? 'border-blue' : 'border-border',
              ].join(' ')}
            >
              <span className="font-mono text-[11px] text-text4">0{i + 1}</span>
              <p className="mt-3 font-mono text-[11px] font-medium tracking-[0.14em] text-blue">{agent.label}</p>
              <h3 className="mt-1.5 font-display text-base font-medium tracking-tight text-text">{agent.title}</h3>
              <ul className="mt-3 flex flex-col gap-1.5">
                {agent.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-[12.5px] text-text3">
                    <span className="h-1 w-1 shrink-0 rounded-full bg-blue" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-white to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-white to-transparent" />
    </div>
  )
}

function Terminal({ agent }: { agent: (typeof agents)[number] }) {
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(() => (reduce ? agent.log.join('\n') : ''))
  useEffect(() => {
    if (reduce) return
    let lineI = 0
    let charIdx = 0
    let typing = true
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      if (!typing) return
      const current = agent.log[lineI]
      if (!current) {
        timer = setTimeout(() => {
          lineI = 0
          charIdx = 0
          setShown('')
          typing = true
          tick()
        }, 2600)
        return
      }
      charIdx += 1
      const acc = agent.log.slice(0, lineI).concat(current.slice(0, charIdx)).join('\n')
      setShown(acc)
      if (charIdx >= current.length) {
        typing = false
        timer = setTimeout(() => {
          lineI += 1
          charIdx = 0
          typing = true
          tick()
        }, 460)
      } else {
        timer = setTimeout(tick, 22 + Math.random() * 24)
      }
    }
    tick()
    return () => clearTimeout(timer)
  }, [agent, reduce])
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-[#13191F] shadow-[0_25px_80px_rgba(11,16,21,0.22)]">
      <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <span className="ml-2 font-mono text-[11px] text-white/40">
          polaris — {agent.label.toLowerCase()} session
        </span>
      </div>
      <pre className="min-h-[230px] px-5 py-4 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-[#FAF7F2]">
        {shown}
        <motion.span aria-hidden animate={{ opacity: [1, 0] }} transition={{ duration: 0.6, repeat: Infinity }} className="text-blue-soft">
          ▋
        </motion.span>
      </pre>
    </div>
  )
}

/*  Razorpay checkout  */

function loadRazorpay(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true)
  return new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.onload = () => resolve(true)
    script.onerror = () => resolve(false)
    document.body.appendChild(script)
  })
}

async function startCheckout(plan: PlanId, onError: (msg: string) => void) {
  const ready = await loadRazorpay()
  if (!ready || !window.Razorpay) {
    onError('Payment gateway failed to load. Try again.')
    return
  }
  const keyFallback = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID
  let order: {
    order_id: string
    amount: number
    currency: string
    plan: string
    key_id?: string
    name?: string
    description?: string
  }
  try {
    const res = await fetch('/billing/checkout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    })
    if (!res.ok) {
      let detail = 'Checkout failed.'
      try {
        const err = await res.json()
        detail = err.detail || detail
      } catch {
        /* ignore */
      }
      onError(typeof detail === 'string' ? detail : 'Checkout failed.')
      return
    }
    order = await res.json()
  } catch {
    onError('Could not reach billing. Is the API up?')
    return
  }
  const key = order.key_id || keyFallback
  if (!key) {
    onError('Razorpay key missing.')
    return
  }
  const rzp = new window.Razorpay({
    key,
    amount: order.amount,
    currency: order.currency,
    name: order.name || 'Polaris AI',
    description: order.description || `Polaris ${plan}`,
    order_id: order.order_id,
    theme: { color: '#0562EF' },
    notes: { plan, job_uuid: '' },
    prefill: { name: 'Polaris researcher' },
    handler: async (response: unknown) => {
      const r = response as {
        razorpay_order_id: string
        razorpay_payment_id: string
        razorpay_signature: string
      }
      try {
        const verify = await fetch('/billing/verify', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order_id: r.razorpay_order_id,
            payment_id: r.razorpay_payment_id,
            razorpay_signature: r.razorpay_signature,
            plan,
          }),
        })
        if (!verify.ok) {
          onError('Payment received but verification failed. Contact support.')
          return
        }
        onError('')
        window.alert('Payment successful. Your credits have been added.')
      } catch {
        onError('Payment verification failed. Contact support with your receipt.')
      }
    },
  })
  rzp.on('payment.failed', () => onError('Payment failed. Try another method.'))
  rzp.open()
}

/*  Header  */

function Header({
  authed,
  email,
  onSignIn,
  onSignOut,
}: {
  authed: boolean
  email: string | null
  onSignIn: () => void
  onSignOut: () => void
}) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <motion.header
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className={[
        'fixed top-4 left-1/2 z-50 flex w-[min(1200px,calc(100%-2rem))] -translate-x-1/2 items-center justify-between rounded-2xl border px-6 transition-colors duration-300',
        scrolled
          ? 'border-border-strong bg-white/85 py-3 shadow-md backdrop-blur-xl'
          : 'border-transparent bg-transparent py-5',
      ].join(' ')}
    >
      <a href="/" className="logo-sheen inline-flex items-center gap-2.5 font-display text-lg font-semibold tracking-tight text-text">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" className="h-6 w-6 rounded-md" />
        <span>Polaris</span>
      </a>
      <nav className="hidden items-center gap-7 text-sm font-medium text-text3 sm:flex">
        <a href="#how" className="transition hover:text-blue">How it works</a>
        <a href="#pricing" className="transition hover:text-blue">Pricing</a>
      </nav>
      <div className="flex items-center gap-3">
        {authed ? (
          <div className="flex items-center gap-3">
            <a
              href="/account"
              className="hidden max-w-[18ch] truncate font-mono text-[11px] text-text3 transition hover:text-blue sm:inline"
            >
              {email}
            </a>
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex h-9 items-center rounded-[10px] border border-border-strong bg-white px-3 text-xs font-bold text-text3 transition hover:border-blue hover:text-text"
            >
              Sign out
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onSignIn}
            className="btn-sheen inline-flex h-9 items-center rounded-[10px] bg-blue px-4 text-xs font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(5,98,239,0.28)]"
          >
            Sign in
          </button>
        )}
        <a
          href="#pricing"
          className="btn-sheen hidden h-10 items-center rounded-[10px] bg-blue px-4 text-xs font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(5,98,239,0.28)] sm:inline-flex"
        >
          Get started
        </a>
      </div>
    </motion.header>
  )
}

/*  Pricing  */

const plans: {
  id: PlanId
  name: string
  badge?: string
  price: string
  was?: string
  cadence: string
  blurb: string
  features: string[]
  cta: string
  featured?: boolean
}[] = [
  {
    id: 'starter',
    name: 'Starter',
    badge: 'Early bird',
    price: '$5',
    cadence: '/ month',
    blurb: '10M tokens / month (~$0.05 per 100k input + output). Plenty for your first weekly reproductions.',
    features: ['~10M tokens / mo', 'READ → CODE pipeline', 'Plan approve / reject', 'Sandbox file review'],
    cta: 'Claim early bird',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$20',
    cadence: '/ month',
    blurb: '40M tokens / month for researchers who implement papers every week and need real throughput.',
    features: ['~40M tokens / mo', 'Priority queue', 'Plan approve / reject', 'Sandbox file review'],
    cta: 'Go Pro',
    featured: true,
  },
  {
    id: 'lab',
    name: 'Lab',
    price: '$200',
    cadence: '/ month',
    blurb: '400M tokens / month for whole labs — run, customize, and train on full paper sets.',
    features: ['~400M tokens / mo', 'Highest priority GPU queue', 'Team-ready throughput', 'Unlimited customisations'],
    cta: 'Scale the lab',
  },
]

/*  Landing  */

function SectionCTA({ href, onClick, children, primary = true, type = 'link' }: {
  href?: string
  onClick?: () => void
  children: ReactNode
  primary?: boolean
  type?: 'link' | 'button'
}) {
  const cls = primary
    ? 'btn-sheen inline-flex h-12 items-center rounded-xl bg-blue px-5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(5,98,239,0.3)]'
    : 'inline-flex h-11 items-center rounded-xl border border-border-strong bg-white px-4 text-sm font-bold text-text3 transition hover:border-blue hover:bg-surface-blue hover:text-text'
  return type === 'link' ? (
    <a href={href} className={cls}>{children}</a>
  ) : (
    <button type="button" onClick={onClick} className={cls}>{children}</button>
  )
}

export function Landing({ authed, email }: { authed: boolean; email: string | null }) {
  const [payError, setPayError] = useState('')
  const [paying, setPaying] = useState<PlanId | null>(null)
  const [activeAgent, setActiveAgent] = useState(0)
  const [signInOpen, setSignInOpen] = useState(false)
  const [authedState, setAuthed] = useState(authed)
  const [emailState, setEmail] = useState(email)

  useEffect(() => {
    setAuthed(authed)
    setEmail(email)
  }, [authed, email])

  useEffect(() => {
    const t = setInterval(() => setActiveAgent((v) => (v + 1) % agents.length), 5200)
    return () => clearInterval(t)
  }, [])

  const onSignedIn = useCallback((signedInEmail: string) => {
    setAuthed(true)
    setEmail(signedInEmail)
    setSignInOpen(false)
  }, [])

  const onSignOut = useCallback(async () => {
    try {
      await fetch('/api/auth/signout', { method: 'POST' })
    } catch {
      /* ignore */
    }
    setAuthed(false)
    setEmail(null)
  }, [])

  const onPay = useCallback(async (plan: PlanId) => {
    setPayError('')
    setPaying(plan)
    try {
      await startCheckout(plan, (msg) => {
        if (msg) setPayError(msg)
      })
    } finally {
      setPaying(null)
    }
  }, [])

  return (
    <div className="relative overflow-x-clip bg-bg text-text">
      <Header authed={authedState} email={emailState} onSignIn={() => setSignInOpen(true)} onSignOut={onSignOut} />
      <ScrollLine />
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} onSignedIn={onSignedIn} />

      <section className="relative z-10 flex min-h-screen flex-col items-start justify-center bg-bg px-6 pt-28 pb-20">
        <div className="relative z-20 mx-auto w-full max-w-[1120px]">
          <Reveal>
            <RotatingHero />
            <h1 className="mt-6 max-w-[18ch] font-display text-[clamp(2.75rem,6.5vw,5.4rem)] leading-[0.94] font-medium tracking-[-0.04em] text-text">
              Never feel lost in a paper <em className="not-italic text-blue">ever again.</em>
            </h1>
            <p className="mt-7 max-w-[34rem] text-lg leading-relaxed text-text3">
              Polaris reads the paper, traces the evidence, plans the build, and writes the code —
              every paper you open becomes something you can run.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              {!authedState ? (
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setSignInOpen(true)}
                    className="btn-sheen inline-flex h-12 items-center gap-2 rounded-xl bg-blue px-5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(5,98,239,0.3)]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.17-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.79 2.71v2.26h2.9a8.77 8.77 0 0 0 2.69-6.62z"/>
                      <path fill="#34A853" d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.9-2.26c-.8.54-1.83.86-3.06.86-2.35 0-4.34-1.59-5.05-3.73H.96v2.32A9 9 0 0 0 9 18z"/>
                      <path fill="#FBBC05" d="M3.95 10.69A5.4 5.4 0 0 1 3.65 9c0-.59.1-1.16.3-1.69V4.99H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.01l2.99-2.32z"/>
                      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A8.99 8.99 0 0 0 .96 4.99l2.99 2.32C4.66 5.17 6.65 3.58 9 3.58z"/>
                    </svg>
                    Sign in with Google
                  </button>
                  <SectionCTA href="#pricing" primary={false}>See pricing</SectionCTA>
                </div>
              ) : (
                <>
                  <SectionCTA href="/account">View account</SectionCTA>
                  <SectionCTA href="#how" primary={false}>See how it works</SectionCTA>
                </>
              )}
            </div>
          </Reveal>
        </div>
      </section>

      <section id="how" className="relative z-10 flex min-h-screen flex-col justify-center bg-surface-alt px-6 py-28">
        <div className="relative z-20 mx-auto w-full max-w-[1200px]">
          <Reveal>
            <p className="mb-4 font-mono text-[11px] font-medium tracking-[0.16em] text-blue uppercase">
              One paper. Four moves.
            </p>
            <h2 className="max-w-[16ch] font-display text-[clamp(2rem,4.5vw,3.5rem)] leading-[1.02] font-medium tracking-[-0.03em]">
              From “I should read this” <span className="text-text3">to “it actually works.”</span>
            </h2>
          </Reveal>
          <div className="mt-14 grid gap-10 lg:grid-cols-[1.5fr_1fr] lg:items-start">
            <div>
              <AgentMarquee active={activeAgent} onHover={setActiveAgent} />
              <p className="mt-6 text-[14px] leading-relaxed text-text3">
                Hover any card to see that agent go to work in the terminal.
              </p>
              <div className="mt-10">
                <SectionCTA href="#pricing">Start a paper session</SectionCTA>
              </div>
            </div>
            <div className="lg:sticky lg:top-28">
              <Terminal agent={agents[activeAgent]} />
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="relative z-10 flex min-h-screen flex-col justify-center bg-surface-blue px-6 py-28">
        <div className="relative z-20 mx-auto w-full max-w-[1200px]">
          <Reveal>
            <p className="mb-4 font-mono text-[11px] font-medium tracking-[0.16em] text-blue uppercase">
              Pricing
            </p>
            <h2 className="max-w-[16ch] font-display text-[clamp(2rem,4.5vw,3.5rem)] leading-[1.02] font-medium tracking-[-0.03em]">
              Pay for proof, <span className="text-text3">not promises.</span>
            </h2>
            <p className="mt-5 max-w-[34rem] text-[15px] leading-relaxed text-text3">
              Credits are USD. Every 100k tokens (input + output) costs $0.05 — deducted on run completion.
              Subscribe monthly, reuse the balance for any agent.
            </p>
          </Reveal>
          {payError ? (
            <p className="relative z-20 mt-6 rounded-xl border border-amber/40 bg-white px-4 py-3 text-sm text-navy">
              {payError}
            </p>
          ) : null}
          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            {plans.map((plan) => (
              <motion.article
                key={plan.id}
                className={[
                  'card-shine relative flex flex-col rounded-2xl border bg-white p-7',
                  plan.featured ? 'border-blue shadow-md ring-1 ring-blue/20' : 'border-border',
                ].join(' ')}
                whileHover={{ y: -10, borderColor: 'rgba(5,98,239,0.35)' }}
                transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.08 }}
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-display text-xl font-medium tracking-tight text-text">{plan.name}</h3>
                  {plan.badge ? (
                    <span className="rounded-full bg-blue/10 px-2.5 py-1 font-mono text-[10px] font-medium tracking-wide text-blue uppercase">
                      {plan.badge}
                    </span>
                  ) : null}
                </div>
                <div className="mt-5 flex items-end gap-2">
                  <span className="font-display text-4xl font-semibold tracking-tight text-text">{plan.price}</span>
                  {plan.was ? <span className="mb-1 text-sm text-text4 line-through">{plan.was}</span> : null}
                  <span className="mb-1 text-sm text-text3">{plan.cadence}</span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-text3">{plan.blurb}</p>
                <ul className="mt-6 flex flex-1 flex-col gap-2.5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-text">
                      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-blue/10 text-[10px] font-bold text-blue">
                        ✓
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
                <motion.button
                  type="button"
                  disabled={paying === plan.id}
                  onClick={() => onPay(plan.id)}
                  whileHover={{ y: -2 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 18, delay: 0.06 }}
                  className={[
                    'btn-sheen mt-8 inline-flex h-11 items-center justify-center rounded-xl px-4 text-sm font-bold transition',
                    plan.featured
                      ? 'bg-blue text-white shadow-sm'
                      : 'border border-border-strong bg-white text-text hover:bg-surface-blue',
                    paying === plan.id ? 'opacity-60' : '',
                  ].join(' ')}
                >
                  {paying === plan.id ? 'Opening checkout…' : plan.cta}
                </motion.button>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <footer className="relative z-10 border-t border-border bg-bg px-6 py-24">
        <div className="relative z-20 mx-auto flex w-full max-w-[1200px] flex-col items-center gap-10">
          <PolarisWordmark />
          <div className="flex flex-wrap items-center justify-center gap-8 font-mono text-xs text-text3">
            <a href="https://github.com" className="transition hover:text-blue" target="_blank" rel="noreferrer">GitHub</a>
            <a href="https://twitter.com" className="transition hover:text-blue" target="_blank" rel="noreferrer">Twitter</a>
            <a href="https://linkedin.com" className="transition hover:text-blue" target="_blank" rel="noreferrer">LinkedIn</a>
          </div>
          <span className="font-mono text-xs text-text4">© 2026 Polaris AI</span>
        </div>
      </footer>
    </div>
  )
}