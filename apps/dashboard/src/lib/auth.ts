import { SiweMessage } from 'siwe'
import { getApiClient } from './api-client'
import type { SiweNonceResponse, SiweVerifyResponse } from '@/types/api'

export interface SiweRequest {
  address: string
  chainId: number
  domain: string
  uri: string
}

/**
 * Step (a) of SIWE: fetch a one-time nonce from apps/api.
 */
export async function fetchSiweNonce(): Promise<string> {
  const client = getApiClient()
  const res = await client.post<SiweNonceResponse>('/auth/siwe-nonce')
  return res.nonce
}

/**
 * Step (b) of SIWE: build the EIP-4361 message string.
 */
export function buildSiweMessageString(req: SiweRequest, nonce: string): string {
  const siwe = new SiweMessage({
    domain: req.domain,
    address: req.address,
    nonce,
    chainId: req.chainId,
    statement: 'Sign in to Open Agents',
    uri: req.uri,
    version: '1',
    issuedAt: new Date().toISOString(),
    expirationTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  })
  return siwe.prepareMessage()
}

/**
 * Step (c) of SIWE: post message + signature; receive a JWT.
 */
export async function verifySiwe(message: string, signature: string): Promise<SiweVerifyResponse> {
  const client = getApiClient()
  return client.post<SiweVerifyResponse>('/auth/siwe-verify', { message, signature })
}

/**
 * Step (d) of SIWE: persist the JWT as an httpOnly cookie.
 */
export async function setSessionCookie(token: string): Promise<void> {
  const res = await fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  if (!res.ok) throw new Error(`Failed to set session cookie: ${res.status}`)
}

export async function clearSessionCookie(): Promise<void> {
  await fetch('/api/session', { method: 'DELETE' })
}
