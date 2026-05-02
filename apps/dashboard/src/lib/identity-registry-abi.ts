import type { Address } from 'viem'

/**
 * Minimal ERC-8004 IdentityRegistry ABI fragments used by the dashboard.
 * Full ABI lives in @open-agents/contracts (Plan 1) but the dashboard
 * doesn't depend on that workspace package today.
 */
export const IDENTITY_REGISTRY_ABI = [
  {
    name: 'register',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
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
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
    ],
  },
] as const

export const IDENTITY_REGISTRY_ADDRESS: Address =
  (process.env['NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS'] as Address | undefined) ??
  '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'

/** Plan 3 placeholder agent URI; Plan 5 pins the real JSON. */
export const PLAN3_PLACEHOLDER_AGENT_URI = 'ipfs://placeholder-plan3'
