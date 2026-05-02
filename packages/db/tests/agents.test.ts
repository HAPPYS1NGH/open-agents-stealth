import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { like } from 'drizzle-orm'
import { createDb, type DbClient } from '../src/client.js'
import { agents } from '../src/schema.js'
import {
  findAgentByLabel,
  findAgentsByOwner,
  insertAgent,
  updateAgent,
} from '../src/queries/agents.js'

const DB_URL = process.env['DATABASE_URL'] ??
  'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'

let db: DbClient

beforeAll(() => {
  db = createDb(DB_URL)
})

afterAll(async () => {
  await db.delete(agents).where(like(agents.subnameLabel, 'test-plan2-%'))
})

describe('insertAgent', () => {
  it('inserts an agent and returns the row', async () => {
    const row = await insertAgent(db, {
      ownerEoa: '0x0000000000000000000000000000000000000001',
      subnameLabel: 'test-plan2-insert',
      baseAddr: '0x0000000000000000000000000000000000000002',
      textRecords: { 'agent-context': '{"name":"test"}' },
    })
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(row.subnameLabel).toBe('test-plan2-insert')
    expect(row.isActive).toBe(true)
  })

  it('throws on duplicate subname_label', async () => {
    await insertAgent(db, {
      ownerEoa: '0x0000000000000000000000000000000000000001',
      subnameLabel: 'test-plan2-dup',
      baseAddr: '0x0000000000000000000000000000000000000002',
    })
    await expect(
      insertAgent(db, {
        ownerEoa: '0x0000000000000000000000000000000000000003',
        subnameLabel: 'test-plan2-dup',
        baseAddr: '0x0000000000000000000000000000000000000004',
      }),
    ).rejects.toThrow()
  })
})

describe('findAgentByLabel', () => {
  it('returns the agent for a known label', async () => {
    await insertAgent(db, {
      ownerEoa: '0xAAAA000000000000000000000000000000000001',
      subnameLabel: 'test-plan2-find',
      baseAddr: '0x0000000000000000000000000000000000000002',
    })
    const agent = await findAgentByLabel(db, 'test-plan2-find')
    expect(agent).not.toBeNull()
    expect(agent!.subnameLabel).toBe('test-plan2-find')
  })

  it('returns null for an unknown label', async () => {
    const agent = await findAgentByLabel(db, 'test-plan2-does-not-exist')
    expect(agent).toBeNull()
  })

  it('returns null for an inactive agent', async () => {
    const inserted = await insertAgent(db, {
      ownerEoa: '0xBBBB000000000000000000000000000000000001',
      subnameLabel: 'test-plan2-inactive',
      baseAddr: '0x0000000000000000000000000000000000000002',
    })
    await updateAgent(db, inserted.id, { isActive: false })
    const found = await findAgentByLabel(db, 'test-plan2-inactive')
    expect(found).toBeNull()
  })
})

describe('findAgentsByOwner', () => {
  it('returns all active agents owned by an address', async () => {
    const owner = '0xCCCC000000000000000000000000000000000001'
    await insertAgent(db, { ownerEoa: owner, subnameLabel: 'test-plan2-owner-a', baseAddr: '0x' + '0'.repeat(40) })
    await insertAgent(db, { ownerEoa: owner, subnameLabel: 'test-plan2-owner-b', baseAddr: '0x' + '0'.repeat(40) })
    const list = await findAgentsByOwner(db, owner)
    const labels = list.map(a => a.subnameLabel)
    expect(labels).toContain('test-plan2-owner-a')
    expect(labels).toContain('test-plan2-owner-b')
  })
})

describe('updateAgent', () => {
  it('updates specified fields and refreshes updatedAt', async () => {
    const inserted = await insertAgent(db, {
      ownerEoa: '0xDDDD000000000000000000000000000000000001',
      subnameLabel: 'test-plan2-update',
      baseAddr: '0x0000000000000000000000000000000000000002',
    })
    const before = inserted.updatedAt
    await new Promise(r => setTimeout(r, 10))
    const updated = await updateAgent(db, inserted.id, {
      treasurySafeAddress: '0x0000000000000000000000000000000000000099',
    })
    expect(updated.treasurySafeAddress).toBe('0x0000000000000000000000000000000000000099')
    expect(updated.updatedAt.getTime()).toBeGreaterThan(before.getTime())
  })
})
