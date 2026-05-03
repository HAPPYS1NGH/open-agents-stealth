import { findCurrentAnnouncement as dbFindCurrentAnnouncement, insertGatewayAnnouncement, type GatewayAnnouncement } from '@open-agents/db'
import { env } from '../env.js'
import { getGatewayDb } from './agents-repo.js'

export interface RecordAnnouncementInput {
  agentRowId: string
  /** The stealth EOA (signer derived per-query). */
  stealthAddress: string
  /** The CREATE2 stealth Safe (recipient — what the gateway returns). Optional for legacy callers. */
  stealthSafeAddress?: string
  ephemeralPub: string
  viewTag: number
}

/**
 * Returns the current unpaid announcement for the given agent, or null if none exists.
 * Returns null when env.GATEWAY_ANNOUNCEMENTS === 'off'.
 */
export async function findCurrentAnnouncement(
  agentRowId: string,
): Promise<GatewayAnnouncement | null> {
  if (env.GATEWAY_ANNOUNCEMENTS === 'off') return null
  try {
    return await dbFindCurrentAnnouncement(getGatewayDb(), agentRowId)
  } catch (err) {
    console.error('findCurrentAnnouncement: query failed (swallowed)', err)
    return null
  }
}

/**
 * Fire-and-forget insert into gateway_announcements. ALWAYS resolves void;
 * Postgres errors are logged with console.error but never propagate, so the
 * CCIP-Read response is not blocked by transient DB hiccups.
 *
 * No-ops when env.GATEWAY_ANNOUNCEMENTS === 'off'.
 */
export async function recordAnnouncement(input: RecordAnnouncementInput): Promise<void> {
  if (env.GATEWAY_ANNOUNCEMENTS === 'off') return
  try {
    await insertGatewayAnnouncement(getGatewayDb(), {
      agentId: input.agentRowId,
      stealthAddress: input.stealthAddress,
      stealthSafeAddress: input.stealthSafeAddress ?? null,
      ephemeralPub: input.ephemeralPub,
      viewTag: input.viewTag,
    })
  } catch (err) {
    console.error('recordAnnouncement: insert failed (swallowed)', err)
  }
}
