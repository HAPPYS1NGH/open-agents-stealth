import { eq, and } from 'drizzle-orm'
import type { DbClient } from '../client.js'
import { agents, type Agent, type NewAgent } from '../schema.js'

/**
 * Finds an active agent by its ENS subname label (case-insensitive).
 * Returns null if no agent exists or the agent is inactive.
 * Used by the gateway for every addr() / text() resolution request.
 */
export async function findAgentByLabel(
  db: DbClient,
  label: string,
): Promise<Agent | null> {
  const rows = await db
    .select()
    .from(agents)
    .where(and(eq(agents.subnameLabel, label.toLowerCase()), eq(agents.isActive, true)))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Finds an agent by its primary key UUID.
 * Returns null if no agent exists (active or inactive).
 */
export async function findAgentById(
  db: DbClient,
  id: string,
): Promise<Agent | null> {
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.id, id))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Finds all active agents owned by a given EOA address (case-insensitive).
 * Used by GET /me and GET /agents.
 */
export async function findAgentsByOwner(
  db: DbClient,
  ownerEoa: string,
): Promise<Agent[]> {
  return db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.ownerEoa, ownerEoa.toLowerCase()),
        eq(agents.isActive, true),
      ),
    )
}

/**
 * Inserts a new agent row. Throws on duplicate subname_label (Postgres
 * unique constraint violation — caller should catch and return HTTP 409).
 */
export async function insertAgent(
  db: DbClient,
  data: Omit<NewAgent, 'id' | 'createdAt' | 'updatedAt'> & {
    ownerEoa: string
    subnameLabel: string
    baseAddr: string
  },
): Promise<Agent> {
  const [row] = await db
    .insert(agents)
    .values({
      ...data,
      ownerEoa: data.ownerEoa.toLowerCase(),
      subnameLabel: data.subnameLabel.toLowerCase(),
    })
    .returning()
  if (!row) throw new Error('insertAgent: no row returned')
  return row
}

/**
 * Updates an existing agent row. Sets updatedAt to now().
 * Throws if the agent is not found (returns zero rows).
 */
export async function updateAgent(
  db: DbClient,
  id: string,
  data: Partial<Omit<NewAgent, 'id' | 'ownerEoa' | 'subnameLabel' | 'createdAt'>>,
): Promise<Agent> {
  const [row] = await db
    .update(agents)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(agents.id, id))
    .returning()
  if (!row) throw new Error(`updateAgent: no agent found with id ${id}`)
  return row
}
