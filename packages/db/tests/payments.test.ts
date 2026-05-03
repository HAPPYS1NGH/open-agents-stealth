import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createDb,
  insertAgent,
  insertGatewayAnnouncement,
  insertPayment,
  listPaymentsByAgent,
  findPaymentById,
  paymentExistsByTxLog,
  maxScannedBlockForAgent,
  deleteAnnouncementsOlderThan,
} from '../src/index.js'

const DB_URL = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
let db: ReturnType<typeof createDb>
let agentRowId: string

beforeAll(async () => {
  db = createDb(DB_URL)
  const agent = await insertAgent(db, {
    ownerEoa: '0x0000000000000000000000000000000000000044',
    subnameLabel: 'pay-test-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000001',
  })
  agentRowId = agent.id
  await insertGatewayAnnouncement(db, {
    agentId: agentRowId,
    stealthAddress: '0x' + 'aa'.repeat(20),
    ephemeralPub: '0x02' + '11'.repeat(32),
    viewTag: 0x01,
  })
})

afterAll(async () => {
  await deleteAnnouncementsOlderThan(db, new Date(Date.now() + 1000 * 60 * 60))
})

describe('payments queries', () => {
  it('inserts and reads back', async () => {
    const row = await insertPayment(db, {
      agentId: agentRowId,
      stealthAddress: '0x' + 'aa'.repeat(20),
      ephemeralPub: '0x02' + '11'.repeat(32),
      txHash: '0x' + 'cd'.repeat(32),
      logIndex: 7,
      blockNumber: '20000000',
      tokenAddress: USDC,
      amount: '5000000', // 5 USDC
      fromAddress: '0x' + 'be'.repeat(20),
    })
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/)

    const back = await findPaymentById(db, row.id)
    expect(back?.amount).toBe('5000000')
    expect(back?.tokenAddress).toBe(USDC)
  })

  it('rejects duplicate (tx_hash, log_index)', async () => {
    const dupTx = '0x' + 'ee'.repeat(32)
    await insertPayment(db, {
      agentId: agentRowId,
      stealthAddress: '0x' + 'bb'.repeat(20),
      ephemeralPub: '0x02' + '22'.repeat(32),
      txHash: dupTx,
      logIndex: 3,
      blockNumber: '20000005',
      tokenAddress: USDC,
      amount: '1000000',
      fromAddress: '0x' + 'be'.repeat(20),
    })
    await expect(
      insertPayment(db, {
        agentId: agentRowId,
        stealthAddress: '0x' + 'cc'.repeat(20),
        ephemeralPub: '0x02' + '33'.repeat(32),
        txHash: dupTx,
        logIndex: 3,
        blockNumber: '20000005',
        tokenAddress: USDC,
        amount: '7777',
        fromAddress: '0x' + 'be'.repeat(20),
      }),
    ).rejects.toThrow()
  })

  it('paymentExistsByTxLog short-circuits the reconciler', async () => {
    const probeTx = '0x' + '99'.repeat(32)
    expect(await paymentExistsByTxLog(db, probeTx, 0)).toBe(false)
    await insertPayment(db, {
      agentId: agentRowId,
      stealthAddress: '0x' + 'dd'.repeat(20),
      ephemeralPub: '0x02' + '44'.repeat(32),
      txHash: probeTx,
      logIndex: 0,
      blockNumber: '20000010',
      tokenAddress: USDC,
      amount: '1',
      fromAddress: '0x' + 'be'.repeat(20),
    })
    expect(await paymentExistsByTxLog(db, probeTx, 0)).toBe(true)
  })

  it('lists payments for an agent newest-first', async () => {
    const rows = await listPaymentsByAgent(db, agentRowId, { limit: 50 })
    expect(rows.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.detectedAt.getTime()).toBeGreaterThanOrEqual(
        rows[i]!.detectedAt.getTime(),
      )
    }
    expect(rows[0]!.receipt).toBeNull()
  })

  it('maxScannedBlockForAgent returns the highest block', async () => {
    const max = await maxScannedBlockForAgent(db, agentRowId)
    expect(max).toBeGreaterThanOrEqual(20000010n)
  })
})
