'use client'

import { motion, AnimatePresence } from 'motion/react'
import { useEffect, type RefCallback } from 'react'

export type SignInStatus = 'idle' | 'loading' | 'verifying' | 'error'

export function SignInOverlay({
  status,
  error,
  hint,
  onRetry,
  onDismiss,
  buttonRef,
}: {
  status: SignInStatus
  error: string
  hint: string
  onRetry: () => void
  onDismiss: () => void
  buttonRef?: RefCallback<HTMLDivElement>
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && status !== 'verifying' && status !== 'loading') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [status, onDismiss])

  if (status === 'idle') return null

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={() => status !== 'verifying' && status !== 'loading' && onDismiss()}
      >
        <motion.div
          className="relative w-full max-w-sm rounded-2xl border border-border-strong bg-white p-8 shadow-2xl"
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Sign in to Polaris"
        >
          {(status === 'loading' || status === 'verifying') && (
            <div className="flex flex-col items-center text-center">
              <img src="/logo.png" alt="" className="h-10 w-10 rounded-xl" />
              <h1 className="mt-4 font-display text-xl font-semibold tracking-tight text-text">Welcome to Polaris</h1>
              <p className="mt-1.5 text-xs leading-relaxed text-text3 max-w-[28ch]">
                Turn arXiv papers into runnable code. Sign in with Google to get started.
              </p>
              {status === 'loading' && (
                <>
                  <div ref={buttonRef} className="mt-6 min-h-[50px]" />
                  <p className="mt-4 text-[11px] text-text4">
                    By signing in you agree to our Terms of Service.
                  </p>
                </>
              )}
              {status === 'verifying' && (
                <>
                  <div className="polaris-spinner mt-6" role="status" aria-live="polite" />
                  <p className="mt-3 font-mono text-[12px] tracking-wide text-blue">{hint}</p>
                </>
              )}
            </div>
          )}

          {status === 'error' && (
            <div className="flex flex-col items-center text-center">
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Close"
                className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-text4 transition hover:bg-surface-blue hover:text-text"
              >
                ×
              </button>
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-text4">Sign-in failed</span>
              <h2 className="mt-3 font-display text-xl font-medium tracking-tight text-text">
                We couldn&rsquo;t sign you in
              </h2>
              <p className="mt-2 max-w-[36ch] text-sm leading-relaxed text-text3">{error}</p>
              <button
                type="button"
                onClick={onRetry}
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
