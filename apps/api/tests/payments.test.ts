import { beforeAll, describe, expect, it } from 'vitest'
import { mintJwt } from '@open-agents/auth'
import {
  createDb,
  insertAgent,
  insertGatewayAnnouncement,
  insertPayment,
} from '@open-agents/db'

process.env['DATABASE_URL'] =
  'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
process.env['JWT_SECRET'] = 'test-secret-at-least-32-characters-here-xx'
process.env['VIEW_KEY_MASTER_KEY'] = '0x' + 'aa'.repeat(32)

const RUN_TAG = Date.now().toString(16).slice(-8)
const OWNER = '0x000000000000000000000000000000000000a1a1'
const STRANGER = '0x000000000000000000000000000000000000b1b1'

let app: { fetch: (req: Request) => Promise<Response> }
let agentId: string
let token: string

beforeAll(async () => {
  app = (await import('../src/server.js')).default
  const db = createDb(process.env['DATABASE_URL']!)
  const agent = await insertAgent(db, {
    ownerEoa: OWNER,
    subnameLabel: 'pay-api-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000001',
  })
  agentId = agent.id
  await insertGatewayAnnouncement(db, {
    agentId,
    stealthAddress: '0x' + RUN_TAG + 'aa'.repeat(16),
    ephemeralPub: '0x02' + RUN_TAG + '11'.repeat(28),
    viewTag: 0x01,
  })
  for (let i = 0; i < 3; i++) {
    await insertPayment(db, {
      agentId,
      stealthAddress: '0x' + RUN_TAG + 'aa'.repeat(16),
      ephemeralPub: '0x02' + RUN_TAG + '11'.repeat(28),
      txHash:
        '0x' + RUN_TAG + 'pay' + i.toString(16).padStart(2, '0').repeat(28),
      logIndex: 0,
      blockNumber: String(20_000_000 + i),
      tokenAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      amount: String(1_000_000 * (i + 1)),
      fromAddress: '0x' + 'be'.repeat(20),
    })
  }
  token = await mintJwt({
    sub: OWNER,
    ownerEoa: OWNER,
    secret: process.env['JWT_SECRET']!,
  })
})

async function getPayments(authToken: string, query = ''): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost/agents/${agentId}/payments${query}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${authToken}` },
    }),
  )
}

describe('GET /agents/:id/payments', () => {
  it("returns the agent owner's payments newest-first", async () => {
    const res = await getPayments(token)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      count: number
      payments: Array<{ amount: string; detectedAt: string }>
    }
    expect(body.count).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < body.payments.length; i++) {
      expect(
        body.payments[i - 1]!.detectedAt >= body.payments[i]!.detectedAt,
      ).toBe(true)
    }
  })

  it('honors limit query param', async () => {
    const res = await getPayments(token, '?limit=2')
    const body = (await res.json()) as { count: number }
    expect(body.count).toBe(2)
  })

  it('rejects bad afterDetectedAt with 400', async () => {
    const res = await getPayments(token, '?afterDetectedAt=not-a-date')
    expect(res.status).toBe(400)
  })

  it('returns 403 when caller does not own the agent', async () => {
    const otherToken = await mintJwt({
      sub: STRANGER,
      ownerEoa: STRANGER,
      secret: process.env['JWT_SECRET']!,
    })
    const res = await getPayments(otherToken)
    expect(res.status).toBe(403)
  })

  it('rejects unauthenticated requests with 401', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/agents/${agentId}/payments`, { method: 'GET' }),
    )
    expect(res.status).toBe(401)
  })

  it('shapes the response with isoformat timestamps and string amounts', async () => {
    const res = await getPayments(token, '?limit=1')
    const body = (await res.json()) as {
      payments: Array<{ amount: string; detectedAt: string; receipt: unknown }>
    }
    const first = body.payments[0]!
    expect(typeof first.amount).toBe('string')
    expect(first.detectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(first.receipt).toBeNull()
  })
})
