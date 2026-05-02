'use client'

import { useCallback, useState } from 'react'
import { ApiError, getApiClient } from '@/lib/api-client'
import type { AgentResponse, CreateAgentBody } from '@/types/api'

export interface UseCreateAgentResult {
  create: (body: CreateAgentBody) => Promise<AgentResponse | null>
  isPending: boolean
  error: { code: 'conflict' | 'unknown'; message: string } | null
}

/**
 * Wraps POST /agents. Translates the 409 unique-violation case into a
 * structured error so the UI can render a label-specific message.
 */
export function useCreateAgent(): UseCreateAgentResult {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<UseCreateAgentResult['error']>(null)

  const create = useCallback(async (body: CreateAgentBody) => {
    setIsPending(true)
    setError(null)
    try {
      const agent = await getApiClient().post<AgentResponse>('/agents', body)
      return agent
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError({ code: 'conflict', message: err.message })
      } else {
        setError({ code: 'unknown', message: err instanceof Error ? err.message : String(err) })
      }
      return null
    } finally {
      setIsPending(false)
    }
  }, [])

  return { create, isPending, error }
}
