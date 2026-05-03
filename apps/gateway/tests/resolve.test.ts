import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { encodeFunctionData, namehash, parseAbi, decodeAbiParameters } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createDb, insertAgent } from '@open-agents/db'

const SIGNER_PK = '0x0000000000000000000000000000000000000000000000000000000000000001'
const SIGNER = privateKeyToAccount(SIGNER_PK)
const DB_URL = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'

let app: { fetch: (req: Request) => Promise<Response> }

beforeAll(async () => {
  process.env.GATEWAY_SIGNER_PRIVATE_KEY = SIGNER_PK
  process.env.DATABASE_URL = DB_URL
  app = (await import('../src/server.js')).default

  // Seed the 'test' agent that the resolve tests look up.
  const db = createDb(DB_URL)
  await insertAgent(db, {
    ownerEoa: '0x0000000000000000000000000000000000000001',
    subnameLabel: 'test',
    baseAddr: '0x000000000000000000000000000000000000bEEF',
    textRecords: {
      'agent-context': '{"name":"Plan 1 stub","description":"Hardcoded; replaced in Plan 4."}',
    },
  }).catch(() => { /* row may already exist from a prior run */ })
})

afterAll(() => { delete process.env.GATEWAY_SIGNER_PRIVATE_KEY })

describe('GET /resolve/:sender/:data', () => {
  it('returns a signed addr() response for test.gabhru.eth', async () => {
    const node = namehash('test.gabhru.eth')
    const innerData = encodeFunctionData({
      abi: parseAbi(['function addr(bytes32) view returns (address)']),
      functionName: 'addr',
      args: [node],
    })

    // We need DNS-encoded name. Pull from our helper.
    const { dnsEncode } = await import('../src/lib/ens-decode.js')
    const dns = `0x${Buffer.from(dnsEncode('test.gabhru.eth')).toString('hex')}` as `0x${string}`

    const resolveCalldata = encodeFunctionData({
      abi: parseAbi(['function resolve(bytes, bytes)']),
      functionName: 'resolve',
      args: [dns, innerData],
    })

    const sender = '0x000000000000000000000000000000000000CAFE'
    const url = `http://localhost/resolve/${sender}/${resolveCalldata}.json`
    const res = await app.fetch(new Request(url))

    expect(res.status).toBe(200)
    const body = await res.json() as { data: `0x${string}` }
    expect(body.data).toMatch(/^0x[0-9a-f]+$/i)

    const [resultBytes, expires, sig] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
      body.data,
    )
    expect(typeof expires).toBe('bigint')
    expect((sig as `0x${string}`).length).toBe(2 + 65 * 2) // 65 bytes hex
    const [addr] = decodeAbiParameters([{ type: 'address' }], resultBytes as `0x${string}`)
    expect((addr as string).toLowerCase()).toBe('0x000000000000000000000000000000000000beef')
  })

  it('returns 404 for an unknown subname', async () => {
    const node = namehash('doesnotexist.gabhru.eth')
    const innerData = encodeFunctionData({
      abi: parseAbi(['function addr(bytes32) view returns (address)']),
      functionName: 'addr',
      args: [node],
    })
    const { dnsEncode } = await import('../src/lib/ens-decode.js')
    const dns = `0x${Buffer.from(dnsEncode('doesnotexist.gabhru.eth')).toString('hex')}` as `0x${string}`
    const resolveCalldata = encodeFunctionData({
      abi: parseAbi(['function resolve(bytes, bytes)']),
      functionName: 'resolve',
      args: [dns, innerData],
    })

    const url = `http://localhost/resolve/0x0/${resolveCalldata}.json`
    const res = await app.fetch(new Request(url))
    expect(res.status).toBe(404)
  })

  it('returns 400 for unsupported record selector', async () => {
    const { dnsEncode } = await import('../src/lib/ens-decode.js')
    const dns = `0x${Buffer.from(dnsEncode('test.gabhru.eth')).toString('hex')}` as `0x${string}`

    // Use an unsupported selector 0xdeadbeef with zero padding (32 bytes of params)
    const unsupportedInnerData = ('0xdeadbeef' + '00'.repeat(32)) as `0x${string}`

    const resolveCalldata = encodeFunctionData({
      abi: parseAbi(['function resolve(bytes, bytes)']),
      functionName: 'resolve',
      args: [dns, unsupportedInnerData],
    })

    const sender = '0x000000000000000000000000000000000000CAFE'
    const url = `http://localhost/resolve/${sender}/${resolveCalldata}.json`
    const res = await app.fetch(new Request(url))
    expect(res.status).toBe(400)
    const body = await res.json() as { message: string }
    expect(body.message).toBe('unsupported inner record selector')
  })

  it('returns 400 for non-gabhru.eth parent', async () => {
    const node = namehash('test.other.eth')
    const innerData = encodeFunctionData({
      abi: parseAbi(['function addr(bytes32) view returns (address)']),
      functionName: 'addr',
      args: [node],
    })

    const { dnsEncode } = await import('../src/lib/ens-decode.js')
    const dns = `0x${Buffer.from(dnsEncode('test.other.eth')).toString('hex')}` as `0x${string}`

    const resolveCalldata = encodeFunctionData({
      abi: parseAbi(['function resolve(bytes, bytes)']),
      functionName: 'resolve',
      args: [dns, innerData],
    })

    const sender = '0x000000000000000000000000000000000000CAFE'
    const url = `http://localhost/resolve/${sender}/${resolveCalldata}.json`
    const res = await app.fetch(new Request(url))
    expect(res.status).toBe(400)
    const body = await res.json() as { message: string }
    expect(body.message).toBe('unsupported name tree')
  })

  it('returns a signed text() response', async () => {
    const node = namehash('test.gabhru.eth')
    const innerData = encodeFunctionData({
      abi: parseAbi(['function text(bytes32, string) view returns (string)']),
      functionName: 'text',
      args: [node, 'agent-context'],
    })

    const { dnsEncode } = await import('../src/lib/ens-decode.js')
    const dns = `0x${Buffer.from(dnsEncode('test.gabhru.eth')).toString('hex')}` as `0x${string}`

    const resolveCalldata = encodeFunctionData({
      abi: parseAbi(['function resolve(bytes, bytes)']),
      functionName: 'resolve',
      args: [dns, innerData],
    })

    const sender = '0x000000000000000000000000000000000000CAFE'
    const url = `http://localhost/resolve/${sender}/${resolveCalldata}.json`
    const res = await app.fetch(new Request(url))

    expect(res.status).toBe(200)
    const body = await res.json() as { data: `0x${string}` }
    expect(body.data).toMatch(/^0x[0-9a-f]+$/i)

    const [resultBytes, expires, sig] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
      body.data,
    )
    expect(typeof expires).toBe('bigint')
    expect((sig as `0x${string}`).length).toBe(2 + 65 * 2) // 65 bytes hex
    const [textValue] = decodeAbiParameters([{ type: 'string' }], resultBytes as `0x${string}`)
    expect(textValue).toBe('{"name":"Plan 1 stub","description":"Hardcoded; replaced in Plan 4."}')
  })
})

