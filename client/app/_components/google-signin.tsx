'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            callback: (response: { credential?: string }) => void
          }) => void
          prompt: (notification?: (notification: {
            isDisplayed: () => boolean
            isNotDisplayed: () => boolean
            getNotDisplayedReason: () => string
            isSkippedMoment: () => boolean
            getSkippedReason: () => string
            isDismissedMoment: () => boolean
            getDismissedReason: () => string
          }) => void) => void
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

type SignInStatus = 'idle' | 'loading' | 'verifying' | 'error'

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

/**
 * Robust Google Identity Services hook with explicit loading states.
 *
 * - Shows 'loading' immediately when the user clicks sign-in while GIS loads
 *   or while the account picker is opening.
 * - Uses Google's prompt() moment notification to detect when the picker
 *   is not displayed (popup blocked, previously dismissed, etc.) and surfaces
 *   a clear error with a fallback retry.
 */
export function useGoogleSignIn(onSignedIn: (email: string) => void) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
  const [status, setStatus] = useState<SignInStatus>('idle')
  const [error, setError] = useState('')
  const [hint, setHint] = useState('Verifying your Google account…')

  // Store the last id_token so we can check if this is a returning user
  const storeIdToken = useCallback((token: string) => {
    try { localStorage.setItem('polaris_id_token', token) } catch {}
  }, [])

  // Check if we have a stored id_token — means user has signed in before
  const hasStoredId = typeof window !== 'undefined' && !!localStorage.getItem('polaris_id_token')

  const onSignedInRef = useRef(onSignedIn)
  onSignedInRef.current = onSignedIn

  const gisCallback = useCallback(async (resp: { credential?: string }) => {
    const idToken = resp.credential
    if (!idToken) {
      setStatus('error')
      setError('Google did not return a credential. Try again.')
      return
    }
    // Store id_token locally to flag returning users
    storeIdToken(idToken)
    setStatus('verifying')
    setHint('Verifying your Google account…')
    try {
      const r = await fetch('/api/auth/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: idToken }),
      })
      if (!r.ok) {
        const detail = await r.json().catch(() => ({ detail: 'Sign-in failed.' }))
        setStatus('error')
        setError(typeof detail.detail === 'string' ? detail.detail : 'Sign-in failed.')
        return
      }
      setHint('Issuing your Polaris API key…')
      const data = (await r.json()) as { email: string }
      onSignedInRef.current(data.email)
      setStatus('idle')
    } catch {
      setStatus('error')
      setError('Could not reach the Polaris API. Check your connection and try again.')
    }
  }, [storeIdToken])

  const readyRef = useRef(false)
  const buttonContainerRef = useRef<HTMLDivElement | null>(null)
  const renderButtonIn = useCallback((container: HTMLDivElement) => {
    buttonContainerRef.current = container
    if (!window.google?.accounts?.id || !clientId) return
    window.google.accounts.id.renderButton(container, {
      type: 'standard',
      size: 'large',
      text: 'signin_with',
      shape: 'rectangular',
      width: container.offsetWidth || 280,
    })
  }, [clientId])

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    const init = () => {
      if (cancelled || !window.google?.accounts?.id || readyRef.current) return
      readyRef.current = true
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: gisCallback,
      })
      // If modal is already open with a container, render the button
      if (buttonContainerRef.current) {
        window.google.accounts.id.renderButton(buttonContainerRef.current, {
          type: 'standard',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          width: buttonContainerRef.current.offsetWidth || 280,
        })
      }
    }
    if (window.google?.accounts?.id) init()
    else loadGoogleIdentity().then(init)
    return () => { cancelled = true }
  }, [clientId, gisCallback])

  const signIn = useCallback(() => {
    if (!clientId) {
      setStatus('error')
      setError('Google sign-in is not configured. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID and rebuild.')
      return
    }
    setStatus('loading')
    setError('')

    const doPrompt = () => {
      if (!window.google?.accounts?.id) {
        setStatus('error')
        setError('Google sign-in is not available. Check your connection.')
        return
      }
      window.google.accounts.id.prompt((notification) => {
        // If the prompt was not displayed at all, surface a helpful error quickly
        if (notification.isNotDisplayed && notification.isNotDisplayed()) {
          const reason = notification.getNotDisplayedReason?.() || 'unknown'
          if (reason === 'suppressed_by_user' || reason === 'opt_out') {
            setStatus('error')
            setError('Google sign-in was blocked by browser settings. Please allow popups or try again.')
          } else if (reason === 'excluded' || reason === 'invalid_client') {
            setStatus('error')
            setError('Google sign-in is temporarily unavailable. Please try again in a moment.')
          } else {
            // For other non-display reasons, keep loading a bit longer — Google may still resolve
            setTimeout(() => {
              if (statusRef.current === 'loading') {
                setStatus('error')
                setError('Could not open Google sign-in. Please try again.')
              }
            }, 3500)
          }
        }
        if (notification.isDismissedMoment && notification.isDismissedMoment()) {
          const reason = notification.getDismissedReason?.() || 'unknown'
          if (reason === 'credential_returned') {
            // Happy path: credential callback will fire separately; keep verifying
            return
          }
          // User dismissed the picker
          setStatus('idle')
          setError('')
        }
        if (notification.isSkippedMoment && notification.isSkippedMoment()) {
          setStatus('idle')
          setError('')
        }
      })
    }

    if (!window.google?.accounts?.id) {
      loadGoogleIdentity().then(doPrompt)
      return
    }
    doPrompt()
  }, [clientId])

  const statusRef = useRef(status)
  statusRef.current = status

  const retry = useCallback(() => {
    setStatus('idle')
    setError('')
    setTimeout(() => signIn(), 50)
  }, [signIn])

  const dismiss = useCallback(() => {
    setStatus('idle')
    setError('')
  }, [])

  return { status, error, hint, signIn, retry, dismiss, renderButtonIn, hasStoredId }
}

export type { SignInStatus }
