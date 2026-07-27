'use client'

import { motion, AnimatePresence } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'

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
  buttonRef?: (el: HTMLDivElement) => void
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
        className="polaris-modal-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={() => status !== 'verifying' && status !== 'loading' && onDismiss()}
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
          {(status === 'loading' || status === 'verifying') && (
            <div className="flex flex-col items-center text-center">
              {/* Google Sign-In button is rendered into this container */}
              <div ref={(el) => { if (el && buttonRef && status === 'loading') buttonRef(el) }} className="mt-2 min-h-[50px]" />
              {status === 'verifying' && (
                <>
                  <div className="polaris-spinner mt-6" role="status" aria-live="polite" />
                  <h2 className="mt-4 font-display text-xl font-medium tracking-tight text-text">Signing you in</h2>
                  <motion.p
                    key={hint}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                    className="mt-2 font-mono text-[12px] tracking-wide text-blue"
                  >
                    {hint}
                  </motion.p>
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
