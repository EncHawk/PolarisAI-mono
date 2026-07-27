import { getAccount } from '@/lib/api'
import { Landing } from './_components/landing'

export default async function Page() {
  const account = await getAccount()
  return (
    <Landing
      authed={!!account}
      email={account?.email ?? null}
      name={account?.name ?? null}
    />
  )
}