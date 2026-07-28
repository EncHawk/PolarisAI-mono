'use client'

import { motion } from 'motion/react'
import { useEffect, useState } from 'react'

interface HeaderProps {
  onSignIn: () => void
}

export function Header({ onSignIn }: HeaderProps) {
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
        <button
          type="button"
          onClick={onSignIn}
          className="btn-sheen inline-flex h-10 items-center rounded-[10px] bg-blue px-5 text-xs font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(5,98,239,0.28)]"
        >
          Sign in
        </button>
      </div>
    </motion.header>
  )
}
