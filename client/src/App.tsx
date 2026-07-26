import { useEffect, useRef, useState } from 'react'
import type { FormEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react'

import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

let _authToken: string | null = null

function _getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

type User = { id?: string; user_id?: string; email: string; name?: string | null; username?: string | null }
type RepoEntry = { name: string; path: string; type: string; html_url?: string }
type IngestResult = {
  job_uuid: string
  paper_id: string
  arxiv_id: string
  repo_name: string
  github_url: string | null
  repo_exists: boolean
  requires_code_choice: boolean
  payment_required: boolean
  payment_status: 'unpaid' | 'pending' | 'paid'
  checkout_url: string | null
  repo_contents: RepoEntry[]
}
type CodeSession = {
  session_id: string
  repo_name: string
  progress: 'failed' | 'completed' | 'in-progress'
  execution_mode: 'create' | 'modify' | 'run' | null
  payment_status: 'unpaid' | 'pending' | 'paid'
  github_url: string | null
  repo_exists: boolean
  repo_contents: RepoEntry[]
}
type TraceEvent = {
  ts?: string
  agent?: string
  kind?: string
  step?: string
  tool?: string
  conclusion?: string
  output_query?: string
}
type Plan = 'starter' | 'pro'
type CheckoutResponse = { order_id: string; amount: number; currency: string; plan: Plan }
type IconName = 'arrow' | 'book' | 'check' | 'chevron' | 'clock' | 'code' | 'file' | 'github' | 'google' | 'grid' | 'lock' | 'menu' | 'paperclip' | 'play' | 'plus' | 'search' | 'send' | 'settings' | 'spark' | 'terminal' | 'x'

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (_authToken) headers['authorization'] = 'Bearer ' + _authToken
  const response = await fetch(API_BASE + path, {
    ...init,
    credentials: 'include',
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined ?? {}) },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.detail ?? 'Request failed (' + response.status + ')')
  return payload as T
}

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  const paths: Record<IconName, ReactNode> = {
    arrow: <><path d="M5 12h13" /><path d="m13 6 6 6-6 6" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" /><path d="M4 5.5v16M8 7h8M8 11h8" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
    code: <><path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14" /></>,
    file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
    github: <><path d="M15 22v-3.9c.04-1.05-.38-1.8-1.1-2.2 3.58-.4 7.33-1.76 7.33-7.9 0-1.75-.62-3.18-1.64-4.3.16-.4.71-2.04-.16-4.24 0 0-1.34-.43-4.4 1.64a15.2 15.2 0 0 0-8.06 0C3.91-.94 2.57-.51 2.57-.51c-.87 2.2-.32 3.84-.16 4.24A6.32 6.32 0 0 0 .77 8c0 6.14 3.75 7.5 7.33 7.9-.71.4-1.13 1.15-1.1 2.2V22" transform="translate(1 .5) scale(.92)" /></>,
    google: <><path d="M21.8 12.23c0-.75-.07-1.47-.2-2.17H12v4.1h5.5a4.7 4.7 0 0 1-2.04 3.08v2.56h3.3c1.93-1.78 3.04-4.4 3.04-7.57Z" fill="currentColor" stroke="none" /><path d="M12 22c2.76 0 5.07-.91 6.76-2.47l-3.3-2.56c-.91.61-2.07.97-3.46.97-2.66 0-4.91-1.8-5.72-4.22H2.87v2.64A10.2 10.2 0 0 0 12 22Z" fill="currentColor" stroke="none" opacity=".7" /><path d="M6.28 13.72a6.1 6.1 0 0 1 0-3.44V7.64H2.87a10.1 10.1 0 0 0 0 8.72l3.41-2.64Z" fill="currentColor" stroke="none" opacity=".5" /><path d="M12 6.06c1.51 0 2.87.52 3.93 1.53l2.95-2.95C17.06 2.99 14.76 2 12 2a10.2 10.2 0 0 0-9.13 5.64l3.41 2.64C7.09 7.86 9.34 6.06 12 6.06Z" fill="currentColor" stroke="none" opacity=".85" /></>,
    grid: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    paperclip: <path d="m20.5 11.5-8.8 8.8a5 5 0 0 1-7.1-7.1l9.2-9.2a3.5 3.5 0 0 1 5 5L9.6 18.2a2 2 0 1 1-2.8-2.8l8.5-8.5" />,
    play: <path d="m9 6 9 6-9 6z" />,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4.5 4.5" /></>,
    send: <><path d="m21 3-7 18-4-8-8-4z" /><path d="M21 3 10 13" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.7 1.7-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.55V20h-2.4v-.09a1.7 1.7 0 0 0-1.04-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06-1.7-1.7.06-.06A1.7 1.7 0 0 0 8.45 15a1.7 1.7 0 0 0-1.55-1.03H6.8v-2.4h.1a1.7 1.7 0 0 0 1.55-1.04 1.7 1.7 0 0 0-.34-1.88l-.06-.06 1.7-1.7.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.04-1.55V5.6h2.4v.1a1.7 1.7 0 0 0 1.03 1.54 1.7 1.7 0 0 0 1.88-.34l.06-.06 1.7 1.7-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.55 1.04h.1v2.4h-.1A1.7 1.7 0 0 0 19.4 15Z" /></>,
    spark: <><path d="m12 3 1.25 5.75L19 10l-5.75 1.25L12 17l-1.25-5.75L5 10l5.75-1.25z" /><path d="m19 16 .55 2.45L22 19l-2.45.55L19 22l-.55-2.45L16 19l2.45-.55z" /></>,
    terminal: <><path d="m5 7 5 5-5 5M12 17h7" /></>,
    x: <><path d="m6 6 12 12M18 6 6 18" /></>,
  }
  return <svg {...common}>{paths[name]}</svg>
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={'logo ' + (compact ? 'logo-compact' : '')}>
      <img src="/logo.png" alt="Polaris" className="logo-img" />
      <span>Polaris AI</span>
    </div>
  )
}

