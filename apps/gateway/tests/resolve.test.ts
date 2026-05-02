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
