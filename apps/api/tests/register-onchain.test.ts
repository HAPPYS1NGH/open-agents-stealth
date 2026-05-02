import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mintJwt } from '@open-agents/auth'
import { createDb, insertAgent } from '@open-agents/db'

process.env['DATABASE_URL'] = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
process.env['JWT_SECRET'] = 'test-secret-at-least-32-characters-here-xx'
process.env['BASE_RPC_URL'] = 'http://127.0.0.1:19999'

const OWNER = '0x0000000000000000000000000000000000000055'

vi.mock('../src/lib/identity-registry.js', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/identity-registry.js')>(
    '../src/lib/identity-registry.js',
  )
  return {
    ...actual,
    checkRegisterReceipt: vi.fn(),
    getAgentWalletInfo: vi.fn(),
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
    subnameLabel: 'test-plan3-register-' + Date.now(),
    baseAddr: '0x0000000000000000000000000000000000000002',
  })
  agentRowId = agent.id
})

describe('POST /agents/:id/register-onchain', () => {
  it('200s on a valid receipt + ownerOf match, persists agentId + agentWalletEoa', async () => {
    const reg = await import('../src/lib/identity-registry.js')
    vi.mocked(reg.checkRegisterReceipt).mockResolvedValue({ ok: true, reason: null })
    vi.mocked(reg.getAgentWalletInfo).mockResolvedValue({
      ownerAddress: OWNER as `0x${string}`,
      agentWalletAddress: OWNER as `0x${string}`,
    })

    const res = await app.fetch(
      new Request(`http://localhost/agents/${agentRowId}/register-onchain`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: '8453:42',
          txHash: '0x' + 'aa'.repeat(32),
        }),
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json() as { agentId: string; agentWalletEoa: string }
    expect(body.agentId).toBe('8453:42')
    expect(body.agentWalletEoa.toLowerCase()).toBe(OWNER.toLowerCase())
  })

  it('400s when checkRegisterReceipt fails', async () => {
    const reg = await import('../src/lib/identity-registry.js')
    vi.mocked(reg.checkRegisterReceipt).mockResolvedValue({
      ok: false,
      reason: 'tx status is reverted',
    })

    const res = await app.fetch(
      new Request(`http://localhost/agents/${agentRowId}/register-onchain`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: '8453:43', txHash: '0x' + 'bb'.repeat(32) }),
      }),
    )

    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('reverted')
  })

  it('403s when getAgentWalletInfo.ownerAddress does not match the caller', async () => {
    const reg = await import('../src/lib/identity-registry.js')
    vi.mocked(reg.checkRegisterReceipt).mockResolvedValue({ ok: true, reason: null })
    vi.mocked(reg.getAgentWalletInfo).mockResolvedValue({
      ownerAddress: '0x0000000000000000000000000000000000000099' as `0x${string}`,
      agentWalletAddress: '0x0000000000000000000000000000000000000099' as `0x${string}`,
    })

    const res = await app.fetch(
      new Request(`http://localhost/agents/${agentRowId}/register-onchain`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: '8453:44', txHash: '0x' + 'cc'.repeat(32) }),
      }),
    )

    expect(res.status).toBe(403)
  })

  it('400s on malformed agentId', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/agents/${agentRowId}/register-onchain`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'not-a-cip-id', txHash: '0x' + 'dd'.repeat(32) }),
      }),
    )

    expect(res.status).toBe(400)
  })

  it('401s without a token', async () => {
    const res = await app.fetch(
      new Request(`http://localhost/agents/${agentRowId}/register-onchain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: '8453:45', txHash: '0x' + 'ee'.repeat(32) }),
      }),
    )
    expect(res.status).toBe(401)
  })
})
