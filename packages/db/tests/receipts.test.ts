import { beforeAll, describe, expect, it } from 'vitest'
import {
  createDb,
  insertAgent,
  insertPayment,
  upsertReceipt,
  findReceiptByPayment,
  findReceiptByIdForAgent,
} from '../src/index.js'

const DB_URL = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
let db: ReturnType<typeof createDb>
let agentRowId: string
let paymentId: string

beforeAll(async () => {
  db = createDb(DB_URL)
  const agent = await insertAgent(db, {
    ownerEoa: '0x0000000000000000000000000000000000000045',
    subnameLabel: 'rcpt-test-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000001',
  })
  agentRowId = agent.id
  const payment = await insertPayment(db, {
    agentId: agentRowId,
    stealthAddress: '0x' + 'aa'.repeat(20),
    ephemeralPub: '0x02' + '55'.repeat(32),
    txHash: '0x' + 'aa'.repeat(32),
    logIndex: 1,
    blockNumber: '20000020',
    tokenAddress: USDC,
    amount: '1000',
    fromAddress: '0x' + 'be'.repeat(20),
  })
  paymentId = payment.id
})

describe('receipts queries', () => {
  it('upsert inserts on first call', async () => {
    const r = await upsertReceipt(db, {
      paymentId,
      agentId: agentRowId,
      confirmedByRecipient: true,
      eip712Payload: JSON.stringify({ foo: 'bar' }),
    })
    expect(r.confirmedByRecipient).toBe(true)
    expect(r.eip712Payload).toContain('foo')
  })

  it('upsert toggles on second call (same payment_id)', async () => {
    const before = await findReceiptByPayment(db, paymentId)
    expect(before?.confirmedByRecipient).toBe(true)

    const r = await upsertReceipt(db, {
      paymentId,
      agentId: agentRowId,
      confirmedByRecipient: false,
    })
    expect(r.confirmedByRecipient).toBe(false)
    expect(r.eip712Payload).toBeNull()

    // updatedAt advanced.
    expect(r.updatedAt.getTime()).toBeGreaterThanOrEqual(before!.updatedAt.getTime())
  })

  it('findReceiptByIdForAgent scopes correctly', async () => {
    const before = await findReceiptByPayment(db, paymentId)
    const found = await findReceiptByIdForAgent(db, before!.id, agentRowId)
    expect(found?.id).toBe(before!.id)

    const notFound = await findReceiptByIdForAgent(
      db,
      before!.id,
      '00000000-0000-0000-0000-000000000000',
    )
    expect(notFound).toBeNull()
  })
})
