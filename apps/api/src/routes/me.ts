import { Hono } from 'hono'
import { jwtMiddleware, mintJwt } from '@open-agents/auth'
import { findAgentsByOwner } from '@open-agents/db'
import { env } from '../env.js'
import { db } from '../server.js'

export const meRoute = new Hono()

/**
 * GET /me
 * JWT-protected. Returns the calling wallet's owner address and their agents.
 * Issues a fresh 15-minute token in x-refreshed-token to implement rolling expiry.
 */
meRoute.get('/me', jwtMiddleware(env.JWT_SECRET), async (c) => {
  const claims = c.var.jwtClaims
  const ownerEoa = (claims.ownerEoa as string) ?? claims.sub

  const agentList = await findAgentsByOwner(db, ownerEoa)

  const refreshedToken = await mintJwt({
    sub: ownerEoa,
    ownerEoa,
    secret: env.JWT_SECRET,
  })

  c.header('x-refreshed-token', refreshedToken)

  return c.json({
    ownerEoa,
    agents: agentList.map(a => ({
      id: a.id,
      subnameLabel: a.subnameLabel,
      agentId: a.agentId,
      baseAddr: a.baseAddr,
      textRecords: a.textRecords,
      agentWalletEoa: a.agentWalletEoa,
      treasurySafeAddress: a.treasurySafeAddress,
      createdAt: a.createdAt.toISOString(),
    })),
  })
})
