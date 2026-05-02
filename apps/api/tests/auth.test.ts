import { beforeAll, describe, expect, it } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { buildSiweMessage } from '@open-agents/auth'

const PK = '0x0000000000000000000000000000000000000000000000000000000000000001'
const account = privateKeyToAccount(PK)

process.env['DATABASE_URL'] = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
process.env['JWT_SECRET'] = 'test-secret-at-least-32-characters-here-xx'
process.env['SIWE_DOMAIN'] = 'localhost'

let app: { fetch: (req: Request) => Promise<Response> }

beforeAll(async () => {
  app = (await import('../src/server.js')).default
})

describe('POST /auth/siwe-nonce', () => {
  it('returns a nonce string', async () => {
    const res = await app.fetch(
      new Request('http://localhost/auth/siwe-nonce', { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json() as { nonce: string }
    expect(typeof body.nonce).toBe('string')
    expect(body.nonce.length).toBeGreaterThanOrEqual(16)
  })
})

describe('POST /auth/siwe-verify', () => {
  it('returns a JWT for a valid SIWE signature', async () => {
    const nonceRes = await app.fetch(
      new Request('http://localhost/auth/siwe-nonce', { method: 'POST' }),
    )
    const { nonce } = await nonceRes.json() as { nonce: string }

    const message = buildSiweMessage({
      domain: 'localhost',
      address: account.address,
      nonce,
      chainId: 1,
      statement: 'Sign in to Open Agents',
      uri: 'http://localhost',
    })
    const signature = await account.signMessage({ message })

    const verifyRes = await app.fetch(
      new Request('http://localhost/auth/siwe-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature }),
      }),
    )
    expect(verifyRes.status).toBe(200)
    const body = await verifyRes.json() as { token: string; expiresAt: string }
    expect(body.token.split('.')).toHaveLength(3)
    expect(typeof body.expiresAt).toBe('string')
  })

  it('returns 400 for a mismatched nonce', async () => {
    const message = buildSiweMessage({
      domain: 'localhost',
      address: account.address,
      nonce: 'neverissuednonce0',
      chainId: 1,
      statement: 'Sign in',
      uri: 'http://localhost',
    })
    const signature = await account.signMessage({ message })
    const res = await app.fetch(
      new Request('http://localhost/auth/siwe-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature }),
      }),
    )
    expect(res.status).toBe(400)
  })
})
