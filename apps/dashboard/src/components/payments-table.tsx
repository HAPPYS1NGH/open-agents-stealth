'use client'

import { Card } from '@/components/ui/card'
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
    return <p className="text-sm text-muted-foreground">Loading payments…</p>
  }
  if (!payments || payments.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        No payments yet. Send USDC to your stealth address from the{' '}
        <code>/pay/&lt;your-name&gt;.gabhru.eth</code> page to test the pipeline.
      </Card>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Amount</th>
            <th className="py-2 pr-4 font-medium">From</th>
            <th className="py-2 pr-4 font-medium">Stealth</th>
            <th className="py-2 pr-4 font-medium">Tx</th>
            <th className="py-2 pr-4 font-medium">When</th>
            <th className="py-2 pl-4 text-right font-medium">Receipt</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id} className="border-b last:border-b-0">
              <td className="py-2 pr-4 font-mono">{formatUsdc(p.amount)}</td>
              <td className="py-2 pr-4 font-mono">{shortAddr(p.fromAddress)}</td>
              <td className="py-2 pr-4 font-mono">{shortAddr(p.stealthAddress)}</td>
              <td className="py-2 pr-4 font-mono">
                <a
                  className="hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                  href={`https://basescan.org/tx/${p.txHash}`}
                >
                  {shortTx(p.txHash)}
                </a>
              </td>
              <td className="py-2 pr-4 text-muted-foreground">
                {relativeTime(p.detectedAt)}
              </td>
              <td className="py-2 pl-4">
                <ConfirmToggle agentId={agentId} payment={p} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
