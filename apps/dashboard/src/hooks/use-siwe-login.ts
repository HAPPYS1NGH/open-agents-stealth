'use client'

import { useCallback, useState } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import {
  buildSiweMessageString,
  fetchSiweNonce,
  setSessionCookie,
  verifySiwe,
} from '@/lib/auth'
import { getApiClient } from '@/lib/api-client'

export type SiweStatus = 'idle' | 'requesting-nonce' | 'awaiting-signature' | 'verifying' | 'authenticated' | 'error'

export interface UseSiweLoginResult {
  status: SiweStatus
  error: Error | null
  login: () => Promise<void>
  reset: () => void
}

/**
 * Drives the SIWE handshake from the connect-wallet button:
 * nonce → sign → verify → set in-memory token + httpOnly cookie.
 */
export function useSiweLogin(): UseSiweLoginResult {
  const [status, setStatus] = useState<SiweStatus>('idle')
  const [error, setError] = useState<Error | null>(null)

  const { address, chainId } = useAccount()
  const { signMessageAsync } = useSignMessage()

  const login = useCallback(async () => {
    if (!address) {
      setError(new Error('Wallet not connected'))
      setStatus('error')
      return
    }
    setError(null)
    try {
      setStatus('requesting-nonce')
      const nonce = await fetchSiweNonce()

      setStatus('awaiting-signature')
      const message = buildSiweMessageString(
        {
          address,
          chainId: chainId ?? 8453,
          domain: typeof window !== 'undefined' ? window.location.host : 'localhost',
          uri: typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
        },
        nonce,
      )
      const signature = await signMessageAsync({ message })

      setStatus('verifying')
      const { token } = await verifySiwe(message, signature)

      getApiClient().setToken(token)
      await setSessionCookie(token)

      setStatus('authenticated')
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
      setStatus('error')
    }
  }, [address, chainId, signMessageAsync])

  const reset = useCallback(() => {
    setStatus('idle')
    setError(null)
  }, [])

  return { status, error, login, reset }
}
