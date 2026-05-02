import { SiweMessage } from 'siwe'
import { randomBytes } from 'crypto'

export interface SiweMessageParams {
  domain: string
  address: string
  nonce: string
  chainId: number
  statement?: string
  uri?: string
}

export interface SiweVerifyParams {
  message: string
  signature: string
  nonce: string
  domain: string
}

export interface SiweVerifyResult {
  address: string
  chainId: number
  issuedAt: string
}

/**
 * Generates a cryptographically random 32-byte hex nonce string.
 * Store in a short-lived server-side map keyed by session/IP; expire after 5 min.
 */
export function generateNonce(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Builds an EIP-4361 (SIWE) message string ready for the wallet to sign.
 */
export function buildSiweMessage(params: SiweMessageParams): string {
  const siwe = new SiweMessage({
    domain: params.domain,
    address: params.address,
    nonce: params.nonce,
    chainId: params.chainId,
    statement: params.statement ?? 'Sign in to Open Agents',
    uri: params.uri ?? `https://${params.domain}`,
    version: '1',
    issuedAt: new Date().toISOString(),
    expirationTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  })
  return siwe.prepareMessage()
}

/**
 * Verifies a SIWE message+signature pair. Throws if invalid.
 * Returns the recovered address (checksummed), chainId, and issuedAt.
 */
export async function verifySiweMessage(params: SiweVerifyParams): Promise<SiweVerifyResult> {
  const siwe = new SiweMessage(params.message)
  const result = await siwe.verify({
    signature: params.signature,
    nonce: params.nonce,
    domain: params.domain,
  })
  if (!result.success || !result.data.address) {
    throw new Error(`SIWE verification failed: ${result.error?.type ?? 'unknown'}`)
  }
  return {
    address: result.data.address,
    chainId: result.data.chainId ?? 1,
    issuedAt: result.data.issuedAt ?? new Date().toISOString(),
  }
}
