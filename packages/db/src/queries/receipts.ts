import { and, eq } from 'drizzle-orm'
import type { DbClient } from '../client.js'
import { receipts, type Receipt, type NewReceipt } from '../schema.js'

/**
 * UPSERTs the per-payment receipt row. Used by the dashboard's confirm toggle.
 *
 * On first call: inserts a new receipt with the supplied state.
 * On subsequent calls: updates confirmed_by_recipient + eip712_payload +
 * eip712_signature, leaving appended_response_tx alone (Plan 7 owns that).
 */
export async function upsertReceipt(
  db: DbClient,
  data: Omit<NewReceipt, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<Receipt> {
  const [row] = await db
    .insert(receipts)
    .values(data)
    .onConflictDoUpdate({
      target: receipts.paymentId,
      set: {
        confirmedByRecipient: data.confirmedByRecipient,
        eip712Payload: data.eip712Payload ?? null,
        eip712Signature: data.eip712Signature ?? null,
        updatedAt: new Date(),
      },
    })
    .returning()
  if (!row) throw new Error('upsertReceipt: no row returned')
  return row
}

/**
 * Looks up a receipt by payment id. Used by GET /payments to join receipt
 * state into the response shape.
 */
export async function findReceiptByPayment(
  db: DbClient,
  paymentId: string,
): Promise<Receipt | null> {
  const rows = await db
    .select()
    .from(receipts)
    .where(eq(receipts.paymentId, paymentId))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Finds a receipt by id within a given agent scope. Used by Plan 7 to read
 * back the EIP-712 payload before submitting appendResponse.
 */
export async function findReceiptByIdForAgent(
  db: DbClient,
  receiptId: string,
  agentRowId: string,
): Promise<Receipt | null> {
  const rows = await db
    .select()
    .from(receipts)
    .where(and(eq(receipts.id, receiptId), eq(receipts.agentId, agentRowId)))
    .limit(1)
  return rows[0] ?? null
}
