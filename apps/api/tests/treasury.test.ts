import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mintJwt } from '@open-agents/auth'
import { createDb, insertAgent } from '@open-agents/db'

process.env['DATABASE_URL'] = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
process.env['JWT_SECRET'] = 'test-secret-at-least-32-characters-here-xx'
process.env['BASE_RPC_URL'] = 'http://127.0.0.1:19999'

const OWNER = '0x0000000000000000000000000000000000000066'

vi.mock('../src/lib/safe-bytecode.js', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/safe-bytecode.js')>(
    '../src/lib/safe-bytecode.js',
  )
  return {
    ...actual,
    checkSafeBytecode: vi.fn(),
    checkSafeDeployTx: vi.fn(),
  }
})

let app: { fetch: (req: Request) => Promise<Response> }
let validToken: string
let agentRowId: string

beforeAll(async () => {
  app = (await import('../src/server.js')).default
  validToken = await mintJwt({ sub: OWNER, ownerEoa: OWNER, secret: process.env['JWT_SECRET']! })

  const db = createDb(process.env['DATABASE_URL']!)
  const agent = await insertAgent(db, {
    ownerEoa: OWNER,
    subnameLabel: 'test-plan3-treasury-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000002',
  })
  agentRowId = agent.id
})

describe('POST /agents/:id/treasury', () => {
  it('200s on success, persists treasurySafeAddress', async () => {
    const safe = await import('../src/lib/safe-bytecode.js')
    vi.mocked(safe.checkSafeBytecode).mockResolvedValue({ ok: true, reason: null })
    vi.mocked(safe.checkSafeDeployTx).mockResolvedValue({ ok: true, reason: null })

    const safeAddr = '0x' + '11'.repeat(20)
    const res = await app.fetch(
      new Request(`http://localhost/agents/${agentRowId}/treasury`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ safeAddress: safeAddr, deployTxHash: '0x' + 'aa'.repeat(32) }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json() as { treasurySafeAddress: string }
    expect(body.treasurySafeAddress.toLowerCase()).toBe(safeAddr.toLowerCase())
  })

  it('400s when bytecode check fails', async () => {
    const safe = await import('../src/lib/safe-bytecode.js')
    vi.mocked(safe.checkSafeDeployTx).mockResolvedValue({ ok: true, reason: null })
    vi.mocked(safe.checkSafeBytecode).mockResolvedValue({
      ok: false,
      reason: 'no contract deployed at address',
    })

    const res = await app.fetch(
      new Request(`http://localhost/agents/${agentRowId}/treasury`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          safeAddress: '0x' + '22'.repeat(20),
          deployTxHash: '0x' + 'bb'.repeat(32),
        }),
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('no contract deployed')
  })

  it('400s when deploy tx is not mined', async () => {
    const safe = await import('../src/lib/safe-bytecode.js')
    vi.mocked(safe.checkSafeBytecode).mockResolvedValue({ ok: true, reason: null })
    vi.mocked(safe.checkSafeDeployTx).mockResolvedValue({
      ok: false,
      reason: 'tx status is reverted',
    })

    const res = await app.fetch(
      new Request(`http://localhost/agents/${agentRowId}/treasury`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          safeAddress: '0x' + '33'.repeat(20),
          deployTxHash: '0x' + 'cc'.repeat(32),
        }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('403s when caller does not own the agent', async () => {
    const otherToken = await mintJwt({
      sub: '0x0000000000000000000000000000000000000099',
      ownerEoa: '0x0000000000000000000000000000000000000099',
      secret: process.env['JWT_SECRET']!,
    })
    const res = await app.fetch(
      new Request(`http://localhost/agents/${agentRowId}/treasury`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          safeAddress: '0x' + '44'.repeat(20),
          deployTxHash: '0x' + 'dd'.repeat(32),
        }),
      }),
    )
    expect(res.status).toBe(403)
  })

  it('401s without a token', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/agents/${agentRowId}/treasury`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          safeAddress: '0x' + '55'.repeat(20),
          deployTxHash: '0x' + 'ee'.repeat(32),
        }),
      }),
    )
    expect(res.status).toBe(401)
  })
})
