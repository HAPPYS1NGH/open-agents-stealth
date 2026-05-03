import { Hono } from 'hono'
import { jwtMiddleware, mintJwt } from '@open-agents/auth'
import { findAgentsByOwner } from '@open-agents/db'
import { isStealthMetaAddress } from '@open-agents/crypto'
import { env } from '../env.js'
import { db } from '../server.js'

export const meRoute = new Hono()

function deriveViewKeyState(value: string | null | undefined): 'none' | 'stub' | 'v1' {
  if (!value) return 'none'
  if (value.startsWith('v1:')) return 'v1'
  if (value.startsWith('stub:')) return 'stub'
  return 'none'
}

function deriveStealthMetaPublished(records: Record<string, string> | null | undefined): boolean {
  const meta = records?.['stealth-meta']
  return typeof meta === 'string' && isStealthMetaAddress(meta)
}

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
      viewKeyState: deriveViewKeyState(a.viewKeyEncrypted),
      stealthMetaPublished: deriveStealthMetaPublished(
        a.textRecords as Record<string, string> | null,
      ),
    })),
  })
})
