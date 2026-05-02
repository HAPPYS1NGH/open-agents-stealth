import { describe, expect, it } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { generateNonce, buildSiweMessage, verifySiweMessage } from '../src/siwe.js'

const PK = '0x0000000000000000000000000000000000000000000000000000000000000001'
const account = privateKeyToAccount(PK)

describe('generateNonce', () => {
  it('returns a 16+ character hex string', () => {
    const n1 = generateNonce()
    const n2 = generateNonce()
    expect(n1.length).toBeGreaterThanOrEqual(16)
    expect(n1).not.toBe(n2)
  })
})

describe('buildSiweMessage', () => {
  it('produces a string containing domain, address, and nonce', () => {
    const msg = buildSiweMessage({
      domain: 'api.gabhru.eth',
      address: account.address,
      nonce: 'abc12345',
      chainId: 1,
      statement: 'Sign in to Open Agents',
    })
    expect(msg).toContain('api.gabhru.eth')
    expect(msg).toContain(account.address)
    expect(msg).toContain('abc12345')
  })
})

describe('verifySiweMessage', () => {
  it('returns the signer address for a valid signature', async () => {
    const nonce = generateNonce()
    const message = buildSiweMessage({
      domain: 'localhost',
      address: account.address,
      nonce,
      chainId: 1,
      statement: 'Sign in to Open Agents',
    })
    const signature = await account.signMessage({ message })
    const result = await verifySiweMessage({ message, signature, nonce, domain: 'localhost' })
    expect(result.address.toLowerCase()).toBe(account.address.toLowerCase())
  })

  it('throws on nonce mismatch', async () => {
    const message = buildSiweMessage({
      domain: 'localhost',
      address: account.address,
      nonce: 'correctnonce',
      chainId: 1,
      statement: 'Sign in',
    })
    const signature = await account.signMessage({ message })
    await expect(
      verifySiweMessage({ message, signature, nonce: 'wrongnonce0', domain: 'localhost' }),
    ).rejects.toThrow()
  })
})
