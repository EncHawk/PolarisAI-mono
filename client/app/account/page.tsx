import Link from 'next/link'
import { getAccount } from '@/lib/api'
import { SignOutButton } from './signout-button'

export default async function AccountPage() {
  const account = await getAccount()
  if (!account) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-24">
        <h1 className="font-display text-2xl font-medium">Not signed in</h1>
        <p className="mt-3 text-text3">
          <Link href="/" className="text-blue hover:underline">Sign in with Google</Link> to view your account.
        </p>
      </main>
    )
  }

  const fmtUSD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
  const tierLabel: Record<string, string> = { starter: 'Starter', pro: 'Pro', lab: 'Lab' }
  const tier = account.subscription_tier ? tierLabel[account.subscription_tier] : '—'
  const renews = account.renews_at ? new Date(account.renews_at).toLocaleDateString() : '—'

  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="font-display text-3xl font-medium tracking-tight">Account</h1>
      <dl className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="card-shine rounded-2xl border border-border bg-white p-6">
          <dt className="font-mono text-[11px] uppercase tracking-wider text-blue">Email</dt>
          <dd className="mt-1 text-text">{account.email}</dd>
        </div>
        <div className="card-shine rounded-2xl border border-border bg-white p-6">
          <dt className="font-mono text-[11px] uppercase tracking-wider text-blue">Credit balance</dt>
          <dd className="mt-1 font-display text-2xl font-semibold text-text">
            {fmtUSD.format(account.credits)}
          </dd>
          <dd className="mt-1 text-xs text-text3">
            $0.05 per 100k tokens (input + output). Charged on run completion.
          </dd>
        </div>
        <div className="card-shine rounded-2xl border border-border bg-white p-6">
          <dt className="font-mono text-[11px] uppercase tracking-wider text-blue">Subscription</dt>
          <dd className="mt-1 text-text">{tier}</dd>
        </div>
        <div className="card-shine rounded-2xl border border-border bg-white p-6">
          <dt className="font-mono text-[11px] uppercase tracking-wider text-blue">Renews</dt>
          <dd className="mt-1 text-text">{renews}</dd>
        </div>
      </dl>

      <div className="mt-10">
        <SignOutButton />
      </div>
    </main>
  )
}