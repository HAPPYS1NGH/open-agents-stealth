import { describe, expect, it } from 'vitest'
import { checkSafeBytecode } from '../src/lib/safe-bytecode.js'

const RPC = process.env['BASE_RPC_URL_FOR_TESTS'] ?? 'https://mainnet.base.org'

const SAFE_V13_USER_DEPLOY = '0xC71142C661070f9a1b436EA159073e50E169A13b' as const
const NOT_A_SAFE = '0x4200000000000000000000000000000000000006' as const // WETH on Base
const NOT_DEPLOYED = '0x000000000000000000000000000000000000DEAD' as const

describe('checkSafeBytecode (live Base mainnet)', () => {
  it('accepts a Safe v1.3.0-L2 proxy', async () => {
    const r = await checkSafeBytecode({
      rpcUrl: RPC,
      safeAddress: SAFE_V13_USER_DEPLOY,
    })
    expect(r.ok).toBe(true)
    expect(r.reason).toBeNull()
  }, 15_000)

  it('rejects a non-Safe contract', async () => {
    const r = await checkSafeBytecode({
      rpcUrl: RPC,
      safeAddress: NOT_A_SAFE,
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/unknown singleton|unexpected storage/)
  }, 15_000)

  it('rejects an EOA / no contract', async () => {
    const r = await checkSafeBytecode({
      rpcUrl: RPC,
      safeAddress: NOT_DEPLOYED,
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/no contract deployed/)
  }, 15_000)

  it('honors expectedSingleton override (mismatch)', async () => {
    const r = await checkSafeBytecode({
      rpcUrl: RPC,
      safeAddress: SAFE_V13_USER_DEPLOY,
      expectedSingleton: '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762', // v1.4.1
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/proxy points at .* expected/)
  }, 15_000)
})
