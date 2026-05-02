import { beforeAll, describe, expect, it } from 'vitest'
import { mintJwt } from '@open-agents/auth'
import { createDb, insertAgent } from '@open-agents/db'

process.env['DATABASE_URL'] = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
process.env['JWT_SECRET'] = 'test-secret-at-least-32-characters-here-xx'

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
