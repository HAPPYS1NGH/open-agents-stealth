import { createDb, findAgentByLabel } from '@open-agents/db'
import type { Address } from 'viem'
import { env } from '../env.js'

/**
 * The shape the gateway route expects for an agent lookup result.
 */
export interface GatewayAgent {
  label: string
  baseAddr: Address
  textRecords: Record<string, string>
}

let _db: ReturnType<typeof createDb> | null = null
function getDb() {
  if (!_db) _db = createDb(env.DATABASE_URL)
  return _db
}

/**
 * Looks up an active agent by its ENS subname label.
 * Returns null if no agent exists or is inactive.
 *
 * Used by the resolve route for every CCIP-Read request. Caching, stealth
 * address derivation, and per-query key generation are layered in Plan 4.
 */
export async function findGatewayAgent(label: string): Promise<GatewayAgent | null> {
  const agent = await findAgentByLabel(getDb(), label)
  if (!agent) return null
  return {
    label: agent.subnameLabel,
    baseAddr: agent.baseAddr as Address,
    textRecords: agent.textRecords as Record<string, string>,
  }
}
