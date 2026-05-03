'use client'

import { ArrowUpRight } from 'lucide-react'
import { ConfirmToggle } from './confirm-toggle'
import {
  formatUsdc,
  relativeTime,
  shortAddr,
  shortTx,
} from '@/lib/usdc-format'
import type { PaymentResponse } from '@/types/api'

interface PaymentsTableProps {
  agentId: string
  payments: PaymentResponse[] | undefined
  isLoading: boolean
}

export function PaymentsTable({ agentId, payments, isLoading }: PaymentsTableProps) {
  if (isLoading && !payments) {
    return (
      <div className="grid place-items-center py-12 font-mono text-xs text-muted-foreground">
        scanning announcements…
      </div>
    )
  }

  if (!payments || payments.length === 0) {
    return (
      <div className="space-y-3 rounded-lg border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          /// idle
        </span>
        <p className="text-sm text-muted-foreground">
          No payments yet.{' '}
          <span className="text-foreground">
            Send USDC at <code className="font-mono">/pay/&lt;your-name&gt;.gabhru.eth</code>
          </span>{' '}
          to test the pipeline.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            <th className="py-3 pr-4 font-medium">Amount</th>
            <th className="py-3 pr-4 font-medium">From</th>
            <th className="py-3 pr-4 font-medium">Stealth</th>
            <th className="py-3 pr-4 font-medium">Tx</th>
            <th className="py-3 pr-4 font-medium">When</th>
            <th className="py-3 pl-4 text-right font-medium">Receipt</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr
              key={p.id}
              className="border-b border-border/60 transition-colors last:border-b-0 hover:bg-muted/40"
            >
              <td className="py-3 pr-4 font-mono tabular-nums text-foreground">
                {formatUsdc(p.amount)}
              </td>
              <td className="py-3 pr-4 font-mono text-muted-foreground">
                {shortAddr(p.fromAddress)}
              </td>
              <td className="py-3 pr-4 font-mono text-accent/90">
                {shortAddr(p.stealthAddress)}
              </td>
              <td className="py-3 pr-4 font-mono">
                <a
                  className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                  target="_blank"
                  rel="noopener noreferrer"
                  href={`https://basescan.org/tx/${p.txHash}`}
                >
                  {shortTx(p.txHash)} <ArrowUpRight className="h-3 w-3" />
                </a>
              </td>
              <td className="py-3 pr-4 text-muted-foreground">
                {relativeTime(p.detectedAt)}
              </td>
              <td className="py-3 pl-4 text-right">
                <ConfirmToggle agentId={agentId} payment={p} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
