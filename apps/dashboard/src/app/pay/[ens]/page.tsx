'use client'

import { useParams } from 'next/navigation'
import { PayForm } from '@/components/pay-form'

export default function PayEnsPage() {
  const params = useParams<{ ens: string }>()
  const raw = params?.ens ?? ''
  const ensName = decodeURIComponent(raw)

  if (!ensName.includes('.')) {
    return (
      <main className="mx-auto max-w-md p-6 text-sm text-red-600">
        Invalid name: {ensName}. Expected something like{' '}
        <code>alice.gabhru.eth</code>.
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-md space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Send a payment</h1>
        <p className="text-sm text-muted-foreground">
          Stealth USDC payment to <code>{ensName}</code>.
        </p>
      </header>
      <PayForm ensName={ensName} />
    </main>
  )
}
