import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { generateNonce, verifySiweMessage, mintJwt } from '@open-agents/auth'
import { env } from '../env.js'

// In-process nonce store. Each nonce can only be used once; expires in 5 min.
const nonceStore = new Map<string, number>()
const NONCE_TTL_MS = 5 * 60 * 1000

function issueNonce(): string {
  const now = Date.now()
  for (const [n, exp] of nonceStore.entries()) {
    if (exp < now) nonceStore.delete(n)
  }
  const nonce = generateNonce()
  nonceStore.set(nonce, now + NONCE_TTL_MS)
  return nonce
}

function consumeNonce(nonce: string): boolean {
  const exp = nonceStore.get(nonce)
  if (!exp || exp < Date.now()) return false
  nonceStore.delete(nonce)
  return true
}

const verifySchema = z.object({
  message: z.string().min(10),
  signature: z.string().startsWith('0x'),
})

export const authRoute = new Hono()

/**
 * POST /auth/siwe-nonce
 * Returns a one-time nonce for the client to embed in its SIWE message.
 */
authRoute.post('/auth/siwe-nonce', (c) => {
  const nonce = issueNonce()
  return c.json({ nonce })
})

/**
 * POST /auth/siwe-verify
 * Verifies the SIWE message + signature, consumes the nonce, and returns
 * a 15-minute JWT containing the authenticated owner EOA address.
 */
authRoute.post(
  '/auth/siwe-verify',
  zValidator('json', verifySchema),
  async (c) => {
    const { message, signature } = c.req.valid('json')

    let verified: { address: string }
    try {
      const nonceMatch = message.match(/Nonce: ([A-Za-z0-9]+)/)
      const nonce = nonceMatch?.[1] ?? ''
      if (!consumeNonce(nonce)) {
        return c.json({ error: 'Nonce not found, expired, or already used' }, 400)
      }
      verified = await verifySiweMessage({
        message,
        signature,
        nonce,
        domain: env.SIWE_DOMAIN,
      })
    } catch (err) {
      return c.json({ error: 'SIWE verification failed', detail: String(err) }, 400)
    }

    const token = await mintJwt({
      sub: verified.address.toLowerCase(),
      ownerEoa: verified.address.toLowerCase(),
      secret: env.JWT_SECRET,
    })
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()

    return c.json({ token, expiresAt })
  },
)
