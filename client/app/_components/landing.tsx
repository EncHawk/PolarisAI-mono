'use client'

import { motion, AnimatePresence, useReducedMotion, useScroll, useTransform, useMotionValueEvent } from 'motion/react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Header } from './header'
import { Footer } from './footer'
import { SignInOverlay } from './signin-overlay'
import { useGoogleSignIn } from './google-signin'
import { useToast } from './toast'

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void
      on: (event: string, handler: (response: unknown) => void) => void
    }
  }
}

type PlanId = 'starter' | 'pro' | 'lab'

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

/* Scroll-drawn line */
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



/* Rotating hero feature text */
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

/* Agents */
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

function AgentCard({ agent, index }: { agent: (typeof agents)[number]; index: number }) {
  return (
    <div className="card-shine flex h-full flex-col justify-between rounded-3xl border border-border bg-white p-10">
      <div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-sm text-text4">0{index + 1} / 04</span>
          <span className="h-px flex-1 bg-border" />
          <span className="font-mono text-sm font-medium tracking-[0.14em] text-blue">{agent.label}</span>
        </div>
        <h3 className="mt-8 font-display text-3xl font-medium tracking-tight text-text">{agent.title}</h3>
        <ul className="mt-8 flex flex-col gap-3">
          {agent.features.map((f) => (
            <li key={f} className="flex items-center gap-3 text-base text-text3">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue" />
              {f}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-8 flex items-center justify-between">
        <span className="font-mono text-xs text-text4">
          {index < 3 ? 'Scroll to continue →' : 'Done — keep scrolling for pricing'}
        </span>
        <span className="font-mono text-xs text-blue">{agent.label}</span>
      </div>
    </div>
  )
}

function HowSection() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: scrollRef, offset: ['start start', 'end end'] })
  const [activeIdx, setActiveIdx] = useState(0)

  const cardY = useTransform(scrollYProgress, [0, 1], ['0%', '-75%'])
  const progressWidth = useTransform(scrollYProgress, [0, 1], ['0%', '100%'])

  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    setActiveIdx(Math.min(agents.length - 1, Math.floor(v * agents.length)))
  })

  return (
    <section
      id="how"
      className="relative rounded-t-[2.5rem]"
      style={{
        background:
          'radial-gradient(ellipse 100% 80% at 10% 20%, rgba(5,98,239,0.18) 0%, transparent 50%), radial-gradient(ellipse 90% 70% at 90% 30%, rgba(245,166,35,0.14) 0%, transparent 50%), radial-gradient(ellipse 80% 60% at 50% 80%, rgba(40,200,64,0.12) 0%, transparent 50%), #fafafa',
      }}
    >
      <div className="px-6 pt-28 pb-16">
        <div className="mx-auto w-full max-w-[1200px]">
          <Reveal>
            <p className="mb-4 font-mono text-[11px] font-medium tracking-[0.16em] text-blue uppercase">
              One paper. Four moves.
            </p>
            <h2 className="max-w-[16ch] font-display text-[clamp(2rem,4.5vw,3.5rem)] leading-[1.02] font-medium tracking-[-0.03em]">
              From &ldquo;I should read this&rdquo; <span className="text-text3">to &ldquo;it actually works.&rdquo;</span>
            </h2>
            <p className="mt-5 max-w-[34rem] text-[15px] leading-relaxed text-text3">
              Scroll through each agent to see what it does. The terminal on the right shows live output
              for the agent you&rsquo;re viewing.
            </p>
          </Reveal>
        </div>
      </div>

      <div ref={scrollRef} className="relative h-[400vh]">
        <div className="sticky top-0 flex h-screen items-center overflow-hidden">
          <div className="mx-auto w-full max-w-[1200px] px-6">
            <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr] lg:items-center">
              <div className="relative h-[460px] overflow-hidden rounded-3xl bg-white/40 backdrop-blur-sm ring-1 ring-white/50">
                <motion.div style={{ y: cardY }} className="flex flex-col">
                  {agents.map((agent, i) => (
                    <div key={agent.label} className="h-[460px] shrink-0 p-1">
                      <AgentCard agent={agent} index={i} />
                    </div>
                  ))}
                </motion.div>
                <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-white/60 to-transparent" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white/60 to-transparent" />
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text4">
                    Agent {activeIdx + 1} of 4
                  </span>
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-border">
                    <motion.div style={{ width: progressWidth }} className="h-full rounded-full bg-blue" />
                  </div>
                </div>
                <Terminal agent={agents[activeIdx]} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
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
      <pre className="h-[388px] overflow-y-auto px-5 py-4 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-[#FAF7F2]">
        {shown}
        <motion.span aria-hidden animate={{ opacity: [1, 0] }} transition={{ duration: 0.6, repeat: Infinity }} className="text-blue-soft">
          ▋
        </motion.span>
      </pre>
    </div>
  )
}

/* Razorpay checkout */
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

async function startCheckout(plan: PlanId, onError: (msg: string) => void, onSuccess?: () => void) {
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
        onSuccess?.()
      } catch {
        onError('Payment verification failed. Contact support with your receipt.')
      }
    },
  })
  rzp.on('payment.failed', () => onError('Payment failed. Try another method.'))
  rzp.open()
}

/* Pricing */
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

