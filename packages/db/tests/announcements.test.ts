import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  createDb,
  insertAgent,
  insertGatewayAnnouncement,
  listAnnouncementsByAgent,
  deleteAnnouncementsOlderThan,
  agents,
} from '../src/index.js'

const DB_URL = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
let db: ReturnType<typeof createDb>
let agentRowId: string

beforeAll(async () => {
  db = createDb(DB_URL)
  const agent = await insertAgent(db, {
    ownerEoa: '0x0000000000000000000000000000000000000099',
    subnameLabel: 'announce-test-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000001',
  })
  agentRowId = agent.id
})

afterAll(async () => {
  // Cleanup: cascading FK removes announcements.
  await db.delete(agents).where(eq(agents.id, agentRowId))
})

describe('gateway_announcements queries', () => {
  it('inserts and lists', async () => {
    await insertGatewayAnnouncement(db, {
      agentId: agentRowId,
      stealthAddress: '0x' + 'aa'.repeat(20),
      ephemeralPub: '0x02' + '11'.repeat(32),
      viewTag: 0x42,
    })
    await insertGatewayAnnouncement(db, {
      agentId: agentRowId,
      stealthAddress: '0x' + 'bb'.repeat(20),
      ephemeralPub: '0x03' + '22'.repeat(32),
      viewTag: 0x99,
    })

    const rows = await listAnnouncementsByAgent(db, agentRowId, 10)
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows[0]!.viewTag).toBeTypeOf('number')
    expect(rows[0]!.stealthAddress).toMatch(/^0x[0-9a-f]{40}$/)
  })

  it('rejects duplicate (agent, ephemeral_pub)', async () => {
    const dup = '0x02' + 'ee'.repeat(32)
    await insertGatewayAnnouncement(db, {
      agentId: agentRowId,
      stealthAddress: '0x' + 'cc'.repeat(20),
      ephemeralPub: dup,
      viewTag: 0x01,
    })
    await expect(
      insertGatewayAnnouncement(db, {
        agentId: agentRowId,
        stealthAddress: '0x' + 'dd'.repeat(20),
        ephemeralPub: dup,
        viewTag: 0x02,
      }),
    ).rejects.toThrow()
  })

  it('deletes by cutoff', async () => {
    const cutoff = new Date(Date.now() + 1000 * 60 * 60)
    const removed = await deleteAnnouncementsOlderThan(db, cutoff)
    expect(removed).toBeGreaterThanOrEqual(1)
  })
})
