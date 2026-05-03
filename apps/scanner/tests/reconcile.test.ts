import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createDb,
  insertAgent,
  insertGatewayAnnouncement,
  listPaymentsByAgent,
  paymentExistsByTxLog,
} from '@open-agents/db'
import { reconcileLogsToPayments } from '../src/lib/reconcile.js'
import { BASE_USDC_ADDRESS } from '../src/lib/usdc.js'
import type { DecodedTransferLog } from '../src/lib/log-fetcher.js'

const DB_URL = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
process.env['DATABASE_URL'] = DB_URL

let db: ReturnType<typeof createDb>
let agentRowId: string

// Make all addresses + ephemeral keys unique per test run so re-runs against
// the persisted Postgres don't collide with prior data.
const RUN_TAG = Date.now().toString(16).padStart(8, '0')
function unique(prefix: string, hexLen: number): `0x${string}` {
  // hexLen is in hex characters (not bytes). Pad with run tag + zeros to fit.
  const body = (RUN_TAG + prefix).padEnd(hexLen, '0').slice(0, hexLen)
  return ('0x' + body) as `0x${string}`
}
const STEALTH_A = unique('aaaaaaaa', 40)
const STEALTH_B = unique('bbbbbbbb', 40)
const EPH_A = '0x02' + RUN_TAG + '11'.repeat(28)
const EPH_B = '0x03' + RUN_TAG + '22'.repeat(28)
const TX_PREFIX = RUN_TAG // injected into every tx hash so they're unique
function makeTx(suffix: string): `0x${string}` {
  return ('0x' + TX_PREFIX + suffix).padEnd(66, '0').slice(0, 66) as `0x${string}`
}

beforeAll(async () => {
  db = createDb(DB_URL)
  const agent = await insertAgent(db, {
    ownerEoa: '0x0000000000000000000000000000000000000055',
    subnameLabel: 'rec-test-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000001',
  })
  agentRowId = agent.id
  await insertGatewayAnnouncement(db, {
    agentId: agentRowId,
    stealthAddress: STEALTH_A,
    ephemeralPub: EPH_A,
    viewTag: 0x01,
  })
  await insertGatewayAnnouncement(db, {
    agentId: agentRowId,
    stealthAddress: STEALTH_B,
    ephemeralPub: EPH_B,
    viewTag: 0x02,
  })
})

afterAll(() => {
  // payments cascade-deletes when the test agent is purged by the next runner.
})

function makeLog(opts: {
  to: `0x${string}`
  from?: `0x${string}`
  amount?: bigint
  tx?: `0x${string}`
  logIdx?: number
  block?: bigint
}): DecodedTransferLog {
  return {
    transactionHash: opts.tx ?? (`0x${'cc'.repeat(32)}` as `0x${string}`),
    logIndex: opts.logIdx ?? 0,
    blockNumber: opts.block ?? 20_000_100n,
    address: BASE_USDC_ADDRESS,
    args: {
      from: (opts.from ?? `0x${'be'.repeat(20)}`) as `0x${string}`,
      to: opts.to,
      value: opts.amount ?? 5_000_000n,
    },
  }
}

describe('reconcileLogsToPayments', () => {
  it('inserts one payment per matched log', async () => {
    const logs = [
      makeLog({ to: STEALTH_A, tx: makeTx('aa01'), logIdx: 0 }),
      makeLog({ to: STEALTH_B, tx: makeTx('aa01'), logIdx: 1 }),
    ]
    const summary = await reconcileLogsToPayments({
      db,
      logs,
      tokenAddress: BASE_USDC_ADDRESS,
    })
    expect(summary.inserted).toBe(2)
    expect(summary.skipped).toBe(0)
    expect(summary.unmatched).toBe(0)

    const rows = await listPaymentsByAgent(db, agentRowId, { limit: 50 })
    const matchA = rows.find((r) => r.stealthAddress === STEALTH_A)
    expect(matchA?.amount).toBe('5000000')
    expect(matchA?.ephemeralPub).toBe(EPH_A)
  })

  it('is idempotent (re-running same logs inserts 0)', async () => {
    const logs = [makeLog({ to: STEALTH_A, tx: makeTx('aa01'), logIdx: 0 })]
    const summary = await reconcileLogsToPayments({
      db,
      logs,
      tokenAddress: BASE_USDC_ADDRESS,
    })
    expect(summary.inserted).toBe(0)
    expect(summary.skipped).toBe(1)
  })

  it('skips logs whose `to` is not in any announcement', async () => {
    const orphan = unique('ffffffff', 40)
    const summary = await reconcileLogsToPayments({
      db,
      logs: [makeLog({ to: orphan, tx: makeTx('77'), logIdx: 0 })],
      tokenAddress: BASE_USDC_ADDRESS,
    })
    expect(summary.inserted).toBe(0)
    expect(summary.unmatched).toBe(1)
  })

  it('handles many logs in a single call', async () => {
    const logs: DecodedTransferLog[] = []
    for (let i = 0; i < 20; i++) {
      logs.push(
        makeLog({
          to: STEALTH_A,
          tx: makeTx('m' + i.toString(16).padStart(2, '0')),
          logIdx: 0,
          block: 20_000_200n + BigInt(i),
        }),
      )
    }
    const summary = await reconcileLogsToPayments({
      db,
      logs,
      tokenAddress: BASE_USDC_ADDRESS,
    })
    expect(summary.inserted).toBe(20)
    for (const log of logs) {
      expect(await paymentExistsByTxLog(db, log.transactionHash, log.logIndex)).toBe(true)
    }
  })
})