function SectionCTA({ href, onClick, children, primary = true, type = 'link' }: {
  href?: string
  onClick?: () => void
  children: ReactNode
  primary?: boolean
  type?: 'link' | 'button'
}) {
  const cls = primary
    ? 'btn-sheen inline-flex h-12 items-center rounded-xl bg-blue px-6 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(5,98,239,0.3)]'
    : 'inline-flex h-12 items-center rounded-xl border border-border-strong bg-white px-6 text-sm font-bold text-text3 transition hover:border-blue hover:bg-surface-blue hover:text-text'
  return type === 'link' ? (
    <a href={href} className={cls}>{children}</a>
  ) : (
    <button type="button" onClick={onClick} className={cls}>{children}</button>
  )
}

/* Logout thank-you toast */
function ThanksToast() {
  const [visible, setVisible] = useState(true)
  if (!visible) return null
  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="fixed top-24 left-1/2 z-[60] w-[min(400px,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-border-strong bg-white px-5 py-3 shadow-lg"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-text">Thanks for visiting Polaris. See you soon.</p>
        <button
          type="button"
          onClick={() => setVisible(false)}
          className="grid h-6 w-6 place-items-center rounded-full text-text4 transition hover:bg-surface-blue hover:text-text"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </motion.div>
  )
}

export function Landing({ authed, email, name }: { authed: boolean; email: string | null; name?: string | null }) {
  const searchParams = useSearchParams()
  const showThanks = searchParams.get('thanks') === '1'
  const { toast } = useToast()

  const [payError, setPayError] = useState('')
  const [paying, setPaying] = useState<PlanId | null>(null)
  const [authedState, setAuthed] = useState(authed)
  const [emailState, setEmail] = useState(email)
  const [nameState, setName] = useState(name)

  useEffect(() => {
    setAuthed(authed)
    setEmail(email)
    setName(name)
  }, [authed, email, name])

  const onSignedIn = useCallback((signedInEmail: string) => {
    setAuthed(true)
    setEmail(signedInEmail)
  }, [])

  const { status, error, hint, signIn, retry, dismiss } = useGoogleSignIn(onSignedIn)

  const onSignOut = useCallback(async () => {
    try {
      await fetch('/api/auth/signout', { method: 'POST' })
    } catch {
      /* ignore */
    }
    setAuthed(false)
    setEmail(null)
    setName(null)
  }, [])

  const onPay = useCallback(async (plan: PlanId) => {
    setPayError('')
    setPaying(plan)
    try {
      await startCheckout(plan, (msg) => {
        if (msg) setPayError(msg)
      }, () => toast('Payment successful. Your credits have been added.', 'success'))
    } finally {
      setPaying(null)
    }
  }, [toast])

  return (
    <div className="relative overflow-x-clip bg-bg text-text">
      {showThanks && <ThanksToast />}
      <Header authed={authedState} email={emailState} name={nameState} onSignIn={signIn} />
      <ScrollLine />
      <SignInOverlay status={status} error={error} hint={hint} onRetry={retry} onDismiss={dismiss} />

      <section
        className="relative z-10 flex min-h-screen flex-col items-start justify-center px-6 pt-28 pb-20"
        style={{
          background:
            'radial-gradient(ellipse 90% 70% at 20% 30%, rgba(5,98,239,0.16) 0%, transparent 55%), radial-gradient(ellipse 80% 60% at 80% 80%, rgba(245,166,35,0.14) 0%, transparent 50%), radial-gradient(ellipse 70% 50% at 50% 90%, rgba(40,200,64,0.10) 0%, transparent 50%), #ffffff',
        }}
      >
        <div className="relative z-20 mx-auto w-full max-w-[1120px]">
          <Reveal>
            <RotatingHero />
            <h1 className="mt-6 w-full max-w-[18ch] font-display text-[clamp(2rem,7vw,5.4rem)] leading-[0.98] font-medium tracking-[-0.03em] text-text sm:leading-[0.94] sm:tracking-[-0.04em]">
              Never feel lost in a paper <em className="not-italic text-blue">ever again.</em>
            </h1>
            <p className="mt-7 max-w-[34rem] text-base leading-relaxed text-text3 sm:text-lg">
              Polaris reads the paper, traces the evidence, plans the build, and writes the code —
              every paper you open becomes something you can run.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3 sm:gap-4">
              {!authedState ? (
                <SectionCTA onClick={signIn} type="button">Get started</SectionCTA>
              ) : (
                <SectionCTA href="/code">Get started</SectionCTA>
              )}
              <SectionCTA href="/#how" primary={false}>How it works</SectionCTA>
            </div>
          </Reveal>
        </div>
      </section>

      <HowSection />

      <section
        id="pricing"
        className="relative z-10 flex min-h-screen flex-col justify-center px-6 py-28"
        style={{
          background:
            'radial-gradient(ellipse 110% 80% at 20% 20%, rgba(5,98,239,0.18) 0%, transparent 50%), radial-gradient(ellipse 90% 70% at 80% 80%, rgba(245,166,35,0.14) 0%, transparent 50%), radial-gradient(ellipse 80% 60% at 50% 50%, rgba(40,200,64,0.10) 0%, transparent 50%), #f4f8ff',
        }}
      >
        {/* White mask at the bottom of pricing to separate from the rounded footer */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-32"
          style={{
            background: 'linear-gradient(to bottom, transparent 0%, #ffffff 85%)',
          }}
        />
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
                    'btn-sheen mt-8 inline-flex h-12 items-center justify-center rounded-xl px-6 text-sm font-bold transition',
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

      <Footer />
    </div>
  )
}
