import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { jwtMiddleware } from '@open-agents/auth'
import {
  findAgentById,
  insertAgent,
  updateAgent,
} from '@open-agents/db'
import { isAuthorizedForAgent } from '../lib/identity-registry.js'
import { env } from '../env.js'
import { db } from '../server.js'

const createAgentSchema = z.object({
  subnameLabel: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9-]+$/, 'Label must be lowercase alphanumeric with hyphens'),
  baseAddr: z.string().startsWith('0x').length(42),
  agentId: z.string().optional(),
  agentWalletEoa: z.string().startsWith('0x').length(42).optional(),
  textRecords: z.record(z.string()).optional(),
  viewKeyEncrypted: z.string().optional(),
})

const patchAgentSchema = z.object({
  baseAddr: z.string().startsWith('0x').length(42).optional(),
  agentWalletEoa: z.string().startsWith('0x').length(42).optional(),
  textRecords: z.record(z.string()).optional(),
  treasurySafeAddress: z.string().startsWith('0x').length(42).optional(),
  viewKeyEncrypted: z.string().optional(),
})

export const agentsRoute = new Hono()

/**
 * POST /agents
 * Creates an agent. The caller must be SIWE-authenticated.
 * If `agentId` is supplied (the on-chain ERC-8004 ID), we verify
 * on-chain that the caller is ownerOf or getAgentWallet for that ID.
 */
agentsRoute.post(
  '/agents',
  jwtMiddleware(env.JWT_SECRET),
  zValidator('json', createAgentSchema),
  async (c) => {
    const claims = c.var.jwtClaims
    const ownerEoa = (claims.ownerEoa as string) ?? claims.sub
    const body = c.req.valid('json')

    if (body.agentId) {
      const [, idStr] = body.agentId.split(':')
      if (!idStr) return c.json({ error: 'Invalid agentId format, expected "chainId:uint256"' }, 400)
      const authorized = await isAuthorizedForAgent({
        rpcUrl: env.BASE_RPC_URL,
        registryAddress: env.IDENTITY_REGISTRY_ADDRESS as `0x${string}`,
        agentId: BigInt(idStr),
        callerAddress: ownerEoa,
      })
      if (!authorized) {
        return c.json(
          { error: 'Caller is not ownerOf or agentWallet for the given agentId on Base mainnet' },
          403,
        )
      }
    }

    try {
      const agent = await insertAgent(db, {
        ownerEoa,
        subnameLabel: body.subnameLabel,
        baseAddr: body.baseAddr,
        agentId: body.agentId,
        agentWalletEoa: body.agentWalletEoa,
        textRecords: body.textRecords ?? {},
        viewKeyEncrypted: body.viewKeyEncrypted,
      })
      return c.json(
        {
          id: agent.id,
          ownerEoa: agent.ownerEoa,
          subnameLabel: agent.subnameLabel,
          agentId: agent.agentId,
          baseAddr: agent.baseAddr,
          agentWalletEoa: agent.agentWalletEoa,
          textRecords: agent.textRecords,
          treasurySafeAddress: agent.treasurySafeAddress,
          createdAt: agent.createdAt.toISOString(),
        },
        201,
      )
    } catch (err) {
      if (String(err).includes('23505') || String(err).toLowerCase().includes('unique')) {
        return c.json({ error: 'Subname label is already taken' }, 409)
      }
      throw err
    }
  },
)

/**
 * GET /agents/:id
 * Returns the agent with the given UUID if it belongs to the authenticated caller.
 */
agentsRoute.get('/agents/:id', jwtMiddleware(env.JWT_SECRET), async (c) => {
  const claims = c.var.jwtClaims
  const ownerEoa = (claims.ownerEoa as string) ?? claims.sub
  const id = c.req.param('id')

  const agent = await findAgentById(db, id)
  if (!agent) return c.json({ error: 'Agent not found' }, 404)
  if (agent.ownerEoa !== ownerEoa.toLowerCase()) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  return c.json({
    id: agent.id,
    ownerEoa: agent.ownerEoa,
    subnameLabel: agent.subnameLabel,
    agentId: agent.agentId,
    baseAddr: agent.baseAddr,
    agentWalletEoa: agent.agentWalletEoa,
    textRecords: agent.textRecords,
    treasurySafeAddress: agent.treasurySafeAddress,
    viewKeyEncrypted: agent.viewKeyEncrypted,
    isActive: agent.isActive,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  })
})

/**
 * PATCH /agents/:id
 * Updates mutable agent fields. Caller must own the agent.
 */
agentsRoute.patch(
  '/agents/:id',
  jwtMiddleware(env.JWT_SECRET),
  zValidator('json', patchAgentSchema),
  async (c) => {
    const claims = c.var.jwtClaims
    const ownerEoa = (claims.ownerEoa as string) ?? claims.sub
    const id = c.req.param('id')
    const body = c.req.valid('json')

    const agent = await findAgentById(db, id)
    if (!agent) return c.json({ error: 'Agent not found' }, 404)
    if (agent.ownerEoa !== ownerEoa.toLowerCase()) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const updated = await updateAgent(db, id, {
      ...(body.baseAddr !== undefined && { baseAddr: body.baseAddr }),
      ...(body.agentWalletEoa !== undefined && { agentWalletEoa: body.agentWalletEoa }),
      ...(body.textRecords !== undefined && { textRecords: body.textRecords }),
      ...(body.treasurySafeAddress !== undefined && { treasurySafeAddress: body.treasurySafeAddress }),
      ...(body.viewKeyEncrypted !== undefined && { viewKeyEncrypted: body.viewKeyEncrypted }),
    })

    return c.json({
      id: updated.id,
      ownerEoa: updated.ownerEoa,
      subnameLabel: updated.subnameLabel,
      agentId: updated.agentId,
      baseAddr: updated.baseAddr,
      agentWalletEoa: updated.agentWalletEoa,
      textRecords: updated.textRecords,
      treasurySafeAddress: updated.treasurySafeAddress,
      isActive: updated.isActive,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    })
  },
)
