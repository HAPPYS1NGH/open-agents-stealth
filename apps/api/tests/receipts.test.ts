import { beforeAll, describe, expect, it } from 'vitest'
import { mintJwt } from '@open-agents/auth'
import { createDb, insertAgent, insertPayment } from '@open-agents/db'

process.env['DATABASE_URL'] =
  'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
process.env['JWT_SECRET'] = 'test-secret-at-least-32-characters-here-xx'
process.env['VIEW_KEY_MASTER_KEY'] = '0x' + 'aa'.repeat(32)

const RUN_TAG = Date.now().toString(16).slice(-8)
const OWNER = '0x000000000000000000000000000000000000c1c1'

let app: { fetch: (req: Request) => Promise<Response> }
let agentId: string
let paymentId: string
let token: string

beforeAll(async () => {
  app = (await import('../src/server.js')).default
  const db = createDb(process.env['DATABASE_URL']!)
  const agent = await insertAgent(db, {
    ownerEoa: OWNER,
    subnameLabel: 'rcpt-api-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000001',
  })
  agentId = agent.id
  const payment = await insertPayment(db, {
    agentId,
    stealthAddress: '0x' + RUN_TAG + 'aa'.repeat(16),
    ephemeralPub: '0x02' + RUN_TAG + '11'.repeat(28),
    txHash: '0x' + RUN_TAG + 'rc' + 'pt'.repeat(28),
    logIndex: 0,
    blockNumber: '20000999',
    tokenAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    amount: '7000000',
    fromAddress: '0x' + 'be'.repeat(20),
  })
  paymentId = payment.id
  token = await mintJwt({
    sub: OWNER,
    ownerEoa: OWNER,
    secret: process.env['JWT_SECRET']!,
  })
})

async function postConfirm(body: unknown): Promise<Response> {
  return app.fetch(
    new Request(
      `http://localhost/agents/${agentId}/receipts/${paymentId}/confirm`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    ),
  )
}

describe('POST /agents/:id/receipts/:paymentId/confirm', () => {
  it('rejects body without confirmed boolean with 400', async () => {
    const res = await postConfirm({})
    expect(res.status).toBe(400)
  })

  it('returns 404 for non-existent paymentId', async () => {
    const res = await app.fetch(
      new Request(
        `http://localhost/agents/${agentId}/receipts/00000000-0000-0000-0000-000000000000/confirm`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ confirmed: true }),
        },
      ),
    )
    expect(res.status).toBe(404)
  })

  it('inserts a receipt on first call', async () => {
    const res = await postConfirm({
      confirmed: true,
      eip712Payload: '{"name":"OpenAgents","version":"1"}',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      receipt: { confirmedByRecipient: boolean; eip712Payload: string | null }
    }
    expect(body.receipt.confirmedByRecipient).toBe(true)
    expect(body.receipt.eip712Payload).toContain('OpenAgents')
  })

  it('toggles to false on a follow-up call (upsert)', async () => {
    const res = await postConfirm({ confirmed: false })
    const body = (await res.json()) as {
      receipt: { confirmedByRecipient: boolean; eip712Payload: string | null }
    }
    expect(body.receipt.confirmedByRecipient).toBe(false)
    expect(body.receipt.eip712Payload).toBeNull()
  })

  it('returns 401 without auth', async () => {
    const res = await app.fetch(
      new Request(
        `http://localhost/agents/${agentId}/receipts/${paymentId}/confirm`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ confirmed: true }),
        },
      ),
    )
    expect(res.status).toBe(401)
  })
})
