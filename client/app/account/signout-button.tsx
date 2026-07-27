'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function SignOutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const onSignOut = async () => {
    setBusy(true)
    try {
      await fetch('/api/auth/signout', { method: 'POST' })
      router.push('/')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={onSignOut}
      className="inline-flex h-10 items-center rounded-[10px] border border-border-strong bg-white px-4 text-xs font-bold text-text3 transition hover:border-blue hover:text-text"
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  )
}