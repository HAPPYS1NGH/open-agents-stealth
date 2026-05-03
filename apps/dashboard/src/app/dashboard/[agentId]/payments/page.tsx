'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { PaymentsTable } from '@/components/payments-table'
import { useMe } from '@/hooks/use-me'
import { usePayments } from '@/hooks/use-payments'

export default function AgentPaymentsPage() {
  const params = useParams<{ agentId: string }>()
  const agentId = params?.agentId ?? null
  const { isAuthenticated } = useMe()

  const { payments, isLoading, error } = usePayments({
    agentId,
    enabled: isAuthenticated,
  })

  if (!isAuthenticated) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p className="text-sm">Connect your wallet to view payments.</p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Payments</h1>
          <p className="text-sm text-muted-foreground">
            Live updates as USDC lands at your stealth addresses.
          </p>
        </div>
        <Link
          href={`/dashboard/${agentId}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back to settings
        </Link>
      </header>

      {error ? (
        <Card className="p-4 text-sm text-red-600">Error: {error.message}</Card>
      ) : null}

      <PaymentsTable
        agentId={agentId ?? ''}
        payments={payments}
        isLoading={isLoading}
      />
    </main>
  )
}
