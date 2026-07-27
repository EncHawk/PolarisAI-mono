import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'

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

/* ────────────────────────────────────────────────────────────────────── */
/*  Reveal helpers (motion)                                                */
/* ────────────────────────────────────────────────────────────────────── */

function Reveal({
  children,
  className = '',
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
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

/* ────────────────────────────────────────────────────────────────────── */
/*  Scroll-drawn line                                                       */
/* ────────────────────────────────────────────────────────────────────── */

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

/* Footer wordmark — POLARIS traced as SVG text, then filled blue on hover */
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

/* ────────────────────────────────────────────────────────────────────── */
/*  Google OAuth login button                                               */
/* ────────────────────────────────────────────────────────────────────── */

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

function useAuth() {
  const [authed, setAuthed] = useState(false)
  const [email, setEmail] = useState('')
  const [loaded, setLoaded] = useState(false)

  // Probe the httpOnly session cookie via /auth/me — no JS token touching.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/auth/me', { credentials: 'include' })
        if (cancelled) return
        if (r.ok) {
          const u = (await r.json()) as { email: string }
          setEmail(u.email)
          setAuthed(true)
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const signIn = useCallback((userEmail: string) => {
    setEmail(userEmail)
    setAuthed(true)
  }, [])

  const signOut = useCallback(async () => {
    setEmail('')
    setAuthed(false)
    try {
      await fetch('/auth/logout', { method: 'POST', credentials: 'include' })
    } catch {
      /* ignore */
    }
  }, [])

  return { authed, email, loaded, signIn, signOut }
}

function GoogleLoginButton({ onSignIn }: { onSignIn: (email: string) => void }) {
  const btnRef = useRef<HTMLDivElement | null>(null)
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

  useEffect(() => {
    if (!clientId) return
    let cancelled = false

    const render = () => {
      if (cancelled || !window.google?.accounts?.id || !btnRef.current) return
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (resp: { credential?: string }) => {
          const idToken = resp.credential
          if (!idToken) return
          try {
            const r = await fetch('/auth/google', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id_token: idToken }),
            })
            if (!r.ok) return
            const data = (await r.json()) as { email: string }
            // Backend set the httpOnly session cookie; just refresh UI state.
            onSignIn(data.email)
          } catch {
            /* ignore */
          }
        },
      })
      window.google.accounts.id.renderButton(btnRef.current, {
        type: 'standard',
        size: 'medium',
        text: 'signin_with',
        shape: 'pill',
        theme: 'outline',
        width: 150,
      })
    }

    if (window.google?.accounts?.id) render()
    else loadGoogleIdentity().then(render)

    return () => {
      cancelled = true
    }
  }, [clientId, onSignIn])

  if (!clientId) return null
  return <div ref={btnRef} className="gis-wrap" aria-label="Sign in with Google" />
}

/* ────────────────────────────────────────────────────────────────────── */
/*  Rotating hero feature text                                              */
/* ────────────────────────────────────────────────────────────────────── */

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

/* ────────────────────────────────────────────────────────────────────── */
/*  Agents — data, infinite marquee, sticky terminal                         */
/* ────────────────────────────────────────────────────────────────────── */

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

function AgentMarquee({
  active,
  onHover,
}: {
  active: number
  onHover: (i: number) => void
}) {
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
              <p className="mt-3 font-mono text-[11px] font-medium tracking-[0.14em] text-blue">
                {agent.label}
              </p>
              <h3 className="mt-1.5 font-display text-base font-medium tracking-tight text-text">
                {agent.title}
              </h3>
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
  const [shown, setShown] = useState(() =>
    reduce ? agent.log.join('\n') : '',
  )

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
      const acc = agent.log
        .slice(0, lineI)
        .concat(current.slice(0, charIdx))
        .join('\n')
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
        <motion.span
          aria-hidden
          animate={{ opacity: [1, 0] }}
          transition={{ duration: 0.6, repeat: Infinity }}
          className="text-blue-soft"
        >
          ▋
        </motion.span>
      </pre>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────── */
/*  Razorpay checkout                                                       */
/* ────────────────────────────────────────────────────────────────────── */

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

  const keyFallback = import.meta.env.VITE_RAZORPAY_KEY_ID as string | undefined
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
        window.alert('Payment successful. Welcome to Polaris.')
      } catch {
        onError('Payment verification failed. Contact support with your receipt.')
      }
    },
  })

  rzp.on('payment.failed', () => {
    onError('Payment failed. Try another method.')
  })
  rzp.open()
}

/* ────────────────────────────────────────────────────────────────────── */
/*  Header                                                                  */
/* ────────────────────────────────────────────────────────────────────── */

