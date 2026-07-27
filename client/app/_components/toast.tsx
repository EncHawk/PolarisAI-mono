'use client'

import { motion, AnimatePresence } from 'motion/react'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'

type Toast = {
  id: string
  message: string
  type: 'error' | 'success'
}

interface ToastContextValue {
  toast: (message: string, type?: 'error' | 'success') => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    return { toast: (msg: string) => console.warn('[toast]', msg) }
  }
  return ctx
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((message: string, type: 'error' | 'success' = 'error') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((prev) => [...prev, { id, message, type }])
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 left-1/2 z-[100] flex w-[min(440px,calc(100%-2rem))] -translate-x-1/2 flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 8000)
    return () => clearTimeout(timer)
  }, [onDismiss])

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.98 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className={[
        'flex items-center justify-between gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-xl',
        toast.type === 'error'
          ? 'border-red-200 bg-red-50/95 text-red-900'
          : 'border-emerald-200 bg-emerald-50/95 text-emerald-900',
      ].join(' ')}
    >
      <p className="text-xs leading-relaxed">{toast.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-current opacity-50 transition hover:opacity-100"
        aria-label="Dismiss"
      >
        ×
      </button>
    </motion.div>
  )
}