import {
  createPublicClient,
  http,
  parseAbiItem,
  decodeEventLog,
  type Address,
  type TransactionReceipt,
  type Log,
} from 'viem'
import { base } from 'viem/chains'

const IDENTITY_REGISTRY_ABI = [
  {
    name: 'ownerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'getAgentWallet',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

export interface AgentWalletInfo {
  ownerAddress: Address
  agentWalletAddress: Address
}

export interface IsAuthorizedParams {
  rpcUrl: string
  registryAddress: Address
  agentId: bigint
  callerAddress: string
}

/**
 * Checks whether `callerAddress` is authorized to manage `agentId` by
 * verifying that it matches either `ownerOf(agentId)` or
 * `getAgentWallet(agentId)` on the IdentityRegistry contract.
 *
 * Returns false (does not throw) on RPC errors — the caller is responsible
 * for converting this into an appropriate HTTP error response.
 */
export async function isAuthorizedForAgent(params: IsAuthorizedParams): Promise<boolean> {
  try {
    const client = createPublicClient({
      chain: base,
      transport: http(params.rpcUrl, { timeout: 5_000 }),
    })
    const [ownerAddress, agentWalletAddress] = await Promise.all([
      client.readContract({
        address: params.registryAddress,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'ownerOf',
        args: [params.agentId],
      }),
      client.readContract({
        address: params.registryAddress,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'getAgentWallet',
        args: [params.agentId],
      }),
    ])
    const caller = params.callerAddress.toLowerCase()
    return (
      ownerAddress.toLowerCase() === caller ||
      agentWalletAddress.toLowerCase() === caller
    )
  } catch {
    return false
  }
}

/**
 * Fetches the owner and agent wallet addresses for an agent.
 * Throws on RPC errors (callers that need the actual addresses should
 * handle errors explicitly).
 */
export async function getAgentWalletInfo(params: {
  rpcUrl: string
  registryAddress: Address
  agentId: bigint
}): Promise<AgentWalletInfo> {
  const client = createPublicClient({
    chain: base,
    transport: http(params.rpcUrl, { timeout: 5_000 }),
  })
  const [ownerAddress, agentWalletAddress] = await Promise.all([
    client.readContract({
      address: params.registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'ownerOf',
      args: [params.agentId],
    }),
    client.readContract({
      address: params.registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getAgentWallet',
      args: [params.agentId],
    }),
  ])
  return { ownerAddress, agentWalletAddress }
}

const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
)

export interface RegisterReceiptCheck {
  rpcUrl: string
  registryAddress: Address
  txHash: `0x${string}`
  expectedTokenId: bigint
  expectedTo: Address
}

export interface RegisterReceiptResult {
  ok: boolean
  reason: string | null
}

/**
 * Verifies that `txHash` minted ERC-8004 token `expectedTokenId` to
 * `expectedTo` via the IdentityRegistry on Base mainnet.
 *
 * Returns { ok: false, reason } on any mismatch.
 */
export async function checkRegisterReceipt(
  params: RegisterReceiptCheck,
): Promise<RegisterReceiptResult> {
  const client = createPublicClient({
    chain: base,
    transport: http(params.rpcUrl, { timeout: 5_000 }),
  })

  let receipt: TransactionReceipt
  try {
    receipt = await client.getTransactionReceipt({ hash: params.txHash })
  } catch (err) {
    return { ok: false, reason: `getTransactionReceipt failed: ${String(err)}` }
  }

  if (receipt.status !== 'success') {
    return { ok: false, reason: `tx status is ${receipt.status}` }
  }

  const registryLower = params.registryAddress.toLowerCase()
  const expectedToLower = params.expectedTo.toLowerCase()

  const matchingLog = receipt.logs.find((log: Log) => {
    if (log.address.toLowerCase() !== registryLower) return false
    try {
      const decoded = decodeEventLog({
        abi: [TRANSFER_EVENT],
        data: log.data,
        topics: log.topics,
      })
      if (decoded.eventName !== 'Transfer') return false
      const args = decoded.args as { from: Address; to: Address; tokenId: bigint }
      return (
        args.from === '0x0000000000000000000000000000000000000000' &&
        args.to.toLowerCase() === expectedToLower &&
        args.tokenId === params.expectedTokenId
      )
    } catch {
      return false
    }
  })

  if (!matchingLog) {
    return {
      ok: false,
      reason: `no Transfer(0x0, ${params.expectedTo}, ${params.expectedTokenId}) log from ${params.registryAddress}`,
    }
  }

  return { ok: true, reason: null }
}
