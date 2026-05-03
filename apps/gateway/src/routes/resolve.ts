import { Hono } from 'hono'
import {
  decodeAbiParameters,
  encodeAbiParameters,
  getAddress,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { insertGatewayAnnouncement } from '@open-agents/db'
import { decodeDnsName } from '../lib/ens-decode.js'
import { encodeResolveResult, parseResolveData } from '../lib/ens-resolve-data.js'
import { signGatewayResponse } from '../lib/gateway-signer.js'
import { findGatewayAgent } from '../lib/agents-repo.js'
import { getGatewayDb } from '../lib/agents-repo.js'
import { findCurrentAnnouncement, recordAnnouncement } from '../lib/announcements-repo.js'
import { deriveStealthForQuery, predictStealthSafeAddress } from '@open-agents/crypto'
import { env } from '../env.js'

const SIG_VALIDITY_SECONDS = 60n

const signer = privateKeyToAccount(env.GATEWAY_SIGNER_PRIVATE_KEY as Hex)

export const resolveRoute = new Hono()

resolveRoute.get('/resolve/:sender/:data', async (c) => {
  const rawSender = c.req.param('sender')
  const dataParam = c.req.param('data').replace(/\.json$/, '') as Hex

  const RESOLVE_SELECTOR = '0x9061b923' as const
  if (!dataParam.startsWith(RESOLVE_SELECTOR)) {
    return c.json({ message: 'expected resolve() selector' }, 400)
  }
  const inner = `0x${dataParam.slice(10)}` as Hex

  let dnsName: Hex
  let recordCalldata: Hex
  try {
    ;[dnsName, recordCalldata] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'bytes' }],
      inner,
    ) as [Hex, Hex]
  } catch {
    return c.json({ message: 'malformed resolve() calldata' }, 400)
  }

  let labels: string[]
  try {
    labels = decodeDnsName(dnsName)
  } catch {
    return c.json({ message: 'malformed DNS-encoded name' }, 400)
  }

  if (labels.length < 3 || labels[1] !== 'gabhru' || labels[2] !== 'eth') {
    return c.json({ message: 'unsupported name tree' }, 400)
  }

  const subnameLabel = labels[0]!

  let parsed: ReturnType<typeof parseResolveData>
  try {
    parsed = parseResolveData(recordCalldata)
  } catch {
    return c.json({ message: 'unsupported inner record selector' }, 400)
  }

  const agent = await findGatewayAgent(subnameLabel)
  if (!agent) {
    return c.json({ message: `no agent for label '${subnameLabel}'` }, 404)
  }

  let value: Hex | string
  if (parsed.kind === 'addr' || parsed.kind === 'addrMulticoin') {
    if (agent.stealthMeta) {
      // Stable stealth address until paid:
      // 1. Reuse the existing unpaid announcement row so every CCIP-Read query
      //    returns the same stealth Safe address until a payment lands.
      // 2. Only derive a fresh stealth address (and write a new row) when there
      //    is no current unpaid row — or when the existing row has no Safe yet
      //    (legacy rows written before Path B was introduced).
      const existing = await findCurrentAnnouncement(agent.id)
      if (existing?.stealthSafeAddress) {
        value = existing.stealthSafeAddress
      } else {
        const out = deriveStealthForQuery(agent.stealthMeta)
        const stealthSafe = predictStealthSafeAddress(out.stealthAddress)
        value = stealthSafe
        void recordAnnouncement({
          agentRowId: agent.id,
          stealthAddress: out.stealthAddress,
          stealthSafeAddress: stealthSafe,
          ephemeralPub: out.ephemeralPubKey,
          viewTag: out.viewTag,
        })
      }
    } else {
      value = agent.baseAddr
    }
  } else if (parsed.kind === 'text') {
    if (parsed.key === 'stealth-payload') {
      // Plan 5: sender consoles need the stealth EOA + ephemeral pubkey +
      // view tag to call ERC-5564 announce(). We expose the current cycle's
      // issuance via this synthetic text record.
      //
      // Reads the same findCurrentAnnouncement the addr() branch uses, so
      // two consecutive CCIP-Read calls (`addr` → `text("stealth-payload")`)
      // reference the same issuance row by construction — no race, no cache.
      let issuance = await findCurrentAnnouncement(agent.id)
      if (!issuance && agent.stealthMeta) {
        const out = deriveStealthForQuery(agent.stealthMeta)
        const stealthSafe = predictStealthSafeAddress(out.stealthAddress)
        // We await this insert so the encode below sees the row we just wrote.
        // recordAnnouncement is fire-and-forget elsewhere, but here we need
        // synchronous availability.
        try {
          issuance = await insertGatewayAnnouncement(getGatewayDb(), {
            agentId: agent.id,
            stealthAddress: out.stealthAddress,
            stealthSafeAddress: stealthSafe,
            ephemeralPub: out.ephemeralPubKey,
            viewTag: out.viewTag,
          })
        } catch (err) {
          console.error('stealth-payload: insert failed', err)
        }
      }

      if (!issuance) {
        // No stealth-meta on this agent — return empty bytes.
        value = '0x'
      } else {
        // abi.encode(address stealthEoa, bytes ephemeralPub, uint8 viewTag).
        // Sender console abi-decodes the same shape and passes
        // (stealthEoa, ephemeralPub, [viewTag]) to ERC-5564 announce().
        value = encodeAbiParameters(
          [{ type: 'address' }, { type: 'bytes' }, { type: 'uint8' }],
          [
            issuance.stealthAddress as `0x${string}`,
            issuance.ephemeralPub as `0x${string}`,
            issuance.viewTag,
          ],
        )
      }
    } else {
      value = agent.textRecords[parsed.key] ?? ''
    }
  } else if (parsed.kind === 'contenthash') {
    value = '0x'
  } else {
    return c.json({ message: 'unsupported record' }, 400)
  }

  let target: Address
  try {
    target = getAddress(rawSender)
  } catch {
    return c.json({ message: 'invalid sender address' }, 400)
  }

  const result = encodeResolveResult(parsed, value)
  const expires = BigInt(Math.floor(Date.now() / 1000)) + SIG_VALIDITY_SECONDS

  const { encodedResponse } = await signGatewayResponse(signer, {
    target,
    expires,
    request: dataParam,
    result,
  })

  return c.json({ data: encodedResponse })
})
