'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { SiteNav } from '@/components/site-nav'
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

  return (
    <div className="relative isolate min-h-dvh">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-mesh" />
      <SiteNav />

      <main className="mx-auto max-w-5xl px-4 pb-20 pt-12 sm:px-6">
        {!isAuthenticated ? (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              Connect your wallet to view payments.
            </CardContent>
          </Card>
        ) : (
          <>
            <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-2">
                <Link
                  href={`/dashboard/${agentId}`}
                  className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
                >
                  <ChevronLeft size={12} /> back to settings
                </Link>
                <h1 className="text-balance text-4xl tracking-tight sm:text-5xl">
                  Payments
                </h1>
                <p className="text-sm text-muted-foreground">
                  Live updates as USDC lands at your stealth addresses.
                </p>
              </div>
            </header>

            {error && (
              <Card className="mb-4 border-destructive/30">
                <CardContent className="py-4 text-sm text-destructive">
                  Error: {error.message}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="px-4 py-4 sm:px-6">
                <PaymentsTable
                  agentId={agentId ?? ''}
                  payments={payments}
                  isLoading={isLoading}
                />
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  )
}
