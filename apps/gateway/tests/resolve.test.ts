import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { encodeFunctionData, namehash, parseAbi, decodeAbiParameters, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const SIGNER_PK = '0x0000000000000000000000000000000000000000000000000000000000000001'
const SIGNER = privateKeyToAccount(SIGNER_PK)

let app: { fetch: (req: Request) => Promise<Response> }

beforeAll(async () => {
  process.env.GATEWAY_SIGNER_PRIVATE_KEY = SIGNER_PK
  app = (await import('../src/server.js')).default
})

afterAll(() => { delete process.env.GATEWAY_SIGNER_PRIVATE_KEY })

function buildResolveCalldata(name: string, innerData: `0x${string}`): `0x${string}` {
  // resolve(bytes,bytes) selector = 0x9061b923
  // Mirrors what the resolver contract puts into OffchainLookup.callData.
  // Encoded as call to `resolve(bytes name, bytes data)`.
  return encodeFunctionData({
    abi: parseAbi(['function resolve(bytes, bytes)']),
    functionName: 'resolve',
    args: [
      // Easier path for the test: pre-encode DNS name from helper
      // (we reuse the gateway's dnsEncode helper).
      toHex(new TextEncoder().encode(name)),  // placeholder; replaced below
      innerData,
    ],
  })
}

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
})
