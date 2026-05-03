'use client'

import { useEffect } from 'react'
import useSWR from 'swr'
import { getApiClient } from '@/lib/api-client'
import type { PaymentResponse, PaymentsListResponse } from '@/types/api'

interface UsePaymentsOpts {
  agentId: string | null
  enabled: boolean
}

interface UsePaymentsReturn {
  payments: PaymentResponse[] | undefined
  isLoading: boolean
  error: Error | undefined
  refresh: () => Promise<unknown>
}

const PAGE_SIZE = 50

/**
 * Loads the first PAGE_SIZE payments via SWR, then opens an EventSource
 * that streams `payment` events for new rows. Each SSE event is unshifted
 * onto the SWR cache via mutate; SWR re-renders the consumer.
 *
 * Stream auth uses the in-memory JWT held by ApiClient. EventSource
 * cannot send custom headers, so we pass it as a query param; if no token
 * is held, we skip the stream and rely on SWR alone.
 */
export function usePayments({
  agentId,
  enabled,
}: UsePaymentsOpts): UsePaymentsReturn {
  const swrKey =
    enabled && agentId
      ? `/agents/${agentId}/payments?limit=${PAGE_SIZE}`
      : null
  const { data, error, isLoading, mutate } = useSWR<PaymentsListResponse, Error>(
    swrKey,
    (path: string) => getApiClient().get<PaymentsListResponse>(path),
    { revalidateOnFocus: false },
  )

  useEffect(() => {
    if (!enabled || !agentId) return
    const token = getApiClient().getToken()
    if (!token) return

    const apiBase =
      process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'
    const since =
      data?.payments[0]?.detectedAt ?? new Date(Date.now() - 60_000).toISOString()
    const url = `${apiBase}/agents/${agentId}/payments/stream?token=${encodeURIComponent(
      token,
    )}&since=${encodeURIComponent(since)}`

    const es = new EventSource(url)
    es.addEventListener('payment', (ev) => {
      const incoming = JSON.parse(
        (ev as MessageEvent<string>).data,
      ) as PaymentResponse
      void mutate(
        (prev) => {
          if (!prev) return prev
          if (prev.payments.find((p) => p.id === incoming.id)) return prev
          return {
            ...prev,
            count: prev.count + 1,
            payments: [incoming, ...prev.payments].slice(0, PAGE_SIZE),
          }
        },
        { revalidate: false },
      )
    })
    es.addEventListener('bye', () => es.close())
    es.onerror = () => {
      // Browser auto-reconnects on transient failure; nothing to do.
    }
    return () => es.close()
  }, [agentId, enabled, data, mutate])

  return {
    payments: data?.payments,
    isLoading,
    error,
    refresh: mutate,
  }
}
