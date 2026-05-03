import type { PublicClient } from 'viem'
import { createDb, type DbClient } from '@open-agents/db'
import { env } from '../env.js'
import {
  computeStartBlock,
  fetchActiveScanTargets,
  type ScanTarget,
} from './checkpoint.js'
import { fetchTransferLogsToAddresses } from './log-fetcher.js'
import { reconcileLogsToPayments, type ReconcileSummary } from './reconcile.js'
import { BASE_USDC_ADDRESS } from './usdc.js'

/**
 * Structural subset of viem's PublicClient covering only the methods runTick
 * actually invokes. Avoids "two different types with this name" friction
 * between the `PublicClient` produced by createPublicClient (in rpc.ts) and
 * the broad `PublicClient` interface — they're nominally identical but
 * structurally diverge under viem's chain generic.
 */
export interface ScannerRpcClient {
  getBlockNumber: PublicClient['getBlockNumber']
  getLogs: PublicClient['getLogs']
}

export interface PerAgentTick {
  agentRowId: string
  startBlock: string
  endBlock: string
  logsFetched: number
  reconcile: ReconcileSummary
}

export interface TickResult {
  scannedAt: string
  currentBlock: string
  agentsScanned: number
  perAgent: PerAgentTick[]
}

export interface RunTickArgs {
  /** Override for tests — defaults to the singleton getRpcClient(). */
  client: ScannerRpcClient
  /** Override for tests — defaults to a fresh createDb(env.DATABASE_URL). */
  db?: DbClient
  /** Override for tests; defaults to env.SCAN_LOOKBACK_BLOCKS. */
  lookbackBlocks?: bigint
  /** Override the active-target fetch — useful for unit tests. */
  targetsOverride?: ScanTarget[]
}

/**
 * Single-pass scan over every active agent. Per agent: derive start block,
 * fetch logs in chunks, reconcile against gateway_announcements, summarize.
 *
 * The bigints are stringified in the result so the response can be JSON.stringify'd
 * by Hono without a custom serializer.
 */
export async function runTick(args: RunTickArgs): Promise<TickResult> {
  const db = args.db ?? createDb(env.DATABASE_URL)
  const lookback = args.lookbackBlocks ?? BigInt(env.SCAN_LOOKBACK_BLOCKS)

  const currentBlock = await args.client.getBlockNumber()
  const targets = args.targetsOverride ?? (await fetchActiveScanTargets(db))

  const perAgent: PerAgentTick[] = []
  for (const target of targets) {
    const startBlock = await computeStartBlock({
      db,
      agentRowId: target.agentRowId,
      currentBlock,
      lookback,
    })
    if (startBlock > currentBlock) {
      perAgent.push({
        agentRowId: target.agentRowId,
        startBlock: startBlock.toString(),
        endBlock: currentBlock.toString(),
        logsFetched: 0,
        reconcile: { inserted: 0, skipped: 0, unmatched: 0 },
      })
      continue
    }

    const logs = await fetchTransferLogsToAddresses({
      client: args.client,
      addresses: target.stealthAddresses,
      contract: BASE_USDC_ADDRESS,
      fromBlock: startBlock,
      toBlock: currentBlock,
    })

    const reconcile = await reconcileLogsToPayments({
      db,
      logs,
      tokenAddress: BASE_USDC_ADDRESS,
    })

    perAgent.push({
      agentRowId: target.agentRowId,
      startBlock: startBlock.toString(),
      endBlock: currentBlock.toString(),
      logsFetched: logs.length,
      reconcile,
    })
  }

  return {
    scannedAt: new Date().toISOString(),
    currentBlock: currentBlock.toString(),
    agentsScanned: perAgent.length,
    perAgent,
  }
}
