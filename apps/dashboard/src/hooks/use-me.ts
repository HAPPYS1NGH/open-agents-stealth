'use client'

import useSWR from 'swr'
import { getApiClient } from '@/lib/api-client'
import type { MeResponse } from '@/types/api'

interface MeFetchResult {
  data: MeResponse | null
  status: number
}

async function fetchMe(): Promise<MeFetchResult> {
  const res = await fetch('/api/me', { credentials: 'include' })

  const refreshed = res.headers.get('x-refreshed-token')
  if (refreshed) getApiClient().setToken(refreshed)

  if (res.status === 401) return { data: null, status: 401 }
  if (!res.ok) throw new Error(`/me failed: ${res.status}`)

  const body = (await res.json()) as MeResponse
  return { data: body, status: 200 }
}

export interface UseMeResult {
  data: MeResponse | undefined
  error: Error | undefined
  isAuthenticated: boolean
  isLoading: boolean
  mutate: () => Promise<unknown>
}

/**
 * Polls /api/me. SWR refreshes every 60s (rolling token refresh) and dedupes
 * within 30s. A 401 surfaces as `isAuthenticated: false` so the UI can route
 * the user to /onboard cleanly without throwing.
 */
export function useMe(): UseMeResult {
  const { data, error, isLoading, mutate } = useSWR<MeFetchResult, Error>('/api/me', fetchMe, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  })

  const isAuthenticated = !!data && data.status === 200 && !!data.data
  return {
    data: data?.data ?? undefined,
    error,
    isAuthenticated,
    isLoading,
    mutate,
  }
}