function Header({
  authed,
  email,
  onSignIn,
  onSignOut,
}: {
  authed: boolean
  email: string
  onSignIn: (userEmail: string) => void
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
          ? 'border-border-strong bg-white/85 shadow-md backdrop-blur-xl py-3'
          : 'border-transparent bg-transparent py-5',
      ].join(' ')}
    >
      <a href="/" className="logo-sheen inline-flex items-center gap-2.5 font-display text-lg font-semibold tracking-tight text-text">
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
            <span className="hidden max-w-[18ch] truncate font-mono text-[11px] text-text3 sm:inline">
              {email}
            </span>
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex h-9 items-center rounded-[10px] border border-border-strong bg-white px-3 text-xs font-bold text-text3 transition hover:border-blue hover:text-text"
            >
              Sign out
            </button>
          </div>
        ) : (
          <GoogleLoginButton onSignIn={onSignIn} />
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

/* ────────────────────────────────────────────────────────────────────── */
/*  Pricing                                                                 */
/* ────────────────────────────────────────────────────────────────────── */

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
    price: '$1',
    was: '$5',
    cadence: 'one-time',
    blurb: 'Ship your first three paper implementations without burning a weekend.',
    features: ['3 custom code runs', '0.5× shared GPU', '1 training job', 'READ → CODE pipeline'],
    cta: 'Claim early bird',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$20',
    cadence: '/ month',
    blurb: 'For researchers who implement papers every week and need real GPU time.',
    features: ['8 custom repos / mo', '1× full GPU access', 'Plan approve / reject', 'Sandbox file review'],
    cta: 'Go Pro',
    featured: true,
  },
  {
    id: 'lab',
    name: 'Lab',
    price: '$200',
    cadence: 'one-time',
    blurb: 'Train models, customize generated code, and grab coffee while we handle the rest.',
    features: ['Unlimited customisations', 'Up to 4× priority GPUs', 'Priority queue', 'Team-ready throughput'],
    cta: 'Scale the lab',
  },
]

/* ────────────────────────────────────────────────────────────────────── */
/*  App                                                                     */
/* ────────────────────────────────────────────────────────────────────── */

function SectionCTA({
  href,
  onClick,
  children,
  primary = true,
  type = 'link',
}: {
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
    <a href={href} className={cls}>
      {children}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  )
}

export default function App() {
  const [payError, setPayError] = useState('')
  const [paying, setPaying] = useState<PlanId | null>(null)
  const [activeAgent, setActiveAgent] = useState(0)
  const { authed, email, signIn, signOut } = useAuth()

  // Auto-cycle the active agent so the terminal keeps telling each story
  useEffect(() => {
    const t = setInterval(() => setActiveAgent((v) => (v + 1) % agents.length), 5200)
    return () => clearInterval(t)
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
      <Header authed={authed} email={email} onSignIn={signIn} onSignOut={signOut} />
      <ScrollLine />

      {/* Hero — full screen + rotating feature text */}
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
              <SectionCTA href="#pricing">Start for $1</SectionCTA>
              <SectionCTA href="#how" primary={false}>
                See how it works
              </SectionCTA>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Agents — full screen, infinite marquee + sticky terminal */}
      <section
        id="how"
        className="relative z-10 flex min-h-screen flex-col justify-center bg-surface-alt px-6 py-28"
      >
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

            {/* Sticky terminal — stays fixed within this section, leaves with it */}
            <div className="lg:sticky lg:top-28">
              <Terminal agent={agents[activeAgent]} />
            </div>
          </div>
        </div>
      </section>

      {/* Pricing — full screen */}
      <section
        id="pricing"
        className="relative z-10 flex min-h-screen flex-col justify-center bg-surface-blue px-6 py-28"
      >
        <div className="relative z-20 mx-auto w-full max-w-[1200px]">
          <Reveal>
            <p className="mb-4 font-mono text-[11px] font-medium tracking-[0.16em] text-blue uppercase">
              Pricing
            </p>
            <h2 className="max-w-[16ch] font-display text-[clamp(2rem,4.5vw,3.5rem)] leading-[1.02] font-medium tracking-[-0.03em]">
              Pay for proof, <span className="text-text3">not promises.</span>
            </h2>
            <p className="mt-5 max-w-[34rem] text-[15px] leading-relaxed text-text3">
              Early bird is live. Start tiny, upgrade when the lab needs GPUs and unlimited
              customisations.
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

      {/* Footer — drawing logo + glowing POLARIS */}
      <footer className="relative z-10 border-t border-border bg-bg px-6 py-24">
        <div className="relative z-20 mx-auto flex w-full max-w-[1200px] flex-col items-center gap-10">
          <PolarisWordmark />
          <div className="flex flex-wrap items-center justify-center gap-8 font-mono text-xs text-text3">
            <a href="https://github.com" className="transition hover:text-blue" target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href="https://twitter.com" className="transition hover:text-blue" target="_blank" rel="noreferrer">
              Twitter
            </a>
            <a href="https://linkedin.com" className="transition hover:text-blue" target="_blank" rel="noreferrer">
              LinkedIn
            </a>
          </div>
          <span className="font-mono text-xs text-text4">© 2026 Polaris AI</span>
        </div>
      </footer>
    </div>
  )
}