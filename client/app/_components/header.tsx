'use client'

import { motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'

interface HeaderProps {
  authed: boolean
  email: string | null
  name?: string | null
  onSignIn: () => void
}

function UserBubble({ email, name, onSignOut }: { email: string | null; name?: string | null; onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const initial = (name || email || 'U').charAt(0).toUpperCase()

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-blue text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
        aria-label="Account menu"
      >
        {initial}
      </button>
      <motion.div
        initial={false}
        animate={open ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: -6, scale: 0.96, pointerEvents: 'none' }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="absolute right-0 top-full mt-2 w-52 rounded-xl border border-border-strong bg-white p-2 shadow-lg"
      >
        <div className="px-3 py-2">
          <p className="text-xs font-medium text-text">{name || email}</p>
          {name && email ? <p className="mt-0.5 text-[11px] text-text4">{email}</p> : null}
        </div>
        <div className="my-1 h-px bg-border" />
        <button
          type="button"
          onClick={() => { setOpen(false); onSignOut() }}
          className="w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-text3 transition hover:bg-surface-blue hover:text-text"
        >
          Log out
        </button>
      </motion.div>
    </div>
  )
}

export function Header({ authed, email, name, onSignIn }: HeaderProps) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const onSignOut = useCallback(async () => {
    try {
      await fetch('/api/auth/signout', { method: 'POST' })
    } catch {
      /* ignore */
    }
    window.location.href = '/?thanks=1'
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
      <nav
        className={[
          'hidden items-center gap-7 text-sm font-medium text-text3 transition-opacity duration-300 sm:flex',
          scrolled ? 'pointer-events-none opacity-0' : 'opacity-100',
        ].join(' ')}
      >
        <a href="/#pricing" className="transition hover:text-blue">Pricing</a>
        <a href="/#how" className="transition hover:text-blue">How it works</a>
      </nav>
      <div className="flex items-center gap-3">
        {authed ? (
          <UserBubble email={email} name={name} onSignOut={onSignOut} />
        ) : (
          <button
            type="button"
            onClick={onSignIn}
            className="btn-sheen inline-flex h-10 items-center rounded-[10px] bg-blue px-5 text-xs font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(5,98,239,0.28)]"
          >
            Sign in
          </button>
        )}
      </div>
    </motion.header>
  )
}
