import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createDb,
  insertAgent,
  insertGatewayAnnouncement,
  listPaymentsByAgent,
} from '@open-agents/db'
import { runTick } from '../src/lib/run-tick.js'
import type { PublicClient } from 'viem'

const DB_URL = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
process.env['DATABASE_URL'] = DB_URL
process.env['SCANNER_RPC'] = 'off'
process.env['CRON_SECRET'] = ''

const RUN_TAG = Date.now().toString(16).slice(-8)

let db: ReturnType<typeof createDb>
let agentRowId: string
const STEALTH = ('0x' + RUN_TAG + 'aa'.repeat(16)).toLowerCase() as `0x${string}`
const EPH = '0x02' + RUN_TAG + 'aa'.repeat(28)

beforeAll(async () => {
  db = createDb(DB_URL)
  const agent = await insertAgent(db, {
    ownerEoa: '0x0000000000000000000000000000000000000077',
    subnameLabel: 'tick-test-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000001',
    textRecords: { 'stealth-meta': '0x' + 'aa'.repeat(33) + 'bb'.repeat(33) },
  })
  agentRowId = agent.id
  await insertGatewayAnnouncement(db, {
    agentId: agentRowId,
    stealthAddress: STEALTH,
    ephemeralPub: EPH,
    viewTag: 0x01,
  })
})

afterAll(() => {})

function fakeClient(opts: {
  block?: bigint
  logs?: Awaited<ReturnType<PublicClient['getLogs']>>
}) {
  // The fake honors the address filter so that runTick's per-agent loop
  // doesn't accidentally feed STEALTH logs into _other_ agents' iterations
  // (their reconciler would still match STEALTH against the global
  // announcements lookup and steal the insert).
  return {
    getBlockNumber: vi.fn(async () => opts.block ?? 30_000_500n),
    getLogs: vi.fn(async (params: { args?: { to?: readonly string[] } }) => {
      const filter = params?.args?.to ?? null
      const logs = opts.logs ?? []
      if (!filter || filter.length === 0) return logs
      const lower = new Set(filter.map((a) => a.toLowerCase()))
      return logs.filter((l) =>
        lower.has((l as { args: { to: string } }).args.to.toLowerCase()),
      )
    }),
  } as unknown as PublicClient
}

describe('runTick', () => {
  it('returns 0 inserted when no logs match', async () => {
    const result = await runTick({
      client: fakeClient({ block: 30_000_500n, logs: [] }),
      db,
      lookbackBlocks: 100n,
    })
    expect(result.agentsScanned).toBeGreaterThanOrEqual(1)
    const me = result.perAgent.find((p) => p.agentRowId === agentRowId)
    expect(me?.reconcile.inserted).toBe(0)
    expect(me?.reconcile.unmatched).toBe(0)
  })

  it('inserts payments when getLogs returns matched transfers', async () => {
    const log = {
      transactionHash: ('0x' + RUN_TAG + 'cc'.repeat(28)) as `0x${string}`,
      logIndex: 0,
      blockNumber: 30_000_499n,
      address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      args: {
        from: ('0x' + 'be'.repeat(20)) as `0x${string}`,
        to: STEALTH,
        value: 12_345_000n,
      },
    } as unknown as Awaited<ReturnType<PublicClient['getLogs']>>[number]
    const result = await runTick({
      client: fakeClient({ block: 30_000_500n, logs: [log] }),
      db,
      lookbackBlocks: 100n,
    })
    const me = result.perAgent.find((p) => p.agentRowId === agentRowId)
    expect(me?.reconcile.inserted).toBe(1)
    const rows = await listPaymentsByAgent(db, agentRowId, { limit: 5 })
    expect(rows[0]?.amount).toBe('12345000')
  })

  it('clamps the lookback when cursor is ahead of current block', async () => {
    // currentBlock < startBlock can happen if the local node is behind the
    // RPC; the tick must produce a no-op rather than a negative range.
    const result = await runTick({
      client: fakeClient({ block: 1n, logs: [] }),
      db,
      lookbackBlocks: 0n,
    })
    const me = result.perAgent.find((p) => p.agentRowId === agentRowId)
    expect(me?.logsFetched).toBe(0)
    expect(me?.reconcile.inserted).toBe(0)
  })
})

describe('POST /tick guard', () => {
  it('returns 401 when CRON_SECRET is set and bearer token mismatches', async () => {
    process.env['CRON_SECRET'] = 'secret-abc-1234567890'
    // Fresh import so `env` re-parses with the updated CRON_SECRET.
    const mod = await import('../src/routes/tick.js?guard-test=' + Date.now())
    const { Hono } = await import('hono')
    const app = new Hono().route('/', mod.tickRoute)
    const res = await app.request('/tick', { method: 'POST' })
    expect(res.status).toBe(401)
    process.env['CRON_SECRET'] = ''
  })
})
