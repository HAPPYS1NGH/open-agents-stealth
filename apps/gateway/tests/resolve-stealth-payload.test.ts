import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  decodeAbiParameters,
  encodeFunctionData,
  namehash,
  parseAbi,
} from 'viem'
import { randomBytes } from 'node:crypto'
import { secp256k1 } from '@noble/curves/secp256k1'
import { bytesToHex } from 'viem/utils'
import { buildMetaAddress } from '@open-agents/crypto'
import {
  createDb,
  insertAgent,
  insertGatewayAnnouncement,
  findCurrentAnnouncement,
} from '@open-agents/db'

// Generates a real ENSIP-26 stealth meta-address (132 hex = two compressed
// secp256k1 pubkeys) so the gateway's cold-start ECDH derivation works.
function makeStealthMeta(): `0x${string}` {
  const spendPriv = randomBytes(32)
  const viewPriv = randomBytes(32)
  const spendPub = ('0x' + bytesToHex(secp256k1.getPublicKey(spendPriv, true)).slice(2)) as `0x${string}`
  const viewPub = ('0x' + bytesToHex(secp256k1.getPublicKey(viewPriv, true)).slice(2)) as `0x${string}`
  return buildMetaAddress(spendPub, viewPub)
}

const SIGNER_PK = '0x' + '01'.repeat(32)
const DB_URL = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'

let app: { fetch: (req: Request) => Promise<Response> }
let db: ReturnType<typeof createDb>

const RUN_TAG = Date.now().toString(16).slice(-8)
const SUBLABEL = 'sp-' + RUN_TAG
let agentRowId: string
const STEALTH = ('0x' + RUN_TAG + 'cd'.repeat(16)).toLowerCase() as `0x${string}`
const SAFE = ('0x' + RUN_TAG + 'ce'.repeat(16)).toLowerCase() as `0x${string}`
const EPH = '0x02' + RUN_TAG + '7f'.repeat(28)

beforeAll(async () => {
  process.env.GATEWAY_SIGNER_PRIVATE_KEY = SIGNER_PK
  process.env.DATABASE_URL = DB_URL
  process.env.GATEWAY_ANNOUNCEMENTS = 'on'
  app = (await import('../src/server.js')).default

  db = createDb(DB_URL)
  const agent = await insertAgent(db, {
    ownerEoa: '0x0000000000000000000000000000000000000099',
    subnameLabel: SUBLABEL,
    baseAddr: '0x0000000000000000000000000000000000000001',
    textRecords: { 'stealth-meta': '0x' + 'aa'.repeat(33) + 'bb'.repeat(33) },
  })
  agentRowId = agent.id
  await insertGatewayAnnouncement(db, {
    agentId: agentRowId,
    stealthAddress: STEALTH,
    stealthSafeAddress: SAFE,
    ephemeralPub: EPH,
    viewTag: 0x42,
  })
})

afterAll(() => {
  delete process.env.GATEWAY_SIGNER_PRIVATE_KEY
  delete process.env.GATEWAY_ANNOUNCEMENTS
})

async function callTextStealthPayload(label: string): Promise<{
  status: number
  body: string
}> {
  const node = namehash(`${label}.gabhru.eth`)
  const innerData = encodeFunctionData({
    abi: parseAbi(['function text(bytes32 node, string key) view returns (string)']),
    functionName: 'text',
    args: [node, 'stealth-payload'],
  })
  const { dnsEncode } = await import('../src/lib/ens-decode.js')
  const dns = `0x${Buffer.from(dnsEncode(`${label}.gabhru.eth`)).toString('hex')}` as `0x${string}`
  const resolveCalldata = encodeFunctionData({
    abi: parseAbi(['function resolve(bytes, bytes)']),
    functionName: 'resolve',
    args: [dns, innerData],
  })
  const sender = '0x000000000000000000000000000000000000CAFE'
  const url = `http://localhost/resolve/${sender}/${resolveCalldata}.json`
  const res = await app.fetch(new Request(url))
  return { status: res.status, body: await res.text() }
}

describe('GET /resolve — text(node, "stealth-payload")', () => {
  it('returns abi-encoded (stealthEoa, ephemeralPub, viewTag) for the current issuance', async () => {
    const { status, body } = await callTextStealthPayload(SUBLABEL)
    expect(status).toBe(200)

    // The CCIP-Read response is { data: bytes }. The signer wraps the inner
    // result with (bytes data, uint64 expires, bytes signature). The
    // resolve route's encoder wraps the value as encodeAbiParameters([{type:'string'}], [...])
    // for text() responses (per encodeResolveResult in ens-resolve-data.ts).
    const json = JSON.parse(body) as { data: `0x${string}` }
    const [outerSignedBytes] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
      json.data,
    ) as [`0x${string}`, bigint, `0x${string}`]
    const [textValue] = decodeAbiParameters(
      [{ type: 'string' }],
      outerSignedBytes,
    ) as [string]
    // textValue is the abi.encoded (address, bytes, uint8) hex string —
    // because the gateway returned it as `value` for the text() answer.
    const innerHex = textValue as `0x${string}`
    const [stealthEoa, ephPub, viewTag] = decodeAbiParameters(
      [{ type: 'address' }, { type: 'bytes' }, { type: 'uint8' }],
      innerHex,
    ) as [`0x${string}`, `0x${string}`, number]

    expect(stealthEoa.toLowerCase()).toBe(STEALTH.toLowerCase())
    expect(ephPub.toLowerCase()).toBe(EPH.toLowerCase())
    expect(viewTag).toBe(0x42)
  })

  it('survives a fresh agent with no announcements (generates one)', async () => {
    const freshLabel = 'sp-fresh-' + RUN_TAG
    const fresh = await insertAgent(db, {
      ownerEoa: '0x' + 'aa'.repeat(20),
      subnameLabel: freshLabel,
      baseAddr: '0x0000000000000000000000000000000000000001',
      textRecords: { 'stealth-meta': makeStealthMeta() },
    })
    expect(await findCurrentAnnouncement(db, fresh.id)).toBeNull()

    const { status } = await callTextStealthPayload(freshLabel)
    expect(status).toBe(200)
    expect(await findCurrentAnnouncement(db, fresh.id)).not.toBeNull()
  })
})
