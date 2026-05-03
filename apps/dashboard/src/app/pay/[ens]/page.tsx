'use client'

import { useParams } from 'next/navigation'
import { PayForm } from '@/components/pay-form'
import { SiteNav } from '@/components/site-nav'
import { Card, CardContent } from '@/components/ui/card'

export default function PayEnsPage() {
  const params = useParams<{ ens: string }>()
  const raw = params?.ens ?? ''
  const ensName = decodeURIComponent(raw)

  if (!ensName.includes('.')) {
    return (
      <div className="relative isolate min-h-dvh">
        <SiteNav />
        <main className="mx-auto max-w-md px-4 pt-20 sm:px-6">
          <Card className="border-destructive/30">
            <CardContent className="py-6 text-sm">
              Invalid name <code className="font-mono">{ensName || '(empty)'}</code>.
              Expected something like <code className="font-mono">alice.gabhru.eth</code>.
            </CardContent>
          </Card>
        </main>
      </div>
    )
  }

  return (
    <div className="relative isolate min-h-dvh">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-mesh" />
      <SiteNav />

      <main className="mx-auto max-w-xl px-4 pb-20 pt-12 sm:px-6">
        <header className="mb-8 space-y-3">
          <span className="chip" data-tone="accent">
            /// pay
          </span>
          <h1 className="text-balance text-4xl tracking-tight sm:text-5xl">
            Send a{' '}
            <span className="font-display italic text-accent">private</span>{' '}
            payment
          </h1>
          <p className="text-sm text-muted-foreground">
            USDC on Base will be transferred to a fresh stealth address derived from{' '}
            <code className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-foreground">
              {ensName}
            </code>{' '}
            and announced via ERC-5564.
          </p>
        </header>

        <div className="animate-fade-up">
          <PayForm ensName={ensName} />
        </div>

        <p className="mt-8 text-center font-mono text-[11px] text-muted-foreground">
          new wallet, fresh address. zero linkability.
        </p>
      </main>
    </div>
  )
}
