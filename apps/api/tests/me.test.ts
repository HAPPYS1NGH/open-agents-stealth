import { beforeAll, describe, expect, it } from 'vitest'
import { mintJwt } from '@open-agents/auth'
import { createDb, insertAgent } from '@open-agents/db'

process.env['DATABASE_URL'] = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
process.env['JWT_SECRET'] = 'test-secret-at-least-32-characters-here-xx'
process.env['VIEW_KEY_MASTER_KEY'] = '0x' + 'aa'.repeat(32)

const OWNER = '0x0000000000000000000000000000000000000099'

let app: { fetch: (req: Request) => Promise<Response> }
let validToken: string

beforeAll(async () => {
  app = (await import('../src/server.js')).default
  const db = createDb(process.env['DATABASE_URL']!)
  await insertAgent(db, {
    ownerEoa: OWNER,
    subnameLabel: 'test-plan2-me',
    baseAddr: '0x0000000000000000000000000000000000000002',
  }).catch(() => { /* ignore if already exists */ })

  validToken = await mintJwt({ sub: OWNER, ownerEoa: OWNER, secret: process.env['JWT_SECRET']! })
})

describe('GET /me', () => {
  it('returns 401 with no Authorization header', async () => {
    const res = await app.fetch(new Request('http://localhost/me'))
    expect(res.status).toBe(401)
  })

  it('returns the owner address and their agents for a valid JWT', async () => {
    const res = await app.fetch(
      new Request('http://localhost/me', {
        headers: { Authorization: `Bearer ${validToken}` },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json() as {
      ownerEoa: string
      agents: Array<{ subnameLabel: string }>
    }
    expect(body.ownerEoa).toBe(OWNER)
    const labels = body.agents.map(a => a.subnameLabel)
    expect(labels).toContain('test-plan2-me')
  })

  it('returns a refreshed token in the x-refreshed-token header', async () => {
    const res = await app.fetch(
      new Request('http://localhost/me', {
        headers: { Authorization: `Bearer ${validToken}` },
      }),
    )
    expect(res.headers.get('x-refreshed-token')).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/)
  })
})

describe('GET /me — Plan 4 view-key state surfacing', () => {
  it('reports viewKeyState=none for new agents', async () => {
    const db = createDb(process.env['DATABASE_URL']!)
    const fresh = await insertAgent(db, {
      ownerEoa: OWNER,
      subnameLabel: 'me-fresh-' + Date.now(),
      baseAddr: '0x0000000000000000000000000000000000000007',
    })

    const res = await app.fetch(
      new Request('http://localhost/me', {
        headers: { Authorization: `Bearer ${validToken}` },
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { agents: Array<{ id: string; viewKeyState: string; stealthMetaPublished: boolean }> }
    const me = body.agents.find((a) => a.id === fresh.id)
    expect(me?.viewKeyState).toBe('none')
    expect(me?.stealthMetaPublished).toBe(false)
  })

  it('reports viewKeyState=stub for Plan 3 stub rows', async () => {
    const db = createDb(process.env['DATABASE_URL']!)
    const stub = await insertAgent(db, {
      ownerEoa: OWNER,
      subnameLabel: 'me-stub-' + Date.now(),
      baseAddr: '0x0000000000000000000000000000000000000008',
      viewKeyEncrypted: 'stub:0xdeadbeef',
    })

    const res = await app.fetch(
      new Request('http://localhost/me', {
        headers: { Authorization: `Bearer ${validToken}` },
      }),
    )
    const body = (await res.json()) as { agents: Array<{ id: string; viewKeyState: string }> }
    const me = body.agents.find((a) => a.id === stub.id)
    expect(me?.viewKeyState).toBe('stub')
  })

  it('reports viewKeyState=v1 + stealthMetaPublished=true after Plan 4 rotation', async () => {
    const db = createDb(process.env['DATABASE_URL']!)
    const real = await insertAgent(db, {
      ownerEoa: OWNER,
      subnameLabel: 'me-v1-' + Date.now(),
      baseAddr: '0x0000000000000000000000000000000000000009',
      viewKeyEncrypted: 'v1:eyJrIjoidiJ9',
      textRecords: { 'stealth-meta': '0x' + 'aa'.repeat(33) + 'bb'.repeat(33) },
    })

    const res = await app.fetch(
      new Request('http://localhost/me', {
        headers: { Authorization: `Bearer ${validToken}` },
      }),
    )
    const body = (await res.json()) as { agents: Array<{ id: string; viewKeyState: string; stealthMetaPublished: boolean }> }
    const me = body.agents.find((a) => a.id === real.id)
    expect(me?.viewKeyState).toBe('v1')
    expect(me?.stealthMetaPublished).toBe(true)
  })
})