const agentData = [
  { key: 'read', label: 'READ', title: 'Understand the paper', copy: 'Extracts claims, methods, experiments, numbers, and the citations that actually matter.', color: 'blue', icon: 'book' as IconName },
  { key: 'research', label: 'RESEARCH', title: 'Trace the evidence', copy: 'Follows the citations and reconstructs the technical context behind each claim.', color: 'amber', icon: 'search' as IconName },
  { key: 'plan', label: 'PLAN', title: 'Make it buildable', copy: 'Turns the paper into a concrete, reviewable implementation plan before code starts.', color: 'pink', icon: 'grid' as IconName },
  { key: 'code', label: 'CODE', title: 'Run the proof', copy: 'Builds and tests the implementation in an isolated sandbox, with every step visible.', color: 'teal', icon: 'code' as IconName },
]

type TerminalLine = { color: string; text: string }

const terminalScript: TerminalLine[] = [
  { color: 'blue', text: 'read  /  parsing 42 pages of claims' },
  { color: 'muted', text: '→  6 claims · 3 benchmarks extracted' },
  { color: 'amber', text: 'research  /  tracing 8 citations' },
  { color: 'muted', text: '→  2 shaky numbers flagged' },
  { color: 'pink', text: 'plan  /  drafting the build sequence' },
  { color: 'muted', text: '→  14 steps · awaiting your approval' },
  { color: 'teal', text: 'code  /  verifying in the sandbox' },
  { color: 'muted', text: '→  tests passing · numbers reproduced' },
]

function useTypewriter(script: TerminalLine[], visible = 5) {
  const [lineIndex, setLineIndex] = useState(0)
  const [charIndex, setCharIndex] = useState(0)

  useEffect(() => {
    const current = script[lineIndex]
    if (!current) {
      const restart = window.setTimeout(() => { setLineIndex(0); setCharIndex(0) }, 3000)
      return () => window.clearTimeout(restart)
    }
    if (charIndex < current.text.length) {
      const tick = window.setTimeout(() => setCharIndex((value) => value + 1), 26 + Math.random() * 30)
      return () => window.clearTimeout(tick)
    }
    const pause = window.setTimeout(() => { setLineIndex((value) => value + 1); setCharIndex(0) }, current.color === 'muted' ? 420 : 950)
    return () => window.clearTimeout(pause)
  }, [lineIndex, charIndex, script])

  const done = script.slice(0, lineIndex)
  const active = script[lineIndex]
  const lines = active ? [...done, { ...active, text: active.text.slice(0, charIndex) }] : done
  return { lines: lines.slice(-visible), typing: Boolean(active) }
}

function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return undefined
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          node.classList.add('is-visible')
          observer.disconnect()
        }
      })
    }, { threshold: 0.16 })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return <div ref={ref} className={'reveal ' + className} style={delay ? { transitionDelay: delay + 'ms' } : undefined}>{children}</div>
}

const tiltCard = (event: ReactMouseEvent<HTMLElement>) => {
  const card = event.currentTarget
  const rect = card.getBoundingClientRect()
  const px = (event.clientX - rect.left) / rect.width - 0.5
  const py = (event.clientY - rect.top) / rect.height - 0.5
  card.style.setProperty('--tilt-x', (-py * 6).toFixed(2) + 'deg')
  card.style.setProperty('--tilt-y', (px * 8).toFixed(2) + 'deg')
}

const untiltCard = (event: ReactMouseEvent<HTMLElement>) => {
  event.currentTarget.style.setProperty('--tilt-x', '0deg')
  event.currentTarget.style.setProperty('--tilt-y', '0deg')
}

const pricingTiers = [
  {
    name: 'Starter',
    price: '$1',
    strike: '$5',
    cadence: 'one-time · early bird',
    blurb: 'Taste the future for less than a coffee.',
    features: ['3 custom paper implementations', '0.5x shared GPU access', '1 train job', 'Full agent trace visibility'],
    featured: false,
  },
  {
    name: 'Pro',
    price: '$20',
    strike: null as string | null,
    cadence: 'per month',
    blurb: 'For researchers shipping every week.',
    features: ['8 custom repositories', '1x full GPU access', 'Priority sandbox queue', 'Plan approval workflow'],
    featured: true,
  },
  {
    name: 'Unlimited',
    price: '$200',
    strike: null as string | null,
    cadence: 'per month',
    blurb: 'Your whole lab, on autopilot.',
    features: ['Unlimited customisations', 'Up to 4x priority GPUs', 'Bring your own sandbox', 'Early access to new agents'],
    featured: false,
  },
]

