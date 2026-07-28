import { redirect } from 'next/navigation'
import { getAccount } from '@/lib/api'
import { Landing } from './_components/landing'

export default async function Page() {
  const account = await getAccount()
  if (account) {
    redirect('/code')
  }
  return <Landing />
}