import { Hono } from 'hono'
import { z } from 'zod'
import { createDb } from '@open-agents/db'
import { env } from '../env.js'
import { verifyAlchemySignature } from '../lib/webhook-verify.js'
import { reconcileLogsToPayments } from '../lib/reconcile.js'
import { BASE_USDC_ADDRESS } from '../lib/usdc.js'
import type { DecodedTransferLog } from '../lib/log-fetcher.js'

export const webhookRoute = new Hono()

/**
 * Alchemy "Address Activity" payload — only the fields we consume.
 * Full schema: https://docs.alchemy.com/reference/address-activity-webhook
 *
 * One push can carry multiple activities (e.g., a tx with two transfers to
 * watched addresses). We normalize each `activity` entry into the same
 * DecodedTransferLog shape the cron path uses.
 */
// `0x` + zero-or-more hex chars (some Alchemy fields legitimately come back
// as bare `0x` — log.data for tokenless events, sometimes topics[0]).
const optionalHexBytes = z.string().regex(/^0x[0-9a-fA-F]*$/)
const requiredHexBytes = z.string().regex(/^0x[0-9a-fA-F]+$/)
const hexAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const hexHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/)

const ActivitySchema = z.object({
  fromAddress: hexAddress,
  toAddress: hexAddress,
  blockNum: requiredHexBytes,
  hash: hexHash,
  log: z
    .object({
      logIndex: z.union([z.string(), z.number()]),
      address: hexAddress,
      data: optionalHexBytes,
      topics: z.array(optionalHexBytes).min(1),
    })
    .optional(),
  rawContract: z
    .object({
      address: hexAddress,
      decimals: z.number().optional(),
      rawValue: requiredHexBytes,
    })
    .optional(),
  category: z.string().optional(),
})

const PayloadSchema = z.object({
  webhookId: z.string(),
  type: z.literal('ADDRESS_ACTIVITY'),
  event: z.object({
    network: z.string(),
    activity: z.array(ActivitySchema),
  }),
})

function alchemyToDecodedLog(a: z.infer<typeof ActivitySchema>): DecodedTransferLog | null {
  // Skip activities that aren't ERC-20 transfers we can read amount from.
  if (!a.rawContract?.rawValue) return null
  if (a.rawContract.address.toLowerCase() !== BASE_USDC_ADDRESS.toLowerCase()) return null

  const logIndex =
    typeof a.log?.logIndex === 'number'
      ? a.log.logIndex
      : a.log?.logIndex
        ? Number.parseInt(a.log.logIndex, 16)
        : 0

  return {
    transactionHash: a.hash as `0x${string}`,
    logIndex,
    blockNumber: BigInt(a.blockNum),
    address: a.rawContract.address as `0x${string}`,
    args: {
      from: a.fromAddress as `0x${string}`,
      to: a.toAddress as `0x${string}`,
      value: BigInt(a.rawContract.rawValue),
    },
  }
}

webhookRoute.post('/webhook', async (c) => {
  if (env.SCANNER_WEBHOOK === 'off') {
    // Self-host opted out — accept the push but do nothing.
    return c.json({ ok: true, skipped: 'SCANNER_WEBHOOK=off' })
  }

  if (!env.ALCHEMY_NOTIFY_SECRET) {
    console.error('[webhook] ALCHEMY_NOTIFY_SECRET is unset; refusing to accept payloads')
    // 200 still — we don't want Alchemy retry storms while we fix env.
    return c.json({ ok: true, skipped: 'secret not configured' })
  }

  const rawBody = await c.req.text()
  const ok = verifyAlchemySignature({
    rawBody,
    signatureHeader: c.req.header('x-alchemy-signature'),
    secret: env.ALCHEMY_NOTIFY_SECRET,
  })
  if (!ok) {
    console.warn('[webhook] signature verification failed')
    return c.json({ error: 'Invalid signature' }, 401)
  }

  let parsed: z.infer<typeof PayloadSchema>
  try {
    parsed = PayloadSchema.parse(JSON.parse(rawBody))
  } catch (err) {
    const detail = err instanceof z.ZodError ? JSON.stringify(err.issues) : String(err)
    console.warn('[webhook] payload parse failed', detail)
    return c.json({ ok: true, skipped: 'unparseable payload', detail })
  }

  const logs: DecodedTransferLog[] = []
  for (const activity of parsed.event.activity) {
    const log = alchemyToDecodedLog(activity)
    if (log) logs.push(log)
  }
  if (logs.length === 0) {
    return c.json({ ok: true, decoded: 0, inserted: 0 })
  }

  const db = createDb(env.DATABASE_URL)
  const summary = await reconcileLogsToPayments({
    db,
    logs,
    tokenAddress: BASE_USDC_ADDRESS,
  })

  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'webhook reconciled',
      webhookId: parsed.webhookId,
      decoded: logs.length,
      ...summary,
    }),
  )

  return c.json({ ok: true, decoded: logs.length, ...summary })
})
