import { beforeAll, describe, expect, it } from 'vitest'
import { mintJwt } from '@open-agents/auth'
import { createDb, insertAgent, findAgentById } from '@open-agents/db'

process.env['DATABASE_URL'] = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
process.env['JWT_SECRET'] = 'test-secret-at-least-32-characters-here-xx'
process.env['BASE_RPC_URL'] = 'http://127.0.0.1:19999'
process.env['VIEW_KEY_MASTER_KEY'] = '0x' + 'aa'.repeat(32)

const OWNER = '0x0000000000000000000000000000000000000045'
const VIEW_KEY = '0x' + 'cd'.repeat(32)

let app: { fetch: (req: Request) => Promise<Response> }
let validToken: string
let stubAgentId: string
let cleanAgentId: string

beforeAll(async () => {
  app = (await import('../src/server.js')).default
  validToken = await mintJwt({ sub: OWNER, ownerEoa: OWNER, secret: process.env['JWT_SECRET']! })

  const db = createDb(process.env['DATABASE_URL']!)
  const stubAgent = await insertAgent(db, {
    ownerEoa: OWNER,
    subnameLabel: 'view-stub-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000005',
    viewKeyEncrypted: 'stub:0xdeadbeef',
  })
  stubAgentId = stubAgent.id

  const cleanAgent = await insertAgent(db, {
    ownerEoa: OWNER,
    subnameLabel: 'view-clean-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000006',
  })
  cleanAgentId = cleanAgent.id
})

describe('POST /agents/:id/view-key', () => {
  it('encrypts and stores a v1: envelope', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/agents/${cleanAgentId}/view-key`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewKey: VIEW_KEY, stealthMeta: '0x' + 'aa'.repeat(33) + 'bb'.repeat(33) }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; viewKeyEncrypted: string; textRecords: Record<string, string> }
    expect(body.viewKeyEncrypted.startsWith('v1:')).toBe(true)
    expect(body.textRecords['stealth-meta']).toBe('0x' + 'aa'.repeat(33) + 'bb'.repeat(33))

    const db = createDb(process.env['DATABASE_URL']!)
    const row = await findAgentById(db, cleanAgentId)
    expect(row?.viewKeyEncrypted).toMatch(/^v1:/)
    expect(row?.textRecords['stealth-meta']).toBe('0x' + 'aa'.repeat(33) + 'bb'.repeat(33))
  })

  it('overwrites a stub: row without requiring force=1', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/agents/${stubAgentId}/view-key`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewKey: VIEW_KEY, stealthMeta: '0x' + '11'.repeat(33) + '22'.repeat(33) }),
      }),
    )
    expect(res.status).toBe(200)
    const db = createDb(process.env['DATABASE_URL']!)
    const row = await findAgentById(db, stubAgentId)
    expect(row?.viewKeyEncrypted).toMatch(/^v1:/)
  })

  it('refuses to overwrite an existing v1: envelope without ?force=1', async () => {
    await app.fetch(
      new Request(`http://localhost/agents/${cleanAgentId}/view-key`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewKey: VIEW_KEY, stealthMeta: '0x' + 'aa'.repeat(33) + 'bb'.repeat(33) }),
      }),
    )

    const res = await app.fetch(
      new Request(`http://localhost/agents/${cleanAgentId}/view-key`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewKey: '0x' + 'ee'.repeat(32), stealthMeta: '0x' + 'cc'.repeat(33) + 'dd'.repeat(33) }),
      }),
    )
    expect(res.status).toBe(409)
  })

  it('allows overwrite with ?force=1', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/agents/${cleanAgentId}/view-key?force=1`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewKey: '0x' + 'ee'.repeat(32), stealthMeta: '0x' + 'cc'.repeat(33) + 'dd'.repeat(33) }),
      }),
    )
    expect(res.status).toBe(200)
  })

  it('400s on a malformed view key', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/agents/${cleanAgentId}/view-key`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewKey: 'not-hex', stealthMeta: '0x' + 'aa'.repeat(33) + 'bb'.repeat(33) }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('400s on a malformed stealth meta', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/agents/${cleanAgentId}/view-key`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewKey: VIEW_KEY, stealthMeta: '0xdeadbeef' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('401s without a token', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/agents/${cleanAgentId}/view-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewKey: VIEW_KEY, stealthMeta: '0x' + 'aa'.repeat(33) + 'bb'.repeat(33) }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('403s when the caller does not own the agent', async () => {
    const otherOwner = '0x0000000000000000000000000000000000000099'
    const otherToken = await mintJwt({ sub: otherOwner, ownerEoa: otherOwner, secret: process.env['JWT_SECRET']! })

    const res = await app.fetch(
      new Request(`http://localhost/agents/${cleanAgentId}/view-key?force=1`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewKey: VIEW_KEY, stealthMeta: '0x' + 'aa'.repeat(33) + 'bb'.repeat(33) }),
      }),
    )
    expect(res.status).toBe(403)
  })
})

describe('PATCH /agents/:id viewKeyEncrypted hardening', () => {
  it('rejects a viewKeyEncrypted value that is neither stub: nor v1:', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/agents/${cleanAgentId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewKeyEncrypted: 'plain-text-blob' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('still accepts stub: rows for Plan 3 backward compatibility', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/agents/${stubAgentId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewKeyEncrypted: 'stub:0xfeedface' }),
      }),
    )
    expect(res.status).toBe(200)
  })
})
