import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createDb,
  insertAgent,
  insertGatewayAnnouncement,
  insertPayment,
} from '@open-agents/db'
import { computeStartBlock, fetchActiveScanTargets } from '../src/lib/checkpoint.js'

const DB_URL = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
process.env['DATABASE_URL'] = DB_URL
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const RUN_TAG = Date.now().toString(16).slice(-8)

let db: ReturnType<typeof createDb>
let agentWithMeta: string
let agentWithoutMeta: string

beforeAll(async () => {
  db = createDb(DB_URL)
  const a = await insertAgent(db, {
    ownerEoa: '0x0000000000000000000000000000000000000066',
    subnameLabel: 'ck-meta-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000001',
    textRecords: { 'stealth-meta': '0x' + 'aa'.repeat(33) + 'bb'.repeat(33) },
  })
  agentWithMeta = a.id
  // fetchActiveScanTargets requires at least one announcement per agent.
  await insertGatewayAnnouncement(db, {
    agentId: agentWithMeta,
    stealthAddress: '0x' + RUN_TAG + 'cc'.repeat(16),
    ephemeralPub: '0x02' + RUN_TAG + 'dd'.repeat(28),
    viewTag: 0x07,
  })
  const b = await insertAgent(db, {
    ownerEoa: '0x0000000000000000000000000000000000000067',
    subnameLabel: 'ck-nometa-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000001',
  })
  agentWithoutMeta = b.id
})

afterAll(() => {
  // cascade cleanup on agent purge
})

describe('computeStartBlock', () => {
  it('falls back to currentBlock - lookback when no payments exist', async () => {
    const start = await computeStartBlock({
      db,
      agentRowId: agentWithMeta,
      currentBlock: 30_000_000n,
      lookback: 3000n,
    })
    expect(start).toBe(30_000_000n - 3000n)
  })

  it('uses MAX(block_number) + 1 when payments exist', async () => {
    await insertPayment(db, {
      agentId: agentWithMeta,
      stealthAddress: '0x' + RUN_TAG + 'aa'.repeat(16),
      ephemeralPub: '0x02' + RUN_TAG + '11'.repeat(28),
      txHash: '0x' + RUN_TAG + 'ck01'.padEnd(56, '0'),
      logIndex: 0,
      blockNumber: '20500000',
      tokenAddress: USDC,
      amount: '1',
      fromAddress: '0x' + 'be'.repeat(20),
    })
    const start = await computeStartBlock({
      db,
      agentRowId: agentWithMeta,
      currentBlock: 30_000_000n,
      lookback: 3000n,
    })
    expect(start).toBe(20_500_001n)
  })

  it('caps fallback at 0 when currentBlock < lookback', async () => {
    const start = await computeStartBlock({
      db,
      agentRowId: agentWithoutMeta,
      currentBlock: 100n,
      lookback: 3000n,
    })
    expect(start).toBe(0n)
  })
})

describe('fetchActiveScanTargets', () => {
  it('returns only agents with a valid stealth-meta record', async () => {
    const targets = await fetchActiveScanTargets(db)
    const ids = new Set(targets.map((t) => t.agentRowId))
    expect(ids.has(agentWithMeta)).toBe(true)
    expect(ids.has(agentWithoutMeta)).toBe(false)
  })

  it('returns at least one stealth address per agent if announcements exist', async () => {
    const targets = await fetchActiveScanTargets(db)
    const target = targets.find((t) => t.agentRowId === agentWithMeta)
    expect(target).toBeDefined()
    expect(Array.isArray(target!.stealthAddresses)).toBe(true)
    expect(target!.stealthAddresses.length).toBeGreaterThan(0)
  })
})
