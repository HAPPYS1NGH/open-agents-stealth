import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSiweLogin } from '@/hooks/use-siwe-login'

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: '0x1111111111111111111111111111111111111111', chainId: 8453 }),
  useSignMessage: () => ({
    signMessageAsync: vi.fn().mockResolvedValue('0xdeadbeef'),
  }),
}))

vi.mock('@/lib/auth', () => ({
  fetchSiweNonce: vi.fn().mockResolvedValue('test-nonce-123'),
  buildSiweMessageString: vi.fn().mockReturnValue('siwe-message-body'),
  verifySiwe: vi.fn().mockResolvedValue({
    token: 'header.payload.sig',
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
  }),
  setSessionCookie: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/api-client', () => ({
  getApiClient: () => ({
    setToken: vi.fn(),
    getToken: () => null,
  }),
  ApiError: class extends Error {},
}))

describe('useSiweLogin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs the full SIWE flow on login() and reports success', async () => {
    const { result } = renderHook(() => useSiweLogin())
    expect(result.current.status).toBe('idle')

    await act(async () => {
      await result.current.login()
    })

    expect(result.current.status).toBe('authenticated')
    expect(result.current.error).toBeNull()
  })

  it('captures errors and surfaces them in `error`', async () => {
    const auth = await import('@/lib/auth')
    vi.mocked(auth.verifySiwe).mockRejectedValueOnce(new Error('bad signature'))

    const { result } = renderHook(() => useSiweLogin())
    await act(async () => {
      await result.current.login()
    })
    expect(result.current.status).toBe('error')
    expect(result.current.error?.message).toContain('bad signature')
  })
})
