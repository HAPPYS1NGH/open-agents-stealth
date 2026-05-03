import { beforeAll, describe, expect, it } from 'vitest'
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { bytesToHex, encodeFunctionData, namehash, parseAbi, decodeAbiParameters } from 'viem'
import { mintJwt } from '@open-agents/auth'
import { createDb, insertAgent, listAnnouncementsByAgent } from '@open-agents/db'
import {
  deriveStealthKeysFromSignature,
  predictStealthSafeAddress,
  STEALTH_DERIVATION_MESSAGE,
} from '@open-agents/crypto'

process.env['DATABASE_URL'] = 'postgres://open_agents:open_agents_dev@localhost:5434/open_agents'
process.env['JWT_SECRET'] = 'test-secret-at-least-32-characters-here-xx'
process.env['BASE_RPC_URL'] = 'http://127.0.0.1:19999'
process.env['VIEW_KEY_MASTER_KEY'] = '0x' + 'aa'.repeat(32)
process.env['GATEWAY_SIGNER_PRIVATE_KEY'] = '0x' + '01'.repeat(32)
process.env['GATEWAY_ANNOUNCEMENTS'] = 'on'

const OWNER = '0x0000000000000000000000000000000000000088'
const OWNER_PRIV = '0x' + '88'.repeat(32)

let apiApp: { fetch: (req: Request) => Promise<Response> }
let gatewayApp: { fetch: (req: Request) => Promise<Response> }
let validToken: string
let agentRowId: string
let subname: string

function eip191Hash(message: string): Uint8Array {
  const prefix = `\x19Ethereum Signed Message:\n${message.length}`
  return keccak_256(new TextEncoder().encode(prefix + message))
}

function fakeSignature(priv: string, message: string): `0x${string}` {
  const sig = secp256k1.sign(eip191Hash(message), priv.slice(2))
  const r = sig.r.toString(16).padStart(64, '0')
  const s = sig.s.toString(16).padStart(64, '0')
  const v = (27 + (sig.recovery ?? 0)).toString(16).padStart(2, '0')
  return `0x${r}${s}${v}` as `0x${string}`
}

beforeAll(async () => {
  apiApp = (await import('../src/server.js')).default
  gatewayApp = (await import('../../gateway/src/server.js')).default
  validToken = await mintJwt({ sub: OWNER, ownerEoa: OWNER, secret: process.env['JWT_SECRET']! })

  subname = 'e2e-' + Date.now()
  const db = createDb(process.env['DATABASE_URL']!)
  const row = await insertAgent(db, {
    ownerEoa: OWNER,
    subnameLabel: subname,
    baseAddr: '0x0000000000000000000000000000000000000088',
  })
  agentRowId = row.id
})

describe('Plan 4 end-to-end', () => {
  it('walks wizard → api → DB → gateway and proves freshness + receiver-side recovery', async () => {
    const sig = fakeSignature(OWNER_PRIV, STEALTH_DERIVATION_MESSAGE)
    const derived = deriveStealthKeysFromSignature(sig)

    const postRes = await apiApp.fetch(
      new Request(`http://localhost/agents/${agentRowId}/view-key`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          viewKey: derived.viewPrivKey,
          stealthMeta: derived.stealthMetaAddress,
        }),
      }),
    )
    expect(postRes.status).toBe(200)
    const postBody = (await postRes.json()) as { viewKeyEncrypted: string; textRecords: Record<string, string> }
    expect(postBody.viewKeyEncrypted.startsWith('v1:')).toBe(true)
    expect(postBody.textRecords['stealth-meta']).toBe(derived.stealthMetaAddress)

    const node = namehash(`${subname}.gabhru.eth`)
    const innerData = encodeFunctionData({
      abi: parseAbi(['function addr(bytes32) view returns (address)']),
      functionName: 'addr',
      args: [node],
    })
    const { dnsEncode } = await import('../../gateway/src/lib/ens-decode.js')
    const dns = `0x${Buffer.from(dnsEncode(`${subname}.gabhru.eth`)).toString('hex')}` as `0x${string}`
    const resolveCalldata = encodeFunctionData({
      abi: parseAbi(['function resolve(bytes, bytes)']),
      functionName: 'resolve',
      args: [dns, innerData],
    })
    const url = `http://localhost/resolve/0x000000000000000000000000000000000000CAFE/${resolveCalldata}.json`

    const r1 = await gatewayApp.fetch(new Request(url))
    const r2 = await gatewayApp.fetch(new Request(url))
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    const b1 = (await r1.json()) as { data: `0x${string}` }
    const b2 = (await r2.json()) as { data: `0x${string}` }
    const [resBytes1] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
      b1.data,
    )
    const [resBytes2] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
      b2.data,
    )
    const [addr1] = decodeAbiParameters([{ type: 'address' }], resBytes1 as `0x${string}`)
    const [addr2] = decodeAbiParameters([{ type: 'address' }], resBytes2 as `0x${string}`)
    expect(addr1).not.toBe(addr2)

    await new Promise((r) => setTimeout(r, 200))
    const db = createDb(process.env['DATABASE_URL']!)
    const announcements = await listAnnouncementsByAgent(db, agentRowId, 100)
    expect(announcements.length).toBeGreaterThanOrEqual(2)

    const newest = announcements[0]!
    const sharedCompressed = secp256k1.getSharedSecret(
      derived.viewPrivKey.slice(2),
      newest.ephemeralPub.slice(2),
      true,
    )
    const sharedXOnly = sharedCompressed.slice(1)
    const h = keccak_256(sharedXOnly)
    expect(h[0]).toBe(newest.viewTag)

    const spendPubBytes = secp256k1.getPublicKey(derived.spendPrivKey.slice(2), true)
    const spendPoint = secp256k1.ProjectivePoint.fromHex(bytesToHex(spendPubBytes).slice(2))
    let n = 0n
    for (const b of h) n = (n << 8n) | BigInt(b)
    const hScalar = n % secp256k1.CURVE.n
    const childPoint = spendPoint.add(secp256k1.ProjectivePoint.BASE.multiply(hScalar))
    const childPubXY = childPoint.toRawBytes(false).slice(1)
    const recoveredAddrBytes = keccak_256(childPubXY).slice(-20)
    const recoveredEoa = `0x${Buffer.from(recoveredAddrBytes).toString('hex')}`.toLowerCase()
    expect(recoveredEoa).toBe(newest.stealthAddress.toLowerCase())

    // === Step F (Path B): the address the gateway returned (addr2 — newest)
    // is the predicted Safe owned by the recovered EOA, NOT the EOA itself.
    // This is the privacy-meaningful contract: payers fund a Safe address that
    // can be sweep-deployed via paymaster without ever needing ETH at the EOA.
    // (addr1 belongs to the previous announcement, also a Safe but for a
    // different EOA derived from a different ephemeral key.) ===
    const predictedSafe = predictStealthSafeAddress(recoveredEoa as `0x${string}`).toLowerCase()
    expect((addr2 as string).toLowerCase()).toBe(predictedSafe)
    expect(newest.stealthSafeAddress?.toLowerCase()).toBe(predictedSafe)
    expect(predictedSafe).not.toBe(recoveredEoa)
  })
})
