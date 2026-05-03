import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { jwtMiddleware } from '@open-agents/auth'
import {
  findAgentById,
  findPaymentById,
  insertAgent,
  listPaymentsByAgent,
  updateAgent,
  upsertReceipt,
  type PaymentWithReceipt,
} from '@open-agents/db'
import {
  isAuthorizedForAgent,
  checkRegisterReceipt,
  getAgentWalletInfo,
} from '../lib/identity-registry.js'
import { encryptForStorage } from '../lib/view-key-store.js'
import { isStealthMetaAddress } from '@open-agents/crypto'
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
  viewKeyEncrypted: z
    .string()
    .refine(
      (v) => v.startsWith('stub:') || v.startsWith('v1:'),
      'viewKeyEncrypted must start with "stub:" (Plan 3) or "v1:" (Plan 4)',
    )
    .optional(),
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

    // Merge text_records — never replace the whole map. Step-2 stealth-meta
    // and step-3 agent-registration[*] keys are written outside this route and
    // must survive a step-5 records form save. To remove a key, the client
    // must explicitly set it to the empty string.
    let nextRecords: Record<string, string> | undefined
    if (body.textRecords !== undefined) {
      const existing = (agent.textRecords as Record<string, string> | null) ?? {}
      nextRecords = { ...existing }
      for (const [k, v] of Object.entries(body.textRecords)) {
        if (v === '') delete nextRecords[k]
        else nextRecords[k] = v
      }
    }

    const updated = await updateAgent(db, id, {
      ...(body.baseAddr !== undefined && { baseAddr: body.baseAddr }),
      ...(body.agentWalletEoa !== undefined && { agentWalletEoa: body.agentWalletEoa }),
      ...(nextRecords !== undefined && { textRecords: nextRecords }),
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

const registerOnchainSchema = z.object({
  agentId: z
    .string()
    .regex(/^[0-9]+:[0-9]+$/, 'agentId must be "chainId:uint256", e.g. "8453:42"'),
  txHash: z.string().startsWith('0x').length(66) as z.ZodType<`0x${string}`>,
})

/**
 * POST /agents/:id/register-onchain
 * Body: { agentId: "8453:42", txHash: "0x..." }
 *
 * Verifies the dev's register() tx is mined and minted the supplied agent ID
 * to the authenticated owner EOA. Persists agentId and agentWalletEoa.
 */
agentsRoute.post(
  '/agents/:id/register-onchain',
  jwtMiddleware(env.JWT_SECRET),
  zValidator('json', registerOnchainSchema),
  async (c) => {
    const claims = c.var.jwtClaims
    const ownerEoa = ((claims.ownerEoa as string) ?? claims.sub).toLowerCase()
    const id = c.req.param('id')
    const body = c.req.valid('json')

    const agent = await findAgentById(db, id)
    if (!agent) return c.json({ error: 'Agent not found' }, 404)
    if (agent.ownerEoa !== ownerEoa) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const [chainIdStr, tokenIdStr] = body.agentId.split(':')
    if (!chainIdStr || !tokenIdStr) {
      return c.json({ error: 'Malformed agentId' }, 400)
    }
    if (chainIdStr !== '8453') {
      return c.json({ error: 'Only Base mainnet (chainId 8453) is supported' }, 400)
    }
    const tokenId = BigInt(tokenIdStr)

    const receiptCheck = await checkRegisterReceipt({
      rpcUrl: env.BASE_RPC_URL,
      registryAddress: env.IDENTITY_REGISTRY_ADDRESS as `0x${string}`,
      txHash: body.txHash,
      expectedTokenId: tokenId,
      expectedTo: ownerEoa as `0x${string}`,
    })
    if (!receiptCheck.ok) {
      return c.json({ error: `Register tx verification failed: ${receiptCheck.reason}` }, 400)
    }

    const info = await getAgentWalletInfo({
      rpcUrl: env.BASE_RPC_URL,
      registryAddress: env.IDENTITY_REGISTRY_ADDRESS as `0x${string}`,
      agentId: tokenId,
    })
    if (info.ownerAddress.toLowerCase() !== ownerEoa) {
      return c.json(
        { error: 'On-chain ownerOf does not match the authenticated wallet' },
        403,
      )
    }

    // Spec §5.5: publish the ERC-8004 ↔ ENS link as an ENSIP-26 text record
    // `agent-registration[<chainId>][<tokenId>]: "1"`. Wallets that read this
    // record can verify on-chain that the subname owner is the registered
    // agent NFT holder. We merge into existing text_records so this survives
    // a later step-5 records edit.
    const registrationKey = `agent-registration[${chainIdStr}][${tokenIdStr}]`
    const mergedRecords: Record<string, string> = {
      ...((agent.textRecords as Record<string, string> | null) ?? {}),
      [registrationKey]: '1',
    }

    const updated = await updateAgent(db, id, {
      agentId: body.agentId,
      agentWalletEoa: info.agentWalletAddress.toLowerCase(),
      textRecords: mergedRecords,
    })

    return c.json({
      id: updated.id,
      agentId: updated.agentId,
      agentWalletEoa: updated.agentWalletEoa,
      textRecords: updated.textRecords,
    })
  },
)

import {
  checkSafeBytecode,
  checkSafeDeployTx,
} from '../lib/safe-bytecode.js'

const treasurySchema = z.object({
  safeAddress: z.string().startsWith('0x').length(42) as z.ZodType<`0x${string}`>,
  deployTxHash: z.string().startsWith('0x').length(66) as z.ZodType<`0x${string}`>,
})

/**
 * POST /agents/:id/treasury
 * Body: { safeAddress, deployTxHash }
 *
 * Verifies the deploy tx is mined and the bytecode at safeAddress is a Safe
 * proxy pointing at the canonical Base singleton.
 */
agentsRoute.post(
  '/agents/:id/treasury',
  jwtMiddleware(env.JWT_SECRET),
  zValidator('json', treasurySchema),
  async (c) => {
    const claims = c.var.jwtClaims
    const ownerEoa = ((claims.ownerEoa as string) ?? claims.sub).toLowerCase()
    const id = c.req.param('id')
    const body = c.req.valid('json')

    const agent = await findAgentById(db, id)
    if (!agent) return c.json({ error: 'Agent not found' }, 404)
    if (agent.ownerEoa !== ownerEoa) return c.json({ error: 'Forbidden' }, 403)

    const txCheck = await checkSafeDeployTx({
      rpcUrl: env.BASE_RPC_URL,
      txHash: body.deployTxHash,
    })
    if (!txCheck.ok) {
      return c.json({ error: `Safe deploy tx verification failed: ${txCheck.reason}` }, 400)
    }

    const codeCheck = await checkSafeBytecode({
      rpcUrl: env.BASE_RPC_URL,
      safeAddress: body.safeAddress,
    })
    if (!codeCheck.ok) {
      return c.json({ error: `Safe bytecode check failed: ${codeCheck.reason}` }, 400)
    }

    const updated = await updateAgent(db, id, {
      treasurySafeAddress: body.safeAddress.toLowerCase(),
    })

    return c.json({
      id: updated.id,
      treasurySafeAddress: updated.treasurySafeAddress,
    })
  },
)

const viewKeySchema = z.object({
  viewKey: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'viewKey must be 0x-prefixed 32-byte hex'),
  stealthMeta: z
    .string()
    .refine((v) => isStealthMetaAddress(v), 'stealthMeta must be 132-hex per ENSIP-26'),
})

agentsRoute.post(
  '/agents/:id/view-key',
  jwtMiddleware(env.JWT_SECRET),
  zValidator('json', viewKeySchema),
  async (c) => {
    const claims = c.var.jwtClaims
    const ownerEoa = ((claims.ownerEoa as string) ?? claims.sub).toLowerCase()
    const id = c.req.param('id')
    const force = c.req.query('force') === '1'
    const body = c.req.valid('json')

    const agent = await findAgentById(db, id)
    if (!agent) return c.json({ error: 'Agent not found' }, 404)
    if (agent.ownerEoa !== ownerEoa) return c.json({ error: 'Forbidden' }, 403)

    if (
      agent.viewKeyEncrypted &&
      agent.viewKeyEncrypted.startsWith('v1:') &&
      !force
    ) {
      return c.json(
        {
          error:
            'Agent already has a v1: view key. Pass ?force=1 to overwrite (DESTRUCTIVE).',
        },
        409,
      )
    }

    let envelope: string
    try {
      envelope = encryptForStorage(body.viewKey)
    } catch (err) {
      return c.json({ error: `viewKey encryption failed: ${String(err)}` }, 400)
    }

    const mergedRecords: Record<string, string> = {
      ...(agent.textRecords as Record<string, string>),
      'stealth-meta': body.stealthMeta,
    }

    const updated = await updateAgent(db, id, {
      viewKeyEncrypted: envelope,
      textRecords: mergedRecords,
    })

    return c.json({
      id: updated.id,
      viewKeyEncrypted: updated.viewKeyEncrypted,
      textRecords: updated.textRecords,
    })
  },
)

interface PaymentResponseRow {
  id: string
  agentId: string
  stealthAddress: string
  ephemeralPub: string
  txHash: string
  logIndex: number
  blockNumber: string
  tokenAddress: string
  amount: string
  fromAddress: string
  detectedAt: string
  receipt: {
    id: string
    confirmedByRecipient: boolean
    eip712Payload: string | null
    eip712Signature: string | null
    appendedResponseTx: string | null
    updatedAt: string
  } | null
}

function shapePayment(row: PaymentWithReceipt): PaymentResponseRow {
  return {
    id: row.id,
    agentId: row.agentId,
    stealthAddress: row.stealthAddress,
    ephemeralPub: row.ephemeralPub,
    txHash: row.txHash,
    logIndex: row.logIndex,
    blockNumber: row.blockNumber,
    tokenAddress: row.tokenAddress,
    amount: row.amount,
    fromAddress: row.fromAddress,
    detectedAt: row.detectedAt.toISOString(),
    receipt: row.receipt
      ? {
          id: row.receipt.id,
          confirmedByRecipient: row.receipt.confirmedByRecipient,
          eip712Payload: row.receipt.eip712Payload,
          eip712Signature: row.receipt.eip712Signature,
          appendedResponseTx: row.receipt.appendedResponseTx,
          updatedAt: row.receipt.updatedAt.toISOString(),
        }
      : null,
  }
}

/**
 * GET /agents/:id/payments
 *
 * Lists payments for the agent owner, newest-first. Cursored on
 * `?afterDetectedAt=ISO` for SSE-driven live feeds; capped at limit=200.
 */
agentsRoute.get('/agents/:id/payments', jwtMiddleware(env.JWT_SECRET), async (c) => {
  const claims = c.var.jwtClaims
  const ownerEoa = ((claims.ownerEoa as string) ?? claims.sub).toLowerCase()
  const id = c.req.param('id')

  const agent = await findAgentById(db, id)
  if (!agent) return c.json({ error: 'Agent not found' }, 404)
  if (agent.ownerEoa !== ownerEoa) return c.json({ error: 'Forbidden' }, 403)

  const url = new URL(c.req.url)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50), 1), 200)
  const afterRaw = url.searchParams.get('afterDetectedAt')
  const after = afterRaw ? new Date(afterRaw) : undefined
  if (after && Number.isNaN(after.getTime())) {
    return c.json({ error: 'afterDetectedAt must be ISO-8601' }, 400)
  }

  const rows = await listPaymentsByAgent(db, agent.id, { limit, afterDetectedAt: after })
  return c.json({
    agentId: agent.id,
    count: rows.length,
    payments: rows.map(shapePayment),
  })
})

