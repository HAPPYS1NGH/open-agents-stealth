import { describe, expect, it } from 'vitest'
import { mintJwt, verifyJwt } from '../src/jwt.js'

const SECRET = 'test-secret-at-least-32-bytes-long-xxxx'

describe('mintJwt', () => {
  it('returns a JWT string with three dot-separated parts', async () => {
    const token = await mintJwt({ sub: '0xabc', secret: SECRET })
    expect(token.split('.')).toHaveLength(3)
  })
})

describe('verifyJwt', () => {
  it('returns claims for a valid JWT', async () => {
    const token = await mintJwt({ sub: '0xabc', ownerEoa: '0xabc', secret: SECRET })
    const claims = await verifyJwt({ token, secret: SECRET })
    expect(claims.sub).toBe('0xabc')
    expect(claims['ownerEoa']).toBe('0xabc')
  })

  it('throws for a tampered token', async () => {
    const token = await mintJwt({ sub: '0xabc', secret: SECRET })
    const parts = token.split('.')
    const bad = `${parts[0]}.${parts[1]}x.${parts[2]}`
    await expect(verifyJwt({ token: bad, secret: SECRET })).rejects.toThrow()
  })

  it('throws for a token signed with a different secret', async () => {
    const token = await mintJwt({ sub: '0xabc', secret: 'other-secret-32-bytes-long-yyyyyy' })
    await expect(verifyJwt({ token, secret: SECRET })).rejects.toThrow()
  })

  it('throws for an expired token', async () => {
    const token = await mintJwt({ sub: '0xabc', secret: SECRET, ttlSeconds: 0 })
    await new Promise(r => setTimeout(r, 50))
    await expect(verifyJwt({ token, secret: SECRET })).rejects.toThrow()
  })
})