function AgentPipeline({ active = 2 }: { active?: number }) {
  return <div className="pipeline" aria-label="Polaris agent pipeline">
    {agentData.map((agent, index) => <div className="pipeline-step" key={agent.key}>
      <div className={'pipeline-node ' + agent.color + (index === active ? ' is-active' : '')}><Icon name={agent.icon} size={17} /></div>
      <span>{agent.label}</span>
      {index < agentData.length - 1 && <div className={'pipeline-line ' + (index < active ? 'is-complete' : '')}><i /></div>}
    </div>)}
  </div>
}

function AuthModal({ mode, setMode, onClose, onAuth }: { mode: 'login' | 'signup'; setMode: (mode: 'login' | 'signup') => void; onClose: () => void; onAuth: (user: User) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [github, setGithub] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [googleMessage, setGoogleMessage] = useState('')

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || document.getElementById('google-identity-script')) return
    const script = document.createElement('script')
    script.id = 'google-identity-script'
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    document.head.appendChild(script)
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const user = await api<User>(mode === 'login' ? '/auth/login' : '/auth/signup', { method: 'POST', body: JSON.stringify(mode === 'login' ? { email, password } : { name, email, password, github: github || null }) })
      onAuth(user)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not authenticate')
    } finally {
      setBusy(false)
    }
  }

  const google = () => {
    if (!GOOGLE_CLIENT_ID) {
      setGoogleMessage('Add VITE_GOOGLE_CLIENT_ID to enable Google sign-in.')
      return
    }
    const googleApi = (window as Window & { google?: { accounts: { id: { initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void; prompt: () => void } } } }).google
    if (!googleApi) {
      setGoogleMessage('Google sign-in is loading. Try again in a moment.')
      return
    }
    googleApi.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: async (response) => {
      try { onAuth(await api<User>('/auth/google', { method: 'POST', body: JSON.stringify({ id_token: response.credential }) })) } catch (err) { setError(err instanceof Error ? err.message : 'Google sign-in failed') }
    } })
    googleApi.accounts.id.prompt()
  }

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-heading">
      <button className="icon-button modal-close" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
      <div className="auth-mark"><Logo compact /></div>
      <p className="eyebrow">YOUR RESEARCH COMPASS</p>
      <h2 id="auth-heading">{mode === 'login' ? 'Welcome back.' : 'Your research north star.'}</h2>
      <p className="auth-subtitle">{mode === 'login' ? 'Pick up where your research left off.' : 'Turn your next paper into something you can run.'}</p>
      <button className="google-button" type="button" onClick={google}><Icon name="google" size={17} /> Continue with Google</button>
      {googleMessage && <p className="form-hint">{googleMessage}</p>}
      <div className="or-divider"><span>or continue with email</span></div>
      <form className="auth-form" onSubmit={submit}>
        {mode === 'signup' && <label>Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ada Lovelace" required /></label>}
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@lab.com" required /></label>
        <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="8+ characters" minLength={8} required /></label>
        {mode === 'signup' && <label>GitHub <span className="label-optional">optional</span><input value={github} onChange={(event) => setGithub(event.target.value)} placeholder="your-handle" /></label>}
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button auth-submit" disabled={busy}>{busy ? 'Opening your workspace…' : mode === 'login' ? 'Sign in' : 'Create workspace'} <Icon name="arrow" size={16} /></button>
      </form>
      <p className="auth-switch">{mode === 'login' ? 'New to Polaris?' : 'Already have an account?'} <button onClick={() => { setError(''); setMode(mode === 'login' ? 'signup' : 'login') }}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button></p>
      <p className="auth-legal"><Icon name="lock" size={12} /> Your papers stay yours. Always.</p>
    </div>
  </div>
}