const confirmReceiptSchema = z.object({
  confirmed: z.boolean(),
  eip712Payload: z.string().optional(),
  eip712Signature: z.string().optional(),
})

/**
 * POST /agents/:id/receipts/:paymentId/confirm
 *
 * UPSERTs the per-payment receipt with the supplied confirmed flag plus
 * optional eip712Payload + eip712Signature (Plan 7 fields, accepted but
 * not yet broadcast on-chain).
 */
agentsRoute.post(
  '/agents/:id/receipts/:paymentId/confirm',
  jwtMiddleware(env.JWT_SECRET),
  zValidator('json', confirmReceiptSchema),
  async (c) => {
    const claims = c.var.jwtClaims
    const ownerEoa = ((claims.ownerEoa as string) ?? claims.sub).toLowerCase()
    const id = c.req.param('id')
    const paymentId = c.req.param('paymentId')
    const body = c.req.valid('json')

    const agent = await findAgentById(db, id)
    if (!agent) return c.json({ error: 'Agent not found' }, 404)
    if (agent.ownerEoa !== ownerEoa) return c.json({ error: 'Forbidden' }, 403)

    const payment = await findPaymentById(db, paymentId)
    if (!payment || payment.agentId !== agent.id) {
      return c.json({ error: 'Payment not found' }, 404)
    }

    const receipt = await upsertReceipt(db, {
      paymentId,
      agentId: agent.id,
      confirmedByRecipient: body.confirmed,
      eip712Payload: body.eip712Payload ?? null,
      eip712Signature: body.eip712Signature ?? null,
    })

    return c.json({
      receipt: {
        id: receipt.id,
        paymentId: receipt.paymentId,
        confirmedByRecipient: receipt.confirmedByRecipient,
        eip712Payload: receipt.eip712Payload,
        eip712Signature: receipt.eip712Signature,
        appendedResponseTx: receipt.appendedResponseTx,
        updatedAt: receipt.updatedAt.toISOString(),
      },
    })
  },
)
