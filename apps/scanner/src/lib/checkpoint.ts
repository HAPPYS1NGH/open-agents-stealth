import { and, eq, sql } from 'drizzle-orm'
import {
  agents,
  gatewayAnnouncements,
  maxScannedBlockForAgent,
  type DbClient,
} from '@open-agents/db'
import type { Address } from 'viem'

export interface ScanTarget {
  agentRowId: string
  stealthAddresses: Address[]
}

export interface ComputeStartBlockArgs {
  db: DbClient
  agentRowId: string
  currentBlock: bigint
  lookback: bigint
}

/**
 * Returns the next block number this agent should scan from.
 *
 * - If the agent has at least one recorded payment, returns
 *   max(block_number) + 1, so we never re-scan a block we've already inserted.
 * - Else falls back to max(currentBlock - lookback, 0). For brand-new agents
 *   this gives a fresh window without bloating the RPC call.
 */
export async function computeStartBlock(args: ComputeStartBlockArgs): Promise<bigint> {
  const max = await maxScannedBlockForAgent(args.db, args.agentRowId)
  if (max > 0n) return max + 1n
  if (args.currentBlock <= args.lookback) return 0n
  return args.currentBlock - args.lookback
}

/**
 * Returns every agent that should be scanned this tick: those with a valid
 * stealth-meta record AND at least one gateway_announcements row (i.e., an
 * actual stealth address to listen for).
 *
 * Implementation notes:
 * - The stealth-meta filter checks that text_records ->> 'stealth-meta' is
 *   non-null and length-134 (matching `0x` + 132 hex), which is the same
 *   shape Plan 4's isStealthMetaAddress accepts.
 * - We aggregate stealth addresses per agent via a single GROUP BY query so
 *   one round-trip suffices.
 */
export async function fetchActiveScanTargets(db: DbClient): Promise<ScanTarget[]> {
  const rows = await db
    .select({
      agentRowId: agents.id,
      stealthAddress: gatewayAnnouncements.stealthAddress,
    })
    .from(agents)
    .innerJoin(gatewayAnnouncements, eq(gatewayAnnouncements.agentId, agents.id))
    .where(
      and(
        eq(agents.isActive, true),
        sql`length(${agents.textRecords} ->> 'stealth-meta') = 134`,
      ),
    )

  const grouped = new Map<string, Set<string>>()
  for (const r of rows) {
    if (!grouped.has(r.agentRowId)) grouped.set(r.agentRowId, new Set())
    grouped.get(r.agentRowId)!.add(r.stealthAddress.toLowerCase())
  }

  const out: ScanTarget[] = []
  for (const [agentRowId, addrs] of grouped) {
    out.push({
      agentRowId,
      stealthAddresses: Array.from(addrs) as Address[],
    })
  }
  return out
}
