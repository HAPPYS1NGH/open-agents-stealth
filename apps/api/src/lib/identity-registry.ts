import { createPublicClient, http, type Address } from 'viem'
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