function Landing({ onStart, onSignIn }: { onStart: () => void; onSignIn: () => void }) {
  const [activeAgent, setActiveAgent] = useState(1)
  const headerRef = useRef<HTMLElement | null>(null)
  const typed = useTypewriter(terminalScript)

  useEffect(() => {
    const onScroll = () => headerRef.current?.classList.toggle('is-scrolled', window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return <div className="landing-page">
    <header className="site-header" ref={headerRef}><Logo /><nav className="desktop-nav"><a href="#how-it-works">How it works</a><a href="#principles">Why Polaris</a><a href="#pricing">Pricing</a></nav><div className="header-actions"><button className="text-button desktop-only" onClick={onSignIn}>Sign in</button><button className="outline-button" onClick={onStart}>Get started <Icon name="arrow" size={15} /></button><button className="icon-button mobile-menu" aria-label="Open menu"><Icon name="menu" size={20} /></button></div></header>
    <main>
      <section className="hero-section page-width">
        <div className="hero-copy">
          <div className="hero-kicker"><span className="live-dot" /> THE NORTH STAR FOR RESEARCH</div>
          <h1>Never feel lost in a paper <em>ever again.</em></h1>
          <p className="hero-lede">A researcher skims hundreds of papers a year and implements almost none of them. Until now. Polaris reads the paper, traces the evidence, plans the build and writes the code — every paper you open becomes something you can run.</p>
          <div className="hero-actions"><button className="primary-button large-button" onClick={onStart}>Bring a paper to life <Icon name="arrow" size={17} /></button><button className="play-button" onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}><span className="play-icon"><Icon name="play" size={13} /></span> See how it works</button></div>
          <div className="hero-note"><span className="avatar-stack"><i /><i /><i /></span><span>Beginners ask questions. Experts vibe-code papers over coffee.</span></div>
        </div>
        <div className="hero-visual">
          <div className="visual-orbit orbit-one" /><div className="visual-orbit orbit-two" />
          <div className="visual-core"><span className="core-star"><Icon name="spark" size={30} /></span><span>POLARIS<br /><small>research engine</small></span></div>
          <div className="orbit-node node-read"><span className="node-dot blue" /><b>READ</b><small>paper map</small></div>
          <div className="orbit-node node-research"><span className="node-dot amber" /><b>RESEARCH</b><small>evidence trail</small></div>
          <div className="orbit-node node-plan"><span className="node-dot pink" /><b>PLAN</b><small>build sequence</small></div>
          <div className="orbit-node node-code"><span className="node-dot teal" /><b>CODE</b><small>proof run</small></div>
          <div className="visual-terminal">
            <div className="terminal-top"><span><i /><i /><i /></span><small>polaris / agent stream</small><Icon name="terminal" size={14} /></div>
            <div className="terminal-lines">{typed.lines.map((line, index) => <p key={index} className={line.color}><span>{index === typed.lines.length - 1 ? '▸' : '·'}</span>{line.text}{index === typed.lines.length - 1 && typed.typing && <i className="typing-caret" />}</p>)}</div>
          </div>
        </div>
      </section>
      <section className="trust-row page-width"><span>From first read to first result</span><div className="trust-line" /><span>Every claim gets a paper trail</span><div className="trust-line" /><span>Your north star for reproducibility</span></section>
      <section className="agents-section page-width" id="how-it-works">
        <Reveal className="section-intro">
          <p className="eyebrow">ONE PAPER. FOUR MOVES.</p>
          <h2>From “I should read this”<br /><span>to “it actually works.”</span></h2>
          <p>Each agent has one job. Together, they turn a PDF into a result you can inspect, challenge, and run yourself.</p>
        </Reveal>
        <Reveal className="agent-cards" delay={120}>
          {agentData.map((agent, index) => <button className={'agent-card shine-card ' + agent.color + (activeAgent === index ? ' selected' : '')} key={agent.key} onMouseEnter={() => setActiveAgent(index)} onFocus={() => setActiveAgent(index)} onMouseMove={tiltCard} onMouseLeave={untiltCard}>
            <div className="agent-card-top"><span className="agent-icon"><Icon name={agent.icon} size={19} /></span><span className="agent-index">0{index + 1}</span></div>
            <p className="agent-label">{agent.label}</p>
            <h3>{agent.title}</h3>
            <p>{agent.copy}</p>
            <span className="agent-arrow"><Icon name="arrow" size={15} /></span>
          </button>)}
        </Reveal>
        <Reveal className="pipeline-wrap" delay={180}>
          <AgentPipeline active={activeAgent} />
          <p>{agentData[activeAgent].title} <span>→</span> {agentData[activeAgent].copy}</p>
        </Reveal>
      </section>
      <section className="principles-section page-width" id="principles">
        <Reveal className="principles-visual">
          <div className="principles-grid" />
          <div className="principle-card"><span className="quote-mark">“</span><p>Numbers deserve a witness.</p><span className="principle-caption">— The Polaris principle</span></div>
        </Reveal>
        <Reveal className="principles-copy" delay={120}>
          <p className="eyebrow">WHY POLARIS</p>
          <h2>Because lying with numbers<br /><span>was never easier.</span></h2>
          <p>New coding models prove themselves on verified benchmarks. Research deserves the same treatment. Polaris interrogates every claim, follows the evidence, and reproduces the result in a sandbox — your north star against falsified numbers.</p>
          <div className="principle-list">
            <div><span className="check-circle"><Icon name="check" size={13} /></span><span><b>See the whole trail</b><small>Every agent step, tool, and conclusion stays visible.</small></span></div>
            <div><span className="check-circle"><Icon name="check" size={13} /></span><span><b>Keep your judgment</b><small>Approve the plan before a single file gets changed.</small></span></div>
            <div><span className="check-circle"><Icon name="check" size={13} /></span><span><b>Run the proof</b><small>Verified numbers in a sandbox, not a hand-wave.</small></span></div>
          </div>
        </Reveal>
      </section>
      <section className="pricing-section page-width" id="pricing">
        <Reveal className="section-intro pricing-intro">
          <p className="eyebrow">EARLY ACCESS PRICING</p>
          <h2>Grab a coffee.<br /><span>We'll build the paper.</span></h2>
          <p>Start for a dollar while we're early. Scale when your reading list does.</p>
        </Reveal>
        <div className="pricing-grid">
          {pricingTiers.map((tier, index) => <Reveal key={tier.name} delay={index * 100}>
            <article className={'pricing-card' + (tier.featured ? ' featured' : '')}>
              {tier.featured && <span className="pricing-badge">MOST POPULAR</span>}
              <h3>{tier.name}</h3>
              <p className="pricing-blurb">{tier.blurb}</p>
              <div className="pricing-price"><span className="pricing-amount">{tier.price}</span>{tier.strike && <span className="pricing-strike">{tier.strike}</span>}<span className="pricing-cadence">{tier.cadence}</span></div>
              <ul>{tier.features.map((feature) => <li key={feature}><span className="check-circle"><Icon name="check" size={12} /></span>{feature}</li>)}</ul>
              <button className={(tier.featured ? 'primary-button' : 'outline-button') + ' pricing-button'} onClick={onStart}>{tier.featured ? 'Start building' : 'Get started'} <Icon name="arrow" size={15} /></button>
            </article>
          </Reveal>)}
        </div>
        <Reveal className="pricing-horizon" delay={200}><span>ON THE HORIZON</span><p>Priority GPU access · customisations on generated code · npm installs for every build</p></Reveal>
      </section>
      <section className="cta-section page-width"><div className="cta-orb" /><p className="eyebrow">THE FIRST STEP IS FREE</p><h2>Bring us the paper<br /><em>you keep meaning to read.</em></h2><p>Start with your next arXiv link. No setup, no lost weekend, no more tabs.</p><button className="primary-button large-button" onClick={onStart}>Start a paper session <Icon name="arrow" size={17} /></button><span className="cta-footnote"><Icon name="lock" size={12} /> Secure by default · Your papers stay yours</span></section>
    </main>
    <footer className="site-footer page-width"><div className="footer-brand"><Logo /><p>A calmer way to build on research.</p></div><div className="footer-links"><div><span>EXPLORE</span><a href="#how-it-works">How it works</a><a href="#principles">Our principles</a><a href="#pricing">Pricing</a></div><div><span>CONNECT</span><a href="https://github.com" target="_blank" rel="noreferrer"><Icon name="github" size={14} /> GitHub</a><a href="https://linkedin.com" target="_blank" rel="noreferrer">LinkedIn</a><a href="https://x.com" target="_blank" rel="noreferrer">X / Twitter</a></div></div><div className="footer-bottom"><span>© 2025 Polaris AI</span><span>Made for better questions.</span></div><div className="footer-wordmark" aria-label="POLARIS">{'POLARIS'.split('').map((letter, index) => <span key={index} style={{ transitionDelay: index * 45 + 'ms' }}>{letter}</span>)}</div></footer>
  </div>
}

function Terminal({ traces, isRunning }: { traces: TraceEvent[]; isRunning: boolean }) {
  const fallback = [{ agent: 'READ', conclusion: 'Mapping the paper into a structured outline' }, { agent: 'RESEARCH', conclusion: 'Following 8 relevant citations' }, { agent: 'PLAN', conclusion: 'Drafting a reproducible implementation' }, { agent: 'CODE', conclusion: 'Sandbox is ready for review' }]
  const lines = traces.length ? traces.slice(-8).map((trace) => ({ agent: trace.agent ?? 'SYSTEM', conclusion: trace.conclusion ?? trace.output_query ?? 'Progress recorded' })) : fallback
  return <div className="workspace-terminal"><div className="workspace-terminal-head"><div><span className="terminal-status" /> LIVE AGENT STREAM</div><span className="terminal-live">{isRunning ? 'RUNNING' : 'READY'}</span></div><div className="workspace-terminal-body">{lines.map((line, index) => <div className="stream-line" key={index}><span className="stream-time">{String(index + 9).padStart(2, '0')}:4{index}</span><span className={'stream-agent ' + (line.agent ?? '').toLowerCase()}>{line.agent}</span><span className="stream-text">{line.conclusion}</span></div>)}{isRunning && <div className="stream-line stream-current"><span className="stream-time">now</span><span className="stream-agent code">CODE</span><span className="stream-text">Running verification suite<span className="typing-caret" /></span></div>}</div></div>
}

function Workspace({ user, onLogout, onBack }: { user: User; onLogout: () => void; onBack: () => void }) {
  const [arxivUrl, setArxivUrl] = useState('')
  const [result, setResult] = useState<IngestResult | null>(null)
  const [session, setSession] = useState<CodeSession | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [traces, setTraces] = useState<TraceEvent[]>([])
  const [chat, setChat] = useState('')
  const [messages, setMessages] = useState([{ from: 'agent', text: 'Hey — I’m ready when you are. Drop in an arXiv link and I’ll start mapping the paper.' }])
  const [mobileNav, setMobileNav] = useState(false)
  const displayName = user.name?.split(' ')[0] ?? user.username?.split(' ')[0] ?? user.email.split('@')[0]
  const activeIndex = result ? (session?.progress === 'completed' ? 3 : session?.execution_mode ? 3 : traces.length > 4 ? 2 : 1) : 0
  const entries = session?.repo_contents ?? result?.repo_contents ?? []

  useEffect(() => {
    if (!import.meta.env.DEV || !result || !_authToken) return undefined
    const events = new EventSource(API_BASE + '/events/' + result.job_uuid, { withCredentials: true })
    events.onmessage = (event) => { try { setTraces((current) => [...current, JSON.parse(event.data) as TraceEvent].slice(-200)) } catch { /* ignore malformed frames */ } }
    events.onerror = () => events.close()
    return () => events.close()
  }, [result])

  const ingest = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true); setError(''); setNotice('')
    try {
      const data = await api<IngestResult>('/ingest', { method: 'POST', body: JSON.stringify({ arxiv_url: arxivUrl }) })
      setTraces([]); setResult(data); setSession(await api<CodeSession>('/code/' + data.job_uuid)); setNotice('Paper indexed. Your research agents are standing by.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not start paper session') } finally { setBusy(false) }
  }
  const choose = async (action: 'modify' | 'run') => {
    if (!result) return
    setBusy(true); setError('')
    try { await api('/code/' + result.job_uuid + '/choice', { method: 'POST', body: JSON.stringify({ action }) }); setNotice('Choice saved. Payment is required before the sandbox can start.'); setSession(await api<CodeSession>('/code/' + result.job_uuid)) } catch (err) { setError(err instanceof Error ? err.message : 'Could not save repository choice') } finally { setBusy(false) }
  }
  const refresh = async () => {
    if (!result) return
    setBusy(true)
    setError('')
    try {
      const order = await api<CheckoutResponse>('/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ plan: 'starter', job_uuid: result.job_uuid }),
      })

      const rzScript = document.getElementById('razorpay-checkout-script')
      if (!rzScript) {
        const script = document.createElement('script')
        script.id = 'razorpay-checkout-script'
        script.src = 'https://checkout.razorpay.com/v1/checkout.js'
        script.async = true
        document.head.appendChild(script)
        await new Promise<void>((resolve, reject) => {
          script.onload = () => resolve()
          script.onerror = () => reject(new Error('Failed to load Razorpay'))
        })
      }

      const keyId = import.meta.env.VITE_RAZORPAY_KEY_ID
      if (!keyId) {
        setError('Add VITE_RAZORPAY_KEY_ID to your .env to enable payments.')
        setBusy(false)
        return
      }

      const razorpay = (window as Window & { Razorpay?: new (opts: unknown) => { open: () => void } }).Razorpay
      if (!razorpay) {
        setError('Razorpay failed to initialise. Try again in a moment.')
        setBusy(false)
        return
      }

      const payment = await new Promise<{ order_id: string; payment_id: string; signature: string } | null>((resolve) => {
        const modal = new razorpay({
          key: keyId,
          amount: order.amount,
          currency: order.currency,
          name: 'Polaris AI',
          description: order.plan === 'starter' ? 'Polaris Starter' : 'Polaris Pro',
          order_id: order.order_id,
          prefill: { email: user?.email, name: user?.name },
          handler: (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
            resolve({ order_id: response.razorpay_order_id, payment_id: response.razorpay_payment_id, signature: response.razorpay_signature })
          },
          modal: {
            ondismiss: () => resolve(null),
          },
        })
        modal.open()
      })

      if (!payment) {
        setError('Payment was cancelled.')
        setBusy(false)
        return
      }

      await api('/billing/verify', {
        method: 'POST',
        body: JSON.stringify({
          order_id: payment.order_id,
          payment_id: payment.payment_id,
          razorpay_signature: payment.signature,
          plan: order.plan,
          job_uuid: result.job_uuid,
        }),
      })

      setSession(await api<CodeSession>('/code/' + result.job_uuid))
      setNotice('Payment confirmed. Your sandbox is ready.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  const payDev = async () => { if (!result) return; setBusy(true); try { await api('/code/' + result.job_uuid + '/pay-dev', { method: 'POST' }); setSession(await api<CodeSession>('/code/' + result.job_uuid)); setNotice('Development payment bypass applied.') } catch (err) { setError(err instanceof Error ? err.message : 'Could not update payment') } finally { setBusy(false) } }
  const start = async () => { if (!result) return; setBusy(true); setError(''); try { await api('/code/' + result.job_uuid + '/start', { method: 'POST' }); setNotice('Session queued. Follow the live trace as the agents work.'); setSession(await api<CodeSession>('/code/' + result.job_uuid)) } catch (err) { setError(err instanceof Error ? err.message : 'Could not start paid session') } finally { setBusy(false) } }
  const sendChat = (event: FormEvent) => { event.preventDefault(); if (!chat.trim()) return; const text = chat.trim(); setMessages((current) => [...current, { from: 'user', text }, { from: 'agent', text: 'Got it. I’ll keep that constraint in view as the plan takes shape.' }]); setChat('') }

  return <div className="workspace-shell"><aside className={'workspace-sidebar ' + (mobileNav ? 'mobile-open' : '')}><div className="workspace-sidebar-top"><Logo /><button className="icon-button sidebar-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><Icon name="x" size={18} /></button></div><button className="new-session" onClick={() => { setResult(null); setSession(null); setArxivUrl(''); setMobileNav(false) }}><span><Icon name="plus" size={16} /></span> New paper session <kbd>⌘ K</kbd></button><div className="sidebar-section"><span className="sidebar-label">WORKSPACE</span><button className="sidebar-link active"><Icon name="spark" size={16} /> Research cockpit</button><button className="sidebar-link"><Icon name="book" size={16} /> My papers <span className="sidebar-count">3</span></button><button className="sidebar-link"><Icon name="clock" size={16} /> Activity</button></div><div className="sidebar-section sidebar-recent"><span className="sidebar-label">RECENT SESSIONS</span><button className="recent-paper"><span className="paper-status teal" /><span><b>Scaling Laws for Neural...</b><small>Today · CODE</small></span></button><button className="recent-paper"><span className="paper-status amber" /><span><b>Attention Is All You Need</b><small>Yesterday · PLAN</small></span></button><button className="recent-paper"><span className="paper-status blue" /><span><b>Diffusion Models</b><small>Jun 18 · READ</small></span></button></div><div className="sidebar-bottom"><button className="sidebar-link"><Icon name="settings" size={16} /> Settings</button><button className="profile-button" onClick={onLogout}><span className="profile-avatar">{displayName.slice(0, 1).toUpperCase()}</span><span><b>{displayName}</b><small>Personal workspace</small></span><Icon name="chevron" size={14} /></button></div></aside><div className="workspace-main"><header className="workspace-header"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Icon name="menu" size={20} /></button><div className="breadcrumbs"><button onClick={onBack}>Polaris</button><Icon name="chevron" size={13} /><span>Research cockpit</span></div><div className="workspace-header-actions"><span className="secure-label"><span className="live-dot" /> Secure workspace</span><button className="icon-button"><Icon name="search" size={18} /></button><button className="avatar-button" onClick={onLogout}>{displayName.slice(0, 1).toUpperCase()}</button></div></header><main className="cockpit-content"><div className="cockpit-heading"><div><p className="eyebrow">{result ? 'ACTIVE PAPER SESSION' : 'MONDAY, JUNE 23 · YOUR RESEARCH COCKPIT'}</p><h1>{result ? result.repo_name.replaceAll('-', ' ') : <>Good to see you, <em>{displayName}.</em></>}</h1><p>{result ? 'Your agents are turning this paper into a result you can run.' : 'One clear place for every paper you’re trying to understand.'}</p></div><div className="heading-actions"><button className="ghost-button" onClick={onLogout}>Sign out</button><button className="primary-button" onClick={() => document.getElementById('paper-input')?.focus()}><Icon name="plus" size={16} /> New session</button></div></div><div className="cockpit-grid"><section className="conversation-card panel-card"><div className="card-header"><div><span className="card-eyebrow"><span className="live-dot" /> PAPER INTAKE</span><h2>What are we looking at?</h2></div><span className="shortcut-chip">⌘ ↵</span></div>{!result ? <><p className="card-copy">Paste an arXiv URL and Polaris will read the paper, trace its evidence, then sketch a build plan.</p><form className="paper-input-form" onSubmit={ingest}><div className="input-leading"><Icon name="paperclip" size={18} /><input id="paper-input" value={arxivUrl} onChange={(event) => setArxivUrl(event.target.value)} placeholder="Paste an arXiv link or paper URL…" aria-label="Paper URL" /><button type="button" className="input-clear" onClick={() => setArxivUrl('')}><Icon name="x" size={15} /></button></div><button className="primary-button" disabled={busy || !arxivUrl.trim()}>{busy ? 'Indexing…' : 'Start reading'} <Icon name="arrow" size={15} /></button></form><div className="suggestion-row"><span>Try a classic</span><button onClick={() => setArxivUrl('https://arxiv.org/pdf/1706.03762')}>Attention Is All You Need</button><button onClick={() => setArxivUrl('https://arxiv.org/pdf/2006.11239')}>Diffusion Models</button></div></> : <div className="active-paper-summary"><div className="active-paper-icon"><Icon name="book" size={21} /></div><div><b>{result.arxiv_id ? 'arXiv:' + result.arxiv_id : result.repo_name}</b><p>Agents are working through your paper now.</p></div><span className="status-dot-label"><span className="live-dot" /> {session?.progress ?? 'in-progress'}</span></div>}{error && <p className="form-error workspace-error">{error}</p>}{notice && <p className="workspace-notice"><Icon name="check" size={14} /> {notice}</p>}<div className="mini-pipeline"><AgentPipeline active={activeIndex} /></div></section><section className="chat-card panel-card"><div className="card-header"><div><span className="card-eyebrow">POLARIS AGENT</span><h2>Ask while it works.</h2></div><span className="agent-online"><span className="live-dot" /> online</span></div><div className="chat-messages">{messages.slice(-3).map((message, index) => <div className={'chat-message ' + message.from} key={index}>{message.from === 'agent' && <span className="chat-avatar"><Icon name="spark" size={13} /></span>}<p>{message.text}</p></div>)}</div><form className="chat-form" onSubmit={sendChat}><input value={chat} onChange={(event) => setChat(event.target.value)} placeholder="Ask about this paper…" aria-label="Ask Polaris" /><button className="send-button" aria-label="Send message"><Icon name="send" size={16} /></button></form></section><section className="pipeline-card panel-card"><div className="card-header"><div><span className="card-eyebrow">THE RESEARCH LOOP</span><h2>Every step, visible.</h2></div><span className="progress-label">{result ? '1 of 4 active' : 'Ready to begin'}</span></div><div className="workspace-agent-list">{agentData.map((agent, index) => <div className={'workspace-agent ' + agent.color + (index === activeIndex ? ' active' : '')} key={agent.key}><span className="workspace-agent-icon"><Icon name={agent.icon} size={16} /></span><div><b>{agent.label}</b><span>{index < activeIndex ? 'Complete' : index === activeIndex ? 'Working now' : 'Waiting'}</span></div><span className="workspace-agent-status">{index < activeIndex ? <Icon name="check" size={14} /> : index === activeIndex ? <i className="pulse-ring" /> : '—'}</span></div>)}</div></section><section className="files-card panel-card"><div className="card-header"><div><span className="card-eyebrow">SANDBOX FILES</span><h2>{entries.length ? 'Your implementation' : 'Files will appear here.'}</h2></div><button className="icon-button"><Icon name="file" size={17} /></button></div>{entries.length ? <div className="file-list">{entries.slice(0, 5).map((entry) => <div className="file-row" key={entry.path}><Icon name={entry.type === 'dir' ? 'grid' : 'file'} size={15} /><span>{entry.path}</span>{entry.html_url && <a href={entry.html_url} target="_blank" rel="noreferrer">view</a>}</div>)}</div> : <div className="empty-files"><span className="empty-file-icon"><Icon name="code" size={20} /></span><p>Start a paper session and your sandbox will take shape here.</p></div>}</section><section className="terminal-card panel-card"><Terminal traces={traces} isRunning={!!result && session?.progress !== 'completed'} /></section></div>{result && <section className="session-actions panel-card"><div><span className="card-eyebrow">SESSION CONTROL</span><h2>Ready for your call.</h2><p>{result.repo_exists ? 'This paper already has a repository. Choose how you want to continue.' : 'Your paper is indexed. Review the next move before the sandbox starts.'}</p></div><div className="session-action-buttons">{result.repo_exists && <><button className="secondary-button" disabled={busy} onClick={() => choose('modify')}>Modify repository</button><button className="secondary-button" disabled={busy} onClick={() => choose('run')}>Run existing code</button></>}{session?.payment_status !== 'paid' && <><button className="primary-button" onClick={refresh} disabled={busy}>{busy ? 'Opening Razorpay…' : 'Pay now'} <Icon name="arrow" size={15} /></button>{import.meta.env.DEV && <button className="ghost-button" onClick={payDev} disabled={busy}>Dev: mark paid</button>}</>}{session?.payment_status === 'paid' && <button className="primary-button" onClick={start} disabled={busy}>Start sandbox <Icon name="play" size={14} /></button>}</div></section>}</main><footer className="workspace-footer"><span><Logo compact /></span><span>Research deserves a paper trail.</span><span>polaris AI · early access</span></footer></div></div>
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [view, setView] = useState<'landing' | 'workspace'>('landing')
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('signup')
  const [checkingSession, setCheckingSession] = useState(true)

  useEffect(() => {
    const token = _getCookie('polaris_session')
    if (!token) { setCheckingSession(false); return }
    _authToken = token
    api<User>('/auth/me')
      .then((current) => { setUser(current); setView('workspace') })
      .catch(() => { _authToken = null })
      .finally(() => setCheckingSession(false))
  }, [])
  const openStart = () => { if (user) setView('workspace'); else { setAuthMode('signup'); setAuthOpen(true) } }
  const openSignIn = () => { setAuthMode('login'); setAuthOpen(true) }
  const authenticated = (current: User) => { _authToken = _getCookie('polaris_session'); setUser(current); setAuthOpen(false); setView('workspace') }
  const logout = async () => { try { await api('/auth/logout', { method: 'POST' }) } catch { /* local state still resets */ } _authToken = null; setUser(null); setView('landing') }

  if (checkingSession) return <div className="boot-screen"><Logo /><span className="boot-line" /></div>
  return <>{user && view === 'workspace' ? <Workspace user={user} onLogout={logout} onBack={() => setView('landing')} /> : <Landing onStart={openStart} onSignIn={openSignIn} />}{authOpen && <AuthModal mode={authMode} setMode={setAuthMode} onClose={() => setAuthOpen(false)} onAuth={authenticated} />}</>
}
