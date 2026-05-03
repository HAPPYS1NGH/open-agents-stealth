import { and, desc, eq, isNull, lt } from 'drizzle-orm'
import type { DbClient } from '../client.js'
import {
  gatewayAnnouncements,
  type GatewayAnnouncement,
  type NewGatewayAnnouncement,
} from '../schema.js'

/**
 * Inserts a single gateway announcement row. The gateway calls this in a
 * fire-and-forget Promise so CCIP-Read responses are not delayed by Postgres.
 *
 * Throws on (agent_id, ephemeral_pub) unique violation — callers may swallow.
 */
export async function insertGatewayAnnouncement(
  db: DbClient,
  data: Omit<NewGatewayAnnouncement, 'id' | 'generatedAt'>,
): Promise<GatewayAnnouncement> {
  const [row] = await db.insert(gatewayAnnouncements).values(data).returning()
  if (!row) throw new Error('insertGatewayAnnouncement: no row returned')
  return row
}

/**
 * Returns the most-recent unpaid announcement row for an agent (i.e. `paid_at IS NULL`),
 * or null if no such row exists. The gateway reuses this row for all CCIP-Read queries
 * until a payment is detected, ensuring stable addresses per-query cycle.
 */
export async function findCurrentAnnouncement(
  db: DbClient,
  agentRowId: string,
): Promise<GatewayAnnouncement | null> {
  const [row] = await db
    .select()
    .from(gatewayAnnouncements)
    .where(
      and(
        eq(gatewayAnnouncements.agentId, agentRowId),
        isNull(gatewayAnnouncements.paidAt),
      ),
    )
    .orderBy(desc(gatewayAnnouncements.generatedAt))
    .limit(1)
  return row ?? null
}

/**
 * Returns recent announcements for a given agent, newest first.
 */
export async function listAnnouncementsByAgent(
  db: DbClient,
  agentRowId: string,
  limit = 50,
): Promise<GatewayAnnouncement[]> {
  return db
    .select()
    .from(gatewayAnnouncements)
    .where(eq(gatewayAnnouncements.agentId, agentRowId))
    .orderBy(desc(gatewayAnnouncements.generatedAt))
    .limit(limit)
}

/**
 * Deletes announcements older than `cutoff`. Returns count removed.
 */
export async function deleteAnnouncementsOlderThan(
  db: DbClient,
  cutoff: Date,
): Promise<number> {
  const rows = await db
    .delete(gatewayAnnouncements)
    .where(lt(gatewayAnnouncements.generatedAt, cutoff))
    .returning({ id: gatewayAnnouncements.id })
  return rows.length
}
