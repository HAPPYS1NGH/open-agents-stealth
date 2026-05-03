import { desc, inArray } from 'drizzle-orm'
import {
  gatewayAnnouncements,
  insertPayment,
  markAnnouncementPaid,
  paymentExistsByTxLog,
  type DbClient,
} from '@open-agents/db'
import type { Address } from 'viem'
import type { DecodedTransferLog } from './log-fetcher.js'

export interface ReconcileSummary {
  inserted: number
  skipped: number
  unmatched: number
}

export interface ReconcileArgs {
  db: DbClient
  logs: DecodedTransferLog[]
  tokenAddress: Address
}

/**
 * Matches a list of decoded USDC Transfer logs to known stealth addresses
 * (read from gateway_announcements) and inserts a `payments` row per match.
 *
 * Returns a summary so the caller can log/observe scan health:
 *   inserted   — new rows that landed
 *   skipped    — matched logs that were already in the table (idempotency)
 *   unmatched  — logs whose `to` was not in any announcement (data races)
 *
 * The (tx_hash, log_index) unique index is the source of truth for
 * idempotency; the explicit existence probe is just to keep the summary
 * counts honest. A unique-violation thrown from insertPayment is caught
 * and translated into `skipped++`.
 */
export async function reconcileLogsToPayments(
  args: ReconcileArgs,
): Promise<ReconcileSummary> {
  if (args.logs.length === 0) {
    return { inserted: 0, skipped: 0, unmatched: 0 }
  }

  const stealthSet = new Set(args.logs.map((l) => l.args.to.toLowerCase()))
  const announcementRows = await args.db
    .select({
      stealthAddress: gatewayAnnouncements.stealthAddress,
      ephemeralPub: gatewayAnnouncements.ephemeralPub,
      agentId: gatewayAnnouncements.agentId,
    })
    .from(gatewayAnnouncements)
    .where(inArray(gatewayAnnouncements.stealthAddress, Array.from(stealthSet)))
    .orderBy(desc(gatewayAnnouncements.generatedAt))

  // Group by stealth_address so we can detect collisions explicitly. The
  // gateway should never issue the same stealth address to two agents (the
  // ECDH derivation makes collision astronomically unlikely), but the DB
  // doesn't enforce uniqueness across agents — only per (agent, ephemeral_pub).
  // If we silently last-write-wins, a misissuance would attribute payments to
  // the wrong agent without any warning.
  const grouped = new Map<string, Array<{ agentId: string; ephemeralPub: string }>>()
  for (const r of announcementRows) {
    const key = r.stealthAddress.toLowerCase()
    const list = grouped.get(key) ?? []
    list.push({ agentId: r.agentId, ephemeralPub: r.ephemeralPub })
    grouped.set(key, list)
  }
  const lookup = new Map<string, { agentId: string; ephemeralPub: string }>()
  for (const [stealthAddress, candidates] of grouped) {
    if (candidates.length > 1) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          msg: 'stealth_address_collision',
          stealthAddress,
          agentIds: candidates.map((c) => c.agentId),
          chosenAgentId: candidates[0]!.agentId,
          note: 'Picking most recent issuance (orderBy desc generatedAt).',
        }),
      )
    }
    // candidates[0] is the most-recently issued (orderBy generated_at desc).
    lookup.set(stealthAddress, candidates[0]!)
  }

  let inserted = 0
  let skipped = 0
  let unmatched = 0

  for (const log of args.logs) {
    const target = lookup.get(log.args.to.toLowerCase())
    if (!target) {
      unmatched++
      continue
    }

    if (await paymentExistsByTxLog(args.db, log.transactionHash, log.logIndex)) {
      skipped++
      continue
    }

    try {
      await insertPayment(args.db, {
        agentId: target.agentId,
        stealthAddress: log.args.to.toLowerCase(),
        ephemeralPub: target.ephemeralPub,
        txHash: log.transactionHash.toLowerCase(),
        logIndex: log.logIndex,
        blockNumber: log.blockNumber.toString(),
        tokenAddress: args.tokenAddress.toLowerCase(),
        amount: log.args.value.toString(),
        fromAddress: log.args.from.toLowerCase(),
      })
      inserted++
      // Best-effort: rotate the gateway's stable-cycle by marking this
      // announcement paid. Failure here is non-fatal — the next tick re-runs
      // the same range and re-attempts. We don't want a transient DB hiccup
      // to undo the inserted++ counter.
      await markAnnouncementPaid(args.db, log.args.to.toLowerCase()).catch(
        (err) =>
          console.warn(
            JSON.stringify({
              level: 'warn',
              msg: 'markAnnouncementPaid_failed',
              stealthAddress: log.args.to.toLowerCase(),
              err: String(err),
            }),
          ),
      )
    } catch (err) {
      // Lost a race against another scanner replica. The unique constraint
      // protected us; count as skipped, not failed.
      if (
        String(err).includes('23505') ||
        String(err).toLowerCase().includes('unique')
      ) {
        skipped++
        continue
      }
      throw err
    }
  }

  return { inserted, skipped, unmatched }
}
