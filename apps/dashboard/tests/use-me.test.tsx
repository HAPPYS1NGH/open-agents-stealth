import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import type { ReactNode } from 'react'
import { useMe } from '@/hooks/use-me'

function wrapper({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
}

describe('useMe', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns data on a 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ownerEoa: '0xabc', agents: [{ id: 'a1', subnameLabel: 'mybot' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useMe(), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data!.ownerEoa).toBe('0xabc')
    expect(result.current.data!.agents).toHaveLength(1)
  })

  it('exposes 401 as a not-authenticated state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useMe(), { wrapper })
    await waitFor(() => expect(result.current.data).toBeUndefined())
    expect(result.current.isAuthenticated).toBe(false)
  })

  it('forwards refreshed token to ApiClient when present', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ownerEoa: '0xabc', agents: [] }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-refreshed-token': 'rolling-jwt-2',
          },
        },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useMe(), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    const { getApiClient } = await import('@/lib/api-client')
    expect(getApiClient().getToken()).toBe('rolling-jwt-2')
  })
})
