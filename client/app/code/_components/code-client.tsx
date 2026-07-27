'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Prism from 'prismjs'
import 'prismjs/components/prism-python'
import 'prismjs/themes/prism-tomorrow.css'
import { useToast } from '@/app/_components/toast'

interface Account {
  id: string
  email: string
  name: string | null
  username: string | null
  credits: number
  subscription_tier: string | null
}

interface Paper {
  id: string
  job_uuid: string
  arxiv_id: string | null
  title: string | null
  status: string
  created_at: string | null
}

interface RepoFile {
  name: string
  path: string
  type: string
  html_url: string
  download_url: string
}

interface CodeSession {
  session_id: string
  user_name: string | null
  user_email: string
  user_id: string
  repo_name: string
  progress: 'failed' | 'completed' | 'in-progress'
  execution_mode: 'create' | 'modify' | 'run' | null
  payment_status: 'unpaid' | 'pending' | 'paid'
  github_url: string | null
  repo_exists: boolean
  repo_contents: RepoFile[]
}

interface TraceEvent {
  agent?: string
  kind?: string
  status?: string
  message?: string
  conclusion?: string
  [key: string]: unknown
}

interface ChatMessage {
  id: string
  role: 'system' | 'user'
  content: string
  timestamp: Date
  meta?: Record<string, unknown>
}

function cn(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

function formatTime(d: Date) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function UserBubble({ account }: { account: Account }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const onSignOut = async () => {
    setOpen(false)
    try {
      await fetch('/api/auth/signout', { method: 'POST' })
    } catch {
      /* ignore */
    }
    router.push('/?thanks=1')
    router.refresh()
  }

  const initial = (account.name || account.email).charAt(0).toUpperCase()

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-blue text-xs font-semibold text-white shadow-sm transition hover:shadow-md"
        aria-label="Account menu"
      >
        {initial}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-52 rounded-xl border border-border-strong bg-white p-2 shadow-lg">
          <div className="px-3 py-2">
            <p className="text-xs font-medium text-text">{account.name || account.email}</p>
            {account.name && account.email ? <p className="mt-0.5 text-[11px] text-text4">{account.email}</p> : null}
          </div>
          <div className="my-1 h-px bg-border" />
          <a
            href="/account"
            className="block rounded-lg px-3 py-2 text-xs font-medium text-text3 transition hover:bg-surface-blue hover:text-text"
          >
            Account
          </a>
          <button
            type="button"
            onClick={onSignOut}
            className="w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-text3 transition hover:bg-surface-blue hover:text-text"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  )
}

function useSSE(jobUuid: string | null, onMessage: (data: string) => void) {
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!jobUuid) {
      setConnected(false)
      setError(null)
      return
    }
    const ctrl = new AbortController()
    abortRef.current = ctrl
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null

    async function connect() {
      try {
        const res = await fetch(`/api/proxy/events/${jobUuid}`, {
          signal: ctrl.signal,
          headers: { Accept: 'text/event-stream' },
        })
        if (!res.ok || !res.body) {
          setError(`Events stream failed (${res.status})`)
          setConnected(false)
          return
        }
        setConnected(true)
        setError(null)
        reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n\n')
          buffer = lines.pop() || ''
          for (const block of lines) {
            const dataLine = block.split('\n').find((l) => l.startsWith('data: '))
            if (dataLine) {
              onMessage(dataLine.slice(6))
            }
          }
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setError((e as Error).message || 'Stream error')
        }
      } finally {
        setConnected(false)
      }
    }

    connect()
    return () => {
      ctrl.abort()
      reader?.cancel().catch(() => {})
    }
  }, [jobUuid, onMessage])

  const disconnect = useCallback(() => {
    abortRef.current?.abort()
    setConnected(false)
  }, [])

  return { connected, error, disconnect }
}

function FileTabs({
  files,
  activePath,
  onSelect,
}: {
  files: RepoFile[]
  activePath: string
  onSelect: (f: RepoFile) => void
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border bg-surface-alt px-2 pt-2">
      {files.map((f) => (
        <button
          key={f.path}
          type="button"
          onClick={() => onSelect(f)}
          className={cn(
            'shrink-0 rounded-t-lg px-3 py-2 text-xs font-medium transition',
            activePath === f.path
              ? 'bg-white text-text shadow-sm'
              : 'text-text4 hover:text-text hover:bg-white/50'
          )}
        >
          {f.name}
        </button>
      ))}
    </div>
  )
}

