'use client'

import { useState } from 'react'
import { getApiClient } from '@/lib/api-client'
import type { ConfirmReceiptBody, ReceiptResponse } from '@/types/api'

interface UseConfirmPaymentReturn {
  isPending: boolean
  error: Error | null
  toggle: (args: {
    agentId: string
    paymentId: string
    confirmed: boolean
  }) => Promise<ReceiptResponse>
}

export function useConfirmPayment(): UseConfirmPaymentReturn {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  async function toggle(args: {
    agentId: string
    paymentId: string
    confirmed: boolean
  }): Promise<ReceiptResponse> {
    setIsPending(true)
    setError(null)
    try {
      const body: ConfirmReceiptBody = { confirmed: args.confirmed }
      const res = await getApiClient().post<{ receipt: ReceiptResponse }>(
        `/agents/${args.agentId}/receipts/${args.paymentId}/confirm`,
        body,
      )
      return res.receipt
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      setError(err)
      throw err
    } finally {
      setIsPending(false)
    }
  }

  return { isPending, error, toggle }
}
