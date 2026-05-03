import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { verifyJwt } from '@open-agents/auth'
import { findAgentById, listPaymentsByAgent } from '@open-agents/db'
import { env } from '../env.js'
import { db } from '../server.js'

export const paymentsStreamRoute = new Hono()

const POLL_INTERVAL_MS = 1500
const MAX_STREAM_DURATION_MS = 9 * 60 * 1000 // < Vercel 10-min function cap

/**
 * GET /agents/:id/payments/stream
 *
 * Server-Sent Events feed of new payment rows. The dashboard's
 * EventSource consumer subscribes here and merges each `payment` event
 * into its SWR cache.
 *
 * Auth: ?token=<jwt> query param. EventSource cannot send custom
 * headers, so the Authorization header pattern doesn't work here. The
 * 15-min JWT TTL bounds the URL-leak blast radius.
 *
 * Loop: every POLL_INTERVAL_MS we query for payments newer than the
 * running anchor, emit each as a `payment` event, advance anchor.
 * `ping` events flow every cycle to keep proxies from idling out the
 * connection. Hard cap at MAX_STREAM_DURATION_MS so the client
 * transparently reconnects before Vercel kills the function.
 */
paymentsStreamRoute.get('/agents/:id/payments/stream', async (c) => {
  const url = new URL(c.req.url)
  const token = url.searchParams.get('token')
  if (!token) return c.json({ error: 'token query param required' }, 401)

  let claims
  try {
    claims = await verifyJwt({ token, secret: env.JWT_SECRET })
  } catch {
    return c.json({ error: 'Invalid token' }, 401)
  }

  const ownerEoa = ((claims.ownerEoa as string) ?? claims.sub).toLowerCase()
  const id = c.req.param('id')
  const agent = await findAgentById(db, id)
  if (!agent) return c.json({ error: 'Agent not found' }, 404)
  if (agent.ownerEoa !== ownerEoa) return c.json({ error: 'Forbidden' }, 403)

  const sinceParam = url.searchParams.get('since')
  let anchor = sinceParam ? new Date(sinceParam) : new Date()
  if (Number.isNaN(anchor.getTime())) {
    return c.json({ error: 'since must be ISO-8601' }, 400)
  }

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      event: 'hello',
      data: JSON.stringify({ agentId: agent.id, anchor: anchor.toISOString() }),
    })

    const startedAt = Date.now()
    while (!stream.aborted && Date.now() - startedAt < MAX_STREAM_DURATION_MS) {
      const fresh = await listPaymentsByAgent(db, agent.id, {
        afterDetectedAt: anchor,
        limit: 50,
      })

      // listPaymentsByAgent returns newest-first; reverse so we emit
      // oldest-first and the running anchor advances monotonically.
      for (const row of [...fresh].reverse()) {
        await stream.writeSSE({
          event: 'payment',
          id: row.id,
          data: JSON.stringify({
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
                  updatedAt: row.receipt.updatedAt.toISOString(),
                }
              : null,
          }),
        })
        anchor = row.detectedAt
      }

      await stream.writeSSE({ event: 'ping', data: String(Date.now()) })
      await stream.sleep(POLL_INTERVAL_MS)
    }

    await stream.writeSSE({ event: 'bye', data: 'stream-closed' })
  })
})
