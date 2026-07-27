import { redirect } from 'next/navigation'
import { getAccount, authedFetch } from '@/lib/api'
import { CodeClient } from './_components/code-client'

interface Paper {
  id: string
  job_uuid: string
  arxiv_id: string | null
  title: string | null
  status: string
  created_at: string | null
}

export const metadata = {
  title: 'Code — Polaris AI',
  description: 'Review sandbox files, traces, and chat with your reproduction.',
}

export default async function CodePage() {
  const account = await getAccount()
  if (!account) {
    redirect('/?signin=1')
  }

  const res = await authedFetch('/list')
  let papers: Paper[] = []
  if (res.ok) {
    papers = (await res.json()) as Paper[]
  }

  const isPro = account.subscription_tier === 'pro' || account.subscription_tier === 'lab'

  return (
    <CodeClient
      account={account}
      papers={papers}
      isPro={isPro}
    />
  )
}
