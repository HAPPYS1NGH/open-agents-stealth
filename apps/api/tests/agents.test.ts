import { beforeAll, describe, expect, it } from 'vitest'
import { mintJwt } from '@open-agents/auth'

process.env['DATABASE_URL'] = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
process.env['JWT_SECRET'] = 'test-secret-at-least-32-characters-here-xx'
// Disable on-chain check in tests by pointing to an unreachable RPC.
// The route code only invokes isAuthorizedForAgent when agentId is supplied.
process.env['BASE_RPC_URL'] = 'http://127.0.0.1:19999'
process.env['VIEW_KEY_MASTER_KEY'] = '0x' + 'aa'.repeat(32)

const OWNER = '0x0000000000000000000000000000000000000077'

let app: { fetch: (req: Request) => Promise<Response> }
let validToken: string

beforeAll(async () => {
  app = (await import('../src/server.js')).default
  validToken = await mintJwt({ sub: OWNER, ownerEoa: OWNER, secret: process.env['JWT_SECRET']! })
})

describe('POST /agents', () => {
  it('creates an agent and returns it', async () => {
    const res = await app.fetch(
      new Request('http://localhost/agents', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subnameLabel: 'test-plan2-crud-create',
          baseAddr: '0x0000000000000000000000000000000000000002',
          textRecords: { 'agent-context': '{"name":"test"}' },
        }),
      }),
    )
    expect(res.status).toBe(201)
    const body = await res.json() as { id: string; subnameLabel: string; ownerEoa: string }
    expect(body.subnameLabel).toBe('test-plan2-crud-create')
    expect(body.ownerEoa).toBe(OWNER)
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('returns 409 on duplicate subname_label', async () => {
    await app.fetch(
      new Request('http://localhost/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subnameLabel: 'test-plan2-dup-label', baseAddr: '0x' + '0'.repeat(40) }),
      }),
    )
    const res = await app.fetch(
      new Request('http://localhost/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subnameLabel: 'test-plan2-dup-label', baseAddr: '0x' + '0'.repeat(40) }),
      }),
    )
    expect(res.status).toBe(409)
  })

  it('returns 401 without a token', async () => {
    const res = await app.fetch(
      new Request('http://localhost/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subnameLabel: 'x', baseAddr: '0x' + '0'.repeat(40) }),
      }),
    )
    expect(res.status).toBe(401)
  })
})

describe('GET /agents/:id', () => {
  it('returns 404 for an unknown id', async () => {
    const res = await app.fetch(
      new Request('http://localhost/agents/00000000-0000-0000-0000-000000000000', {
        headers: { Authorization: `Bearer ${validToken}` },
      }),
    )
    expect(res.status).toBe(404)
  })

  it('returns the agent for a known id owned by the caller', async () => {
    const createRes = await app.fetch(
      new Request('http://localhost/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subnameLabel: 'test-plan2-get-id', baseAddr: '0x' + '0'.repeat(40) }),
      }),
    )
    const { id } = await createRes.json() as { id: string }
    const res = await app.fetch(
      new Request(`http://localhost/agents/${id}`, {
        headers: { Authorization: `Bearer ${validToken}` },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json() as { subnameLabel: string }
    expect(body.subnameLabel).toBe('test-plan2-get-id')
  })
})

describe('PATCH /agents/:id', () => {
  it('updates text records', async () => {
    const createRes = await app.fetch(
      new Request('http://localhost/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subnameLabel: 'test-plan2-patch', baseAddr: '0x' + '0'.repeat(40) }),
      }),
    )
    const { id } = await createRes.json() as { id: string }

    const patchRes = await app.fetch(
      new Request(`http://localhost/agents/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ textRecords: { 'agent-context': '{"name":"patched"}' } }),
      }),
    )
    expect(patchRes.status).toBe(200)
    const body = await patchRes.json() as { textRecords: Record<string, string> }
    expect(body.textRecords['agent-context']).toBe('{"name":"patched"}')
  })

  it('returns 403 when the agent is owned by a different address', async () => {
    const otherToken = await mintJwt({
      sub: '0x0000000000000000000000000000000000000088',
      ownerEoa: '0x0000000000000000000000000000000000000088',
      secret: process.env['JWT_SECRET']!,
    })
    const createRes = await app.fetch(
      new Request('http://localhost/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subnameLabel: 'test-plan2-owned', baseAddr: '0x' + '0'.repeat(40) }),
      }),
    )
    const { id } = await createRes.json() as { id: string }

    const patchRes = await app.fetch(
      new Request(`http://localhost/agents/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ textRecords: {} }),
      }),
    )
    expect(patchRes.status).toBe(403)
  })

  it('merges text_records — does not clobber stealth-meta or agent-registration[*]', async () => {
    const createRes = await app.fetch(
      new Request('http://localhost/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subnameLabel: 'patch-merge-' + Date.now(),
          baseAddr: '0x' + '0'.repeat(40),
          textRecords: {
            'stealth-meta': '0x' + 'ab'.repeat(33) + 'cd'.repeat(33),
            'agent-registration[8453][42]': '1',
          },
        }),
      }),
    )
    const { id } = await createRes.json() as { id: string }

    // Step-5-style PATCH that only sets the user-editable keys.
    const patchRes = await app.fetch(
      new Request(`http://localhost/agents/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          textRecords: {
            'agent-context': '{"name":"merged"}',
            'agent-endpoint[web]': 'https://example.com',
          },
        }),
      }),
    )
    expect(patchRes.status).toBe(200)
    const body = await patchRes.json() as { textRecords: Record<string, string> }
    expect(body.textRecords['agent-context']).toBe('{"name":"merged"}')
    expect(body.textRecords['agent-endpoint[web]']).toBe('https://example.com')
    // The auto-set keys MUST survive.
    expect(body.textRecords['stealth-meta']).toBe('0x' + 'ab'.repeat(33) + 'cd'.repeat(33))
    expect(body.textRecords['agent-registration[8453][42]']).toBe('1')
  })

  it('removes a text_record key when the client sends an empty string', async () => {
    const createRes = await app.fetch(
      new Request('http://localhost/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subnameLabel: 'patch-delete-' + Date.now(),
          baseAddr: '0x' + '0'.repeat(40),
          textRecords: { 'agent-context': '{"x":1}', 'keep-me': 'yes' },
        }),
      }),
    )
    const { id } = await createRes.json() as { id: string }

    const patchRes = await app.fetch(
      new Request(`http://localhost/agents/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ textRecords: { 'agent-context': '' } }),
      }),
    )
    expect(patchRes.status).toBe(200)
    const body = await patchRes.json() as { textRecords: Record<string, string> }
    expect(body.textRecords['agent-context']).toBeUndefined()
    expect(body.textRecords['keep-me']).toBe('yes')
  })
})
