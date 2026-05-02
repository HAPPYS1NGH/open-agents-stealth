import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createDb, insertAgent, listAnnouncementsByAgent } from '@open-agents/db'

process.env.DATABASE_URL = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
process.env.GATEWAY_SIGNER_PRIVATE_KEY = '0x' + '01'.repeat(32)
process.env.GATEWAY_ANNOUNCEMENTS = 'on'

let agentRowId: string

beforeAll(async () => {
  const db = createDb(process.env.DATABASE_URL!)
  const agent = await insertAgent(db, {
    ownerEoa: '0x0000000000000000000000000000000000000077',
    subnameLabel: 'announce-route-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000003',
  })
  agentRowId = agent.id
})

afterAll(() => {
  delete process.env.GATEWAY_ANNOUNCEMENTS
})

describe('recordAnnouncement', () => {
  it('writes a row and resolves void', async () => {
    const { recordAnnouncement } = await import('../src/lib/announcements-repo.js')
    await recordAnnouncement({
      agentRowId,
      stealthAddress: '0x' + 'ab'.repeat(20),
      ephemeralPub: '0x02' + 'cd'.repeat(32),
      viewTag: 5,
    })

    const db = createDb(process.env.DATABASE_URL!)
    const rows = await listAnnouncementsByAgent(db, agentRowId, 10)
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows[0]!.viewTag).toBe(5)
  })

  it('swallows Postgres errors so the gateway response is not blocked', async () => {
    const { recordAnnouncement } = await import('../src/lib/announcements-repo.js')
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})

    const eph = '0x02' + 'ff'.repeat(32)
    await recordAnnouncement({
      agentRowId,
      stealthAddress: '0x' + '11'.repeat(20),
      ephemeralPub: eph,
      viewTag: 9,
    })
    await expect(
      recordAnnouncement({
        agentRowId,
        stealthAddress: '0x' + '22'.repeat(20),
        ephemeralPub: eph,
        viewTag: 9,
      }),
    ).resolves.toBeUndefined()

    expect(consoleErr).toHaveBeenCalled()
    consoleErr.mockRestore()
  })
})