import { secp256k1 } from '@noble/curves/secp256k1'
import { bytesToHex } from 'viem'
import { buildMetaAddress, predictStealthSafeAddress } from '@open-agents/crypto'
import { listAnnouncementsByAgent } from '@open-agents/db'

const SPEND_PRIV_T7 = '0x' + '11'.repeat(32)
const VIEW_PRIV_T7 = '0x' + '22'.repeat(32)
const SPEND_PUB_T7 = bytesToHex(secp256k1.getPublicKey(SPEND_PRIV_T7.slice(2), true))
const VIEW_PUB_T7 = bytesToHex(secp256k1.getPublicKey(VIEW_PRIV_T7.slice(2), true))
const META_T7 = buildMetaAddress(SPEND_PUB_T7, VIEW_PUB_T7)

describe('GET /resolve/:sender/:data — stealth-meta path', () => {
  let stealthAgentId: string
  let stealthLabel: string

  beforeAll(async () => {
    stealthLabel = 'stealth-' + Date.now()
    const db = createDb(DB_URL)
    const agent = await insertAgent(db, {
      ownerEoa: '0x0000000000000000000000000000000000000010',
      subnameLabel: stealthLabel,
      baseAddr: '0x000000000000000000000000000000000000DEAD',
      textRecords: { 'stealth-meta': META_T7 },
    })
    stealthAgentId = agent.id
  })

  it('returns the SAME addr() answer on repeated calls (stable stealth address until paid)', async () => {
    const node = namehash(`${stealthLabel}.gabhru.eth`)
    const innerData = encodeFunctionData({
      abi: parseAbi(['function addr(bytes32) view returns (address)']),
      functionName: 'addr',
      args: [node],
    })
    const { dnsEncode } = await import('../src/lib/ens-decode.js')
    const dns = `0x${Buffer.from(dnsEncode(`${stealthLabel}.gabhru.eth`)).toString('hex')}` as `0x${string}`
    const resolveCalldata = encodeFunctionData({
      abi: parseAbi(['function resolve(bytes, bytes)']),
      functionName: 'resolve',
      args: [dns, innerData],
    })
    const sender = '0x000000000000000000000000000000000000CAFE'
    const url = `http://localhost/resolve/${sender}/${resolveCalldata}.json`

    const res1 = await app.fetch(new Request(url))
    // Wait for the fire-and-forget recordAnnouncement to complete before the 2nd call
    await new Promise((r) => setTimeout(r, 100))
    const res2 = await app.fetch(new Request(url))
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    const body1 = (await res1.json()) as { data: `0x${string}` }
    const body2 = (await res2.json()) as { data: `0x${string}` }

    const [resultBytes1] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
      body1.data,
    )
    const [resultBytes2] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
      body2.data,
    )
    const [addr1] = decodeAbiParameters([{ type: 'address' }], resultBytes1 as `0x${string}`)
    const [addr2] = decodeAbiParameters([{ type: 'address' }], resultBytes2 as `0x${string}`)

    // Both calls must return the same stealth Safe address
    expect((addr1 as string).toLowerCase()).toBe((addr2 as string).toLowerCase())
    // It must NOT be the base addr fallback
    expect((addr1 as string).toLowerCase()).not.toBe('0x000000000000000000000000000000000000dead')
  })

  it('writes exactly one gateway_announcements row for the first addr() call; repeated calls reuse it', async () => {
    const db = createDb(DB_URL)
    const before = await listAnnouncementsByAgent(db, stealthAgentId, 100)

    const node = namehash(`${stealthLabel}.gabhru.eth`)
    const innerData = encodeFunctionData({
      abi: parseAbi(['function addr(bytes32) view returns (address)']),
      functionName: 'addr',
      args: [node],
    })
    const { dnsEncode } = await import('../src/lib/ens-decode.js')
    const dns = `0x${Buffer.from(dnsEncode(`${stealthLabel}.gabhru.eth`)).toString('hex')}` as `0x${string}`
    const resolveCalldata = encodeFunctionData({
      abi: parseAbi(['function resolve(bytes, bytes)']),
      functionName: 'resolve',
      args: [dns, innerData],
    })
    const sender = '0x000000000000000000000000000000000000BEEF'
    const url = `http://localhost/resolve/${sender}/${resolveCalldata}.json`

    // First call — may write a new row if no unpaid row exists yet
    await app.fetch(new Request(url))
    await new Promise((r) => setTimeout(r, 100))

    const afterFirst = await listAnnouncementsByAgent(db, stealthAgentId, 100)
    // At most one new row should have been written since `before`
    expect(afterFirst.length).toBeLessThanOrEqual(before.length + 1)

    // Make two more calls — row count must NOT grow (stable reuse)
    await app.fetch(new Request(url))
    await app.fetch(new Request(url))
    await new Promise((r) => setTimeout(r, 100))

    const afterRepeated = await listAnnouncementsByAgent(db, stealthAgentId, 100)
    expect(afterRepeated.length).toBe(afterFirst.length)

    const newest = afterRepeated[0]!
    expect(newest.viewTag).toBeGreaterThanOrEqual(0)
    expect(newest.viewTag).toBeLessThanOrEqual(255)
    expect(newest.ephemeralPub).toMatch(/^0x[0-9a-f]{66}$/)
    // Path B: both the stealth EOA and the predicted Safe must be present.
    expect(newest.stealthAddress).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(newest.stealthSafeAddress).toMatch(/^0x[0-9a-fA-F]{40}$/)
    // The Safe is exactly what predictStealthSafeAddress(eoa) returns.
    expect(newest.stealthSafeAddress?.toLowerCase()).toBe(
      predictStealthSafeAddress(newest.stealthAddress as `0x${string}`).toLowerCase(),
    )
    // EOA != Safe (different addresses by construction).
    expect(newest.stealthAddress.toLowerCase()).not.toBe(newest.stealthSafeAddress?.toLowerCase())
  })

  it('addr() returns the stealth Safe (not the EOA), matching the announcement', async () => {
    const node = namehash(`${stealthLabel}.gabhru.eth`)
    const innerData = encodeFunctionData({
      abi: parseAbi(['function addr(bytes32) view returns (address)']),
      functionName: 'addr',
      args: [node],
    })
    const { dnsEncode } = await import('../src/lib/ens-decode.js')
    const dns = `0x${Buffer.from(dnsEncode(`${stealthLabel}.gabhru.eth`)).toString('hex')}` as `0x${string}`
    const resolveCalldata = encodeFunctionData({
      abi: parseAbi(['function resolve(bytes, bytes)']),
      functionName: 'resolve',
      args: [dns, innerData],
    })
    const sender = '0x000000000000000000000000000000000000FEED'
    const url = `http://localhost/resolve/${sender}/${resolveCalldata}.json`

    const res = await app.fetch(new Request(url))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: `0x${string}` }
    const [resBytes] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
      body.data,
    )
    const [returnedAddr] = decodeAbiParameters(
      [{ type: 'address' }],
      resBytes as `0x${string}`,
    )

    await new Promise((r) => setTimeout(r, 100))
    const db = createDb(DB_URL)
    const after = await listAnnouncementsByAgent(db, stealthAgentId, 100)
    const newest = after[0]!
    expect((returnedAddr as string).toLowerCase()).toBe(
      newest.stealthSafeAddress!.toLowerCase(),
    )
    // Sanity: the returned addr is NOT the EOA; it's the Safe.
    expect((returnedAddr as string).toLowerCase()).not.toBe(newest.stealthAddress.toLowerCase())
  })

  it('text() lookups still return the stealth-meta record verbatim', async () => {
    const node = namehash(`${stealthLabel}.gabhru.eth`)
    const innerData = encodeFunctionData({
      abi: parseAbi(['function text(bytes32, string) view returns (string)']),
      functionName: 'text',
      args: [node, 'stealth-meta'],
    })
    const { dnsEncode } = await import('../src/lib/ens-decode.js')
    const dns = `0x${Buffer.from(dnsEncode(`${stealthLabel}.gabhru.eth`)).toString('hex')}` as `0x${string}`
    const resolveCalldata = encodeFunctionData({
      abi: parseAbi(['function resolve(bytes, bytes)']),
      functionName: 'resolve',
      args: [dns, innerData],
    })
    const sender = '0x0000000000000000000000000000000000000DAD'
    const url = `http://localhost/resolve/${sender}/${resolveCalldata}.json`

    const res = await app.fetch(new Request(url))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: `0x${string}` }
    const [resultBytes] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
      body.data,
    )
    const [text] = decodeAbiParameters([{ type: 'string' }], resultBytes as `0x${string}`)
    expect((text as string).toLowerCase()).toBe(META_T7.toLowerCase())
  })
})
