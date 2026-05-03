import { and, desc, eq, gt, sql } from 'drizzle-orm'
import type { DbClient } from '../client.js'
import {
  payments,
  receipts,
  type Payment,
  type NewPayment,
  type Receipt,
} from '../schema.js'

/**
 * Inserts a payment row. Throws on (tx_hash, log_index) unique violation —
 * the scanner reconciler swallows that and treats it as "already inserted".
 */
export async function insertPayment(
  db: DbClient,
  data: Omit<NewPayment, 'id' | 'detectedAt'>,
): Promise<Payment> {
  const [row] = await db
    .insert(payments)
    .values({
      ...data,
      stealthAddress: data.stealthAddress.toLowerCase(),
      tokenAddress: data.tokenAddress.toLowerCase(),
      fromAddress: data.fromAddress.toLowerCase(),
      txHash: data.txHash.toLowerCase(),
    })
    .returning()
  if (!row) throw new Error('insertPayment: no row returned')
  return row
}

export interface PaymentWithReceipt extends Payment {
  receipt: Receipt | null
}

/**
 * Lists payments for the given agent with their receipt (if any) joined.
 * Used by the dashboard's table view; cursored on detected_at.
 */
export async function listPaymentsByAgent(
  db: DbClient,
  agentRowId: string,
  opts: { limit?: number; afterDetectedAt?: Date } = {},
): Promise<PaymentWithReceipt[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const where = opts.afterDetectedAt
    ? and(eq(payments.agentId, agentRowId), gt(payments.detectedAt, opts.afterDetectedAt))
    : eq(payments.agentId, agentRowId)

  const rows = await db
    .select({
      payment: payments,
      receipt: receipts,
    })
    .from(payments)
    .leftJoin(receipts, eq(receipts.paymentId, payments.id))
    .where(where)
    .orderBy(desc(payments.detectedAt))
    .limit(limit)

  return rows.map((r) => ({ ...r.payment, receipt: r.receipt ?? null }))
}

/**
 * Finds a single payment by its UUID. Used by POST /receipts/:paymentId/confirm.
 */
export async function findPaymentById(
  db: DbClient,
  paymentId: string,
): Promise<Payment | null> {
  const rows = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1)
  return rows[0] ?? null
}

/**
 * Cheap existence probe used by the scanner before issuing the insert.
 * The unique constraint guards correctness; this just saves a roundtrip
 * when the scanner re-runs the same block window.
 */
export async function paymentExistsByTxLog(
  db: DbClient,
  txHash: string,
  logIndex: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.txHash, txHash.toLowerCase()), eq(payments.logIndex, logIndex)))
    .limit(1)
  return rows.length > 0
}

/**
 * Returns the highest block_number this scanner has seen for a given agent.
 * Used by the per-agent cursor to skip already-scanned ranges. Returns 0n
 * if no payments are recorded.
 */
export async function maxScannedBlockForAgent(
  db: DbClient,
  agentRowId: string,
): Promise<bigint> {
  const [row] = await db
    .select({ maxBlock: sql<string>`COALESCE(MAX(${payments.blockNumber})::text, '0')` })
    .from(payments)
    .where(eq(payments.agentId, agentRowId))
  return BigInt(row?.maxBlock ?? '0')
}
