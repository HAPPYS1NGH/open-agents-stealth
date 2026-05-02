import { describe, expect, it } from 'vitest'
import { isAuthorizedForAgent } from '../src/lib/identity-registry.js'

const runOnChain = !!process.env['BASE_RPC_URL'] && process.env['BASE_RPC_URL'].startsWith('http')

describe.skipIf(!runOnChain)('isAuthorizedForAgent (Base mainnet)', () => {
  it('returns false for a zero address against agentId 1', async () => {
    const result = await isAuthorizedForAgent({
      rpcUrl: process.env['BASE_RPC_URL']!,
      registryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
      agentId: 1n,
      callerAddress: '0x0000000000000000000000000000000000000000',
    })
    expect(result).toBe(false)
  })
})

describe('isAuthorizedForAgent (offline unit)', () => {
  it('returns false without throwing when RPC is unreachable', async () => {
    const result = await isAuthorizedForAgent({
      rpcUrl: 'http://127.0.0.1:19999',
      registryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
      agentId: 42n,
      callerAddress: '0x0000000000000000000000000000000000000001',
    })
    expect(result).toBe(false)
  })
})
