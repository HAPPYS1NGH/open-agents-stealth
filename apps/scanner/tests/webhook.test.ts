import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createDb,
  insertAgent,
  insertGatewayAnnouncement,
  listPaymentsByAgent,
} from '@open-agents/db'

const DB_URL = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
const SECRET = 'aabbccddeeff00112233445566778899'
process.env['DATABASE_URL'] = DB_URL
process.env['ALCHEMY_NOTIFY_SECRET'] = SECRET
process.env['SCANNER_WEBHOOK'] = 'on'

const RUN_TAG = Date.now().toString(16).slice(-8)
const STEALTH = ('0x' + RUN_TAG + 'fe'.repeat(16)).toLowerCase() as `0x${string}`
const EPH = '0x02' + RUN_TAG + '88'.repeat(28)
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const TX_A = ('0x' + RUN_TAG + 'a1'.repeat(28)) as `0x${string}`
let db: ReturnType<typeof createDb>
let agentRowId: string

beforeAll(async () => {
  db = createDb(DB_URL)
  const agent = await insertAgent(db, {
    ownerEoa: '0x0000000000000000000000000000000000000088',
    subnameLabel: 'wh-test-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000001',
  })
  agentRowId = agent.id
  await insertGatewayAnnouncement(db, {
    agentId: agentRowId,
    stealthAddress: STEALTH,
    ephemeralPub: EPH,
    viewTag: 0x42,
  })
})

afterAll(() => {})

function payload(activity: {
  from: string
  to: string
  hash: string
  logIndex: number
  blockHex: string
  amountHex: string
  contract?: string
}): string {
  const tokenAddr = activity.contract ?? USDC
  return JSON.stringify({
    webhookId: 'wh_test_42',
    type: 'ADDRESS_ACTIVITY',
    event: {
      network: 'BASE_MAINNET',
      activity: [
        {
          fromAddress: activity.from,
          toAddress: activity.to,
          blockNum: activity.blockHex,
          hash: activity.hash,
          log: { logIndex: activity.logIndex, address: tokenAddr, data: '0x', topics: ['0x'] },
          rawContract: { address: tokenAddr, decimals: 6, rawValue: activity.amountHex },
          category: 'token',
        },
      ],
    },
  })
}

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex')
}

async function postWebhook(body: string, signature: string): Promise<Response> {
  // Re-import so env reflects the values set above.
  const mod = (await import('../src/server.js?wh-test=' + Date.now())) as {
    default: { fetch: (req: Request) => Promise<Response> }
  }
  return mod.default.fetch(
    new Request('http://localhost/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-alchemy-signature': signature },
      body,
    }),
  )
}

describe('POST /webhook', () => {
  it('rejects bad signatures with 401', async () => {
    const body = payload({
      from: '0x' + 'be'.repeat(20),
      to: STEALTH,
      hash: ('0x' + RUN_TAG + 'aa'.repeat(28)) as `0x${string}`,
      logIndex: 0,
      blockHex: '0x1',
      amountHex: '0x1',
    })
    const res = await postWebhook(body, 'baadc0de')
    expect(res.status).toBe(401)
  })

  it('inserts payments for matched activity', async () => {
    const body = payload({
      from: '0x' + 'be'.repeat(20),
      to: STEALTH,
      hash: TX_A,
      logIndex: 2,
      blockHex: '0x1e6f',
      amountHex: '0xf4240', // 1_000_000 = 1 USDC
    })
    const res = await postWebhook(body, sign(body))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { inserted: number; decoded: number }
    expect(json.decoded).toBe(1)
    expect(json.inserted).toBe(1)

    const rows = await listPaymentsByAgent(db, agentRowId, { limit: 5 })
    expect(rows.find((r) => r.txHash === TX_A.toLowerCase())?.amount).toBe('1000000')
  })

  it('replays return ok with 0 inserted (idempotency)', async () => {
    const body = payload({
      from: '0x' + 'be'.repeat(20),
      to: STEALTH,
      hash: TX_A,
      logIndex: 2,
      blockHex: '0x1e6f',
      amountHex: '0xf4240',
    })
    const res = await postWebhook(body, sign(body))
    const json = (await res.json()) as { inserted: number; skipped: number }
    expect(json.inserted).toBe(0)
    expect(json.skipped).toBe(1)
  })

  it('ignores non-USDC activity (different token contract)', async () => {
    const otherToken = '0x' + '99'.repeat(20)
    const body = payload({
      from: '0x' + 'be'.repeat(20),
      to: STEALTH,
      hash: ('0x' + RUN_TAG + 'cc'.repeat(28)) as `0x${string}`,
      logIndex: 0,
      blockHex: '0x10',
      amountHex: '0x1',
      contract: otherToken,
    })
    const res = await postWebhook(body, sign(body))
    const json = (await res.json()) as { decoded: number; inserted: number }
    expect(json.decoded).toBe(0)
    expect(json.inserted).toBe(0)
  })
})
