'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useConfirmPayment } from '@/hooks/use-confirm-payment'
import type { PaymentResponse } from '@/types/api'

interface ConfirmToggleProps {
  agentId: string
  payment: PaymentResponse
  onChange?: (newState: boolean) => void
}

export function ConfirmToggle({ agentId, payment, onChange }: ConfirmToggleProps) {
  const [optimistic, setOptimistic] = useState(
    payment.receipt?.confirmedByRecipient ?? false,
  )
  const { toggle, isPending, error } = useConfirmPayment()

  async function handleClick() {
    const next = !optimistic
    setOptimistic(next)
    try {
      const updated = await toggle({
        agentId,
        paymentId: payment.id,
        confirmed: next,
      })
      onChange?.(updated.confirmedByRecipient)
    } catch {
      setOptimistic(!next) // rollback
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant={optimistic ? 'default' : 'outline'}
        onClick={handleClick}
        disabled={isPending}
      >
        {optimistic ? 'Confirmed' : 'Confirm'}
      </Button>
      {error ? (
        <span className="text-xs text-red-600">{error.message}</span>
      ) : null}
    </div>
  )
}
