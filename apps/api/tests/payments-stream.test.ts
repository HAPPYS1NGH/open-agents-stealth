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
const OWNER = '0x000000000000000000000000000000000000d1d1'

let app: { fetch: (req: Request) => Promise<Response> }
let db: ReturnType<typeof createDb>
let agentId: string
let token: string

beforeAll(async () => {
  app = (await import('../src/server.js')).default
  db = createDb(process.env['DATABASE_URL']!)
  const agent = await insertAgent(db, {
    ownerEoa: OWNER,
    subnameLabel: 'sse-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000001',
  })
  agentId = agent.id
  await insertGatewayAnnouncement(db, {
    agentId,
    stealthAddress: '0x' + RUN_TAG + 'aa'.repeat(16),
    ephemeralPub: '0x02' + RUN_TAG + '11'.repeat(28),
    viewTag: 0x01,
  })
  token = await mintJwt({
    sub: OWNER,
    ownerEoa: OWNER,
    secret: process.env['JWT_SECRET']!,
  })
})

async function readSSEUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (chunk: string) => boolean,
  timeoutMs = 6000,
): Promise<string> {
  const decoder = new TextDecoder()
  let buffer = ''
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    if (predicate(buffer)) return buffer
  }
  throw new Error('readSSEUntil timed out; buffer=' + buffer)
}

describe('GET /agents/:id/payments/stream', () => {
  it('rejects requests without ?token=', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/agents/${agentId}/payments/stream`),
    )
    expect(res.status).toBe(401)
  })

  it('opens with a hello event and streams subsequent payments', async () => {
    const since = new Date(Date.now() - 60_000).toISOString()
    const res = await app.fetch(
      new Request(
        `http://localhost/agents/${agentId}/payments/stream?token=${encodeURIComponent(token)}&since=${encodeURIComponent(since)}`,
      ),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const reader = res.body!.getReader()
    const helloChunk = await readSSEUntil(reader, (b) => b.includes('event: hello'))
    expect(helloChunk).toContain('event: hello')

    // Insert a payment AFTER the stream is open.
    await insertPayment(db, {
      agentId,
      stealthAddress: '0x' + RUN_TAG + 'aa'.repeat(16),
      ephemeralPub: '0x02' + RUN_TAG + '11'.repeat(28),
      txHash: '0x' + RUN_TAG + 'sse' + 'aa'.repeat(28),
      logIndex: 0,
      blockNumber: '20009999',
      tokenAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      amount: '4242000',
      fromAddress: '0x' + 'be'.repeat(20),
    })

    const paymentChunk = await readSSEUntil(reader, (b) =>
      b.includes('event: payment'),
    )
    expect(paymentChunk).toContain('"amount":"4242000"')

    await reader.cancel()
  }, 10_000)

  it('returns 403 for an agent the caller does not own', async () => {
    const stranger = await mintJwt({
      sub: '0x' + 'ee'.repeat(20),
      ownerEoa: '0x' + 'ee'.repeat(20),
      secret: process.env['JWT_SECRET']!,
    })
    const res = await app.fetch(
      new Request(
        `http://localhost/agents/${agentId}/payments/stream?token=${encodeURIComponent(stranger)}`,
      ),
    )
    expect(res.status).toBe(403)
  })
})
