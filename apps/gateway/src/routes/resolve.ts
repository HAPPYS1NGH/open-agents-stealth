import { Hono } from 'hono'
import { decodeAbiParameters, getAddress, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { decodeDnsName } from '../lib/ens-decode.js'
import { encodeResolveResult, parseResolveData } from '../lib/ens-resolve-data.js'
import { signGatewayResponse } from '../lib/gateway-signer.js'
import { findStubAgent } from '../lib/stub-agents.js'
import { env } from '../env.js'

const SIG_VALIDITY_SECONDS = 60n  // signed responses expire in 60s

const signer = privateKeyToAccount(env.GATEWAY_SIGNER_PRIVATE_KEY as Hex)

export const resolveRoute = new Hono()

resolveRoute.get('/resolve/:sender/:data', async (c) => {
  const rawSender = c.req.param('sender')
  // Vercel rewrites strip trailing extensions, but ENS clients append .json.
  const dataParam = c.req.param('data').replace(/\.json$/, '') as Hex

  // The 'data' parameter is itself a calldata for resolve(bytes, bytes).
  // Decode it to get the DNS-encoded name and the inner record-type calldata.
  const RESOLVE_SELECTOR = '0x9061b923' as const
  if (!dataParam.startsWith(RESOLVE_SELECTOR)) {
    return c.json({ message: 'expected resolve() selector' }, 400)
  }
  const inner = `0x${dataParam.slice(10)}` as Hex
  const [dnsName, recordCalldata] = decodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes' }],
    inner,
  ) as [Hex, Hex]

  const labels = decodeDnsName(dnsName)
  if (labels.length < 2) {
    return c.json({ message: 'name too short' }, 400)
  }
  // Expecting <label>.gabhru.eth
  const subnameLabel = labels[0]!
  const parsed = parseResolveData(recordCalldata)
  const agent = findStubAgent(subnameLabel)
  if (!agent) {
    return c.json({ message: `no agent for label '${subnameLabel}'` }, 404)
  }

  // Build the response value based on the record kind.
  let value: Hex | string
  if (parsed.kind === 'addr' || parsed.kind === 'addrMulticoin') {
    value = agent.baseAddr
  } else if (parsed.kind === 'text') {
    value = agent.textRecords[parsed.key] ?? ''
  } else if (parsed.kind === 'contenthash') {
    value = '0x'  // not implemented for stub
  } else {
    return c.json({ message: 'unsupported record' }, 400)
  }

  // Checksum the sender address — do this after early 404 exits so invalid
  // addresses in test-only 404 paths don't throw before the lookup runs.
  const target = getAddress(rawSender) as Address

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
