import { insertGatewayAnnouncement } from '@open-agents/db'
import { env } from '../env.js'
import { getGatewayDb } from './agents-repo.js'

export interface RecordAnnouncementInput {
  agentRowId: string
  stealthAddress: string
  ephemeralPub: string
  viewTag: number
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
      ephemeralPub: input.ephemeralPub,
      viewTag: input.viewTag,
    })
  } catch (err) {
    console.error('recordAnnouncement: insert failed (swallowed)', err)
  }
}