function CodeViewer({ content, language }: { content: string; language: string }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (ref.current) {
      Prism.highlightElement(ref.current)
    }
  }, [content, language])
  return (
    <pre className="h-full overflow-auto bg-[#1d1f21] p-4 text-[13px] leading-relaxed">
      <code ref={ref} className={`language-${language}`}>{content}</code>
    </pre>
  )
}

function TraceItem({ event }: { event: TraceEvent }) {
  const agent = event.agent || 'SYSTEM'
  const colorMap: Record<string, string> = {
    READ: 'text-blue',
    RESEARCH: 'text-amber',
    PLAN: 'text-emerald-600',
    CODE: 'text-violet-500',
    SYSTEM: 'text-text4',
  }
  const color = colorMap[agent] || 'text-text4'

  let display = event.message || JSON.stringify(event)
  if (event.status) display += ` [status: ${event.status}]`

  return (
    <div className="flex gap-2 py-1 font-mono text-[11px]">
      <span className={cn('shrink-0 font-semibold', color)}>[{agent}]</span>
      <span className="text-text3 break-words">{display}</span>
    </div>
  )
}

export function CodeClient({ account, papers, isPro }: { account: Account; papers: Paper[]; isPro: boolean }) {
  const { toast } = useToast()
  const [selectedJob, setSelectedJob] = useState<string | null>(papers[0]?.job_uuid || null)
  const [session, setSession] = useState<CodeSession | null>(null)
  const [activeFile, setActiveFile] = useState<RepoFile | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)
  const [traces, setTraces] = useState<TraceEvent[]>([])
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [sending, setSending] = useState(false)
  const [newArxiv, setNewArxiv] = useState('')
  const [startingNew, setStartingNew] = useState(false)
  const tracesEndRef = useRef<HTMLDivElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Fetch code session when job changes
  useEffect(() => {
    if (!selectedJob) {
      setSession(null)
      setActiveFile(null)
      setFileContent(null)
      setTraces([])
      setChatMessages([])
      return
    }
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/proxy/code/${selectedJob}`)
        if (!res.ok) return
        const data = (await res.json()) as CodeSession
        if (cancelled) return
        setSession(data)
        const firstFile = data.repo_contents.find((f) => f.type === 'file')
        if (firstFile) setActiveFile(firstFile)
        else setActiveFile(null)
        setFileContent(null)
        setTraces([])
        setChatMessages([])
      } catch {
        /* ignore */
      }
    }
    load()
    return () => { cancelled = true }
  }, [selectedJob])

  // Fetch file content when active file changes
  useEffect(() => {
    if (!activeFile?.download_url) {
      setFileContent(null)
      return
    }
    let cancelled = false
    setLoadingFile(true)
    fetch(activeFile.download_url)
      .then(async (r) => {
        if (cancelled) return
        const text = await r.text()
        if (cancelled) return
        setFileContent(text)
      })
      .catch(() => {
        if (!cancelled) setFileContent('// Failed to load file')
      })
      .finally(() => {
        if (!cancelled) setLoadingFile(false)
      })
    return () => { cancelled = true }
  }, [activeFile])

  // SSE for live traces
  const handleSSEMessage = useCallback((data: string) => {
    try {
      const parsed = JSON.parse(data) as TraceEvent
      setTraces((prev) => [...prev, parsed])

      // Also add to chat as system messages for key events
      if (parsed.message || parsed.status) {
        setChatMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'system',
            content: parsed.message || `Status: ${parsed.status}`,
            timestamp: new Date(),
            meta: parsed,
          },
        ])
      }

      // Update session progress if terminal status
      if (parsed.status === 'failed' || parsed.status === 'completed') {
        setSession((s) => (s ? { ...s, progress: parsed.status as 'failed' | 'completed' } : s))
      }
    } catch {
      setTraces((prev) => [...prev, { message: data }])
    }
  }, [])

  const { connected: sseConnected, error: sseError, disconnect } = useSSE(selectedJob, handleSSEMessage)

  useEffect(() => {
    tracesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [traces.length])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages.length])

  // Send chat message
  const sendChat = useCallback(async () => {
    if (!chatInput.trim() || !selectedJob || !isPro) return
    const text = chatInput.trim()
    setChatInput('')
    setChatMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', content: text, timestamp: new Date() },
    ])
    setSending(true)
    try {
      // Try to send as plan feedback; if session is not in planning phase,
      // the backend may reject it — we still show it locally.
      await fetch(`/api/proxy/plan/${selectedJob}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true, feedback: text }),
      })
    } catch {
      /* local-only message is fine */
    } finally {
      setSending(false)
    }
  }, [chatInput, selectedJob, isPro])

  // Start new paper
  const startNewPaper = useCallback(async () => {
    if (!newArxiv.trim()) return
    setStartingNew(true)
    try {
      const res = await fetch('/api/proxy/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          arxiv_url: newArxiv.trim(),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Ingest failed' }))
        toast(typeof err.detail === 'string' ? err.detail : 'Ingest failed')
        return
      }
      const data = (await res.json()) as { job_uuid: string; repo_exists: boolean; requires_code_choice: boolean }
      setNewArxiv('')
      // Refresh papers by navigating (simplest way to refresh server data)
      window.location.reload()
    } catch {
      toast('Failed to start new paper')
    } finally {
      setStartingNew(false)
    }
  }, [newArxiv])

  const terminate = useCallback(() => {
    disconnect()
    setSelectedJob(null)
    setSession(null)
    setActiveFile(null)
    setFileContent(null)
    setTraces([])
    setChatMessages([])
  }, [disconnect])

  // Backend-compliant session controls
  const [acting, setActing] = useState(false)

  const chooseRepoAction = useCallback(async (action: 'modify' | 'run') => {
    if (!selectedJob || acting) return
    setActing(true)
    try {
      const res = await fetch(`/api/proxy/code/${selectedJob}/choice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Choice failed' }))
        toast(typeof err.detail === 'string' ? err.detail : 'Choice failed')
        return
      }
      const data = (await res.json()) as { action: string; payment_required: boolean; payment_status: string }
      setSession((s) => (s ? { ...s, execution_mode: data.action as 'modify' | 'run', payment_status: data.payment_status as 'unpaid' | 'pending' | 'paid' } : s))
    } catch {
      toast('Failed to set action')
    } finally {
      setActing(false)
    }
  }, [selectedJob, acting])

  const payDev = useCallback(async () => {
    if (!selectedJob || acting) return
    setActing(true)
    try {
      const res = await fetch(`/api/proxy/code/${selectedJob}/pay-dev`, {
        method: 'POST',
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Dev payment failed' }))
        toast(typeof err.detail === 'string' ? err.detail : 'Dev payment failed')
        return
      }
      setSession((s) => (s ? { ...s, payment_status: 'paid' } : s))
    } catch {
      toast('Dev payment failed')
    } finally {
      setActing(false)
    }
  }, [selectedJob, acting])

  const startJob = useCallback(async () => {
    if (!selectedJob || acting) return
    setActing(true)
    try {
      const res = await fetch(`/api/proxy/code/${selectedJob}/start`, {
        method: 'POST',
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Start failed' }))
        toast(typeof err.detail === 'string' ? err.detail : 'Start failed')
        return
      }
      setSession((s) => (s ? { ...s, progress: 'in-progress' } : s))
    } catch {
      toast('Failed to start job')
    } finally {
      setActing(false)
    }
  }, [selectedJob, acting])

  const activePaper = useMemo(() => papers.find((p) => p.job_uuid === selectedJob), [papers, selectedJob])
  const language = activeFile?.name?.endsWith('.py') ? 'python' : 'text'

  return (
    <div className="flex h-screen flex-col bg-bg text-text">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-3">
          <a href="/" className="inline-flex items-center gap-2 font-display text-sm font-semibold tracking-tight">
            <img src="/logo.png" alt="" className="h-5 w-5 rounded" />
            Polaris
          </a>
          <span className="text-text4">/</span>
          <span className="text-xs text-text3">{activePaper?.title || 'Code workspace'}</span>
        </div>
        <div className="flex items-center gap-3">
          {selectedJob && (
            <button
              type="button"
              onClick={terminate}
              className="inline-flex h-8 items-center rounded-lg border border-border-strong px-3 text-xs font-medium text-text3 transition hover:border-red-300 hover:text-red-500"
            >
              Stop
            </button>
          )}
          <UserBubble account={account} />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-surface-alt">
          <div className="border-b border-border p-3">
            <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-wider text-text4">New paper</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={newArxiv}
                onChange={(e) => setNewArxiv(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && startNewPaper()}
                placeholder="arXiv URL or ID"
                className="h-8 flex-1 rounded-lg border border-border-strong bg-white px-2.5 text-xs text-text outline-none transition focus:border-blue"
              />
              <button
                type="button"
                disabled={startingNew || !newArxiv.trim()}
                onClick={startNewPaper}
                className="btn-sheen inline-flex h-8 shrink-0 items-center rounded-lg bg-blue px-3 text-xs font-bold text-white disabled:opacity-50"
              >
                {startingNew ? '…' : 'Go'}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            <p className="px-2 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-text4">Your papers</p>
            {papers.length === 0 ? (
              <div className="px-2 py-6 text-center text-xs text-text4">No papers yet. Start one above.</div>
            ) : (
              <div className="flex flex-col gap-1">
                {papers.map((paper) => (
                  <button
                    key={paper.job_uuid}
                    type="button"
                    onClick={() => setSelectedJob(paper.job_uuid)}
                    className={cn(
                      'flex flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left transition',
                      selectedJob === paper.job_uuid
                        ? 'bg-white shadow-sm ring-1 ring-border-strong'
                        : 'hover:bg-white/60'
                    )}
                  >
                    <span className="text-xs font-medium text-text line-clamp-1">{paper.title || paper.arxiv_id || 'Untitled'}</span>
                    <span className="font-mono text-[10px] text-text4">{paper.status}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-border p-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] text-text4">Credits</span>
              <span className="text-xs font-semibold text-text">${account.credits.toFixed(2)}</span>
            </div>
          </div>
        </aside>

        {/* Main workspace */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {!selectedJob ? (
            <div className="flex flex-1 items-center justify-center text-text4">
              <div className="text-center">
                <p className="font-display text-lg font-medium text-text3">Select a paper to start</p>
                <p className="mt-2 text-xs text-text4">Or paste an arXiv link in the sidebar to begin a new run.</p>
              </div>
            </div>
          ) : (
            <>
              {/* Session info bar */}
              <div className="flex items-center justify-between border-b border-border px-4 py-2">
                <div className="flex items-center gap-3 text-xs text-text3">
                  <span className="rounded-md bg-surface-blue px-2 py-1 font-mono text-[10px] text-blue">{session?.progress || '…'}</span>
                  <span>{session?.repo_name || selectedJob}</span>
                  {session?.execution_mode && (
                    <span className="rounded-md bg-surface-blue px-2 py-1 font-mono text-[10px] text-blue">{session.execution_mode}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {/* Existing repo choice */}
                  {session?.repo_exists && !session.execution_mode && (
                    <>
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => chooseRepoAction('modify')}
                        className="inline-flex h-7 items-center rounded-md border border-border-strong bg-white px-2.5 text-[11px] font-medium text-text transition hover:border-blue hover:text-blue disabled:opacity-50"
                      >
                        Modify
                      </button>
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => chooseRepoAction('run')}
                        className="inline-flex h-7 items-center rounded-md border border-border-strong bg-white px-2.5 text-[11px] font-medium text-text transition hover:border-blue hover:text-blue disabled:opacity-50"
                      >
                        Run
                      </button>
                    </>
                  )}
                  {/* Payment / Start controls */}
                  {session && !session.repo_exists && session.payment_status !== 'paid' && (
                    <button
                      type="button"
                      disabled={acting}
                      onClick={payDev}
                      className="inline-flex h-7 items-center rounded-md bg-blue px-2.5 text-[11px] font-bold text-white transition hover:bg-blue/90 disabled:opacity-50"
                    >
                      Pay (dev)
                    </button>
                  )}
                  {session && (session.payment_status === 'paid' || (session.repo_exists && session.execution_mode)) && session.progress !== 'in-progress' && (
                    <button
                      type="button"
                      disabled={acting}
                      onClick={startJob}
                      className="inline-flex h-7 items-center rounded-md bg-blue px-2.5 text-[11px] font-bold text-white transition hover:bg-blue/90 disabled:opacity-50"
                    >
                      Start
                    </button>
                  )}
                  {sseConnected ? (
                    <span className="flex items-center gap-1 text-emerald-600">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Live
                    </span>
                  ) : sseError ? (
                    <span className="text-red-500">Disconnected</span>
                  ) : (
                    <span className="text-text4">Connecting…</span>
                  )}
                </div>
              </div>

              {/* File viewer */}
              <div className="flex flex-1 flex-col overflow-hidden">
                {session && session.repo_contents.length > 0 ? (
                  <>
                    <FileTabs
                      files={session.repo_contents.filter((f) => f.type === 'file')}
                      activePath={activeFile?.path || ''}
                      onSelect={(f) => setActiveFile(f)}
                    />
                    <div className="flex-1 overflow-hidden">
                      {loadingFile ? (
                        <div className="flex h-full items-center justify-center text-xs text-text4">Loading…</div>
                      ) : fileContent != null ? (
                        <CodeViewer content={fileContent} language={language} />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-text4">Select a file</div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex flex-1 items-center justify-center text-xs text-text4">
                    {session ? 'No files in this repository yet.' : 'Loading session…'}
                  </div>
                )}
              </div>

              {/* Bottom panel: traces + chat */}
              <div className="flex h-[260px] shrink-0 flex-col border-t border-border bg-surface-alt">
                {/* Tabs for bottom panel */}
                <div className="flex items-center gap-1 border-b border-border px-3">
                  <button type="button" className="px-3 py-2 text-xs font-medium text-text">Traces</button>
                  <button type="button" className="px-3 py-2 text-xs font-medium text-text4">Chat</button>
                </div>

                <div className="flex flex-1 overflow-hidden">
                  {/* Traces */}
                  <div className="flex-1 overflow-y-auto p-3">
                    {traces.length === 0 ? (
                      <p className="text-xs text-text4">Waiting for traces…</p>
                    ) : (
                      <div className="flex flex-col">
                        {traces.map((t, i) => (
                          <TraceItem key={i} event={t} />
                        ))}
                        <div ref={tracesEndRef} />
                      </div>
                    )}
                  </div>

                  {/* Chat */}
                  <div className="flex w-80 shrink-0 flex-col border-l border-border bg-white">
                    <div className="flex-1 overflow-y-auto p-3">
                      {chatMessages.length === 0 ? (
                        <p className="text-xs text-text4">No messages yet.</p>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {chatMessages.map((msg) => (
                            <div
                              key={msg.id}
                              className={cn(
                                'rounded-lg px-2.5 py-1.5 text-xs',
                                msg.role === 'user' ? 'bg-blue/10 text-text' : 'bg-surface-alt text-text3'
                              )}
                            >
                              <div className="mb-0.5 flex items-center justify-between">
                                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider">
                                  {msg.role}
                                </span>
                                <span className="font-mono text-[9px] text-text4">{formatTime(msg.timestamp)}</span>
                              </div>
                              <p className="leading-relaxed">{msg.content}</p>
                            </div>
                          ))}
                          <div ref={chatEndRef} />
                        </div>
                      )}
                    </div>
                    <div className="border-t border-border p-2">
                      {isPro ? (
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendChat()}
                            placeholder="Send feedback or a query…"
                            disabled={sending}
                            className="h-8 flex-1 rounded-lg border border-border-strong bg-surface px-2.5 text-xs text-text outline-none transition focus:border-blue disabled:opacity-50"
                          />
                          <button
                            type="button"
                            disabled={sending || !chatInput.trim()}
                            onClick={sendChat}
                            className="btn-sheen inline-flex h-8 shrink-0 items-center rounded-lg bg-blue px-3 text-xs font-bold text-white disabled:opacity-50"
                          >
                            {sending ? '…' : 'Send'}
                          </button>
                        </div>
                      ) : (
                        <div className="rounded-lg bg-surface-alt px-3 py-2 text-center text-[11px] text-text4">
                          Chat is available on Pro and Lab plans.
                          <a href="/#pricing" className="ml-1 text-blue hover:underline">Upgrade</a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
