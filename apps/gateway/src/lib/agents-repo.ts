import { createDb, findAgentByLabel } from '@open-agents/db'
import type { Address, Hex } from 'viem'
import { env } from '../env.js'

/**
 * The shape the gateway route expects for an agent lookup result.
 *
 * - `id` is the agents.id UUID (FK target for gateway_announcements).
 * - `baseAddr` is the legacy fallback returned when stealthMeta is null
 *   (Plan 3 stub agents). Plan 5's scanner ignores baseAddr-only agents.
 * - `stealthMeta` is the 132-hex stealth meta-address from
 *   text_records['stealth-meta']. When set, the route runs per-query derivation.
 */
export interface GatewayAgent {
  id: string
  label: string
  baseAddr: Address
  stealthMeta: Hex | null
  textRecords: Record<string, string>
}

let _db: ReturnType<typeof createDb> | null = null
function getDb() {
  if (!_db) _db = createDb(env.DATABASE_URL)
  return _db
}

export function getGatewayDb() {
  return getDb()
}

/**
 * Looks up an active agent by its ENS subname label.
 * Returns null if no agent exists or is inactive.
 */
export async function findGatewayAgent(label: string): Promise<GatewayAgent | null> {
  const agent = await findAgentByLabel(getDb(), label)
  if (!agent) return null
  const records = (agent.textRecords as Record<string, string>) ?? {}
  const rawMeta = records['stealth-meta']
  const stealthMeta =
    typeof rawMeta === 'string' && /^0x[0-9a-fA-F]{132}$/.test(rawMeta)
      ? (rawMeta as Hex)
      : null
  return {
    id: agent.id,
    label: agent.subnameLabel,
    baseAddr: agent.baseAddr as Address,
    stealthMeta,
    textRecords: records,
  }
}
