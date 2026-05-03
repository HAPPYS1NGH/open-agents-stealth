import { describe, expect, it } from 'vitest'
import {
  predictStealthSafeAddress,
  SAFE_PROXY_CREATION_CODE_V1_3_0,
} from '../src/stealth-safe-predict.js'

describe('predictStealthSafeAddress', () => {
  it('returns a deterministic Safe address for a given stealth EOA', () => {
    const eoa = '0x1234567890AbcdEF1234567890aBcdef12345678' as const
    const safe1 = predictStealthSafeAddress(eoa)
    const safe2 = predictStealthSafeAddress(eoa)
    expect(safe1).toBe(safe2)
    expect(safe1).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })

  it('returns different addresses for different stealth EOAs', () => {
    const a = predictStealthSafeAddress('0x1111111111111111111111111111111111111111')
    const b = predictStealthSafeAddress('0x2222222222222222222222222222222222222222')
    expect(a).not.toBe(b)
  })

  it('returns different addresses on different chains', () => {
    const eoa = '0x1234567890AbcdEF1234567890aBcdef12345678' as const
    const onBase = predictStealthSafeAddress(eoa, { chainId: 8453 })
    const onMainnet = predictStealthSafeAddress(eoa, { chainId: 1 })
    expect(onBase).not.toBe(onMainnet)
  })

  it('throws on a malformed EOA', () => {
    expect(() => predictStealthSafeAddress('0xdeadbeef' as `0x${string}`)).toThrow(/20-byte hex/)
    expect(() => predictStealthSafeAddress('not-an-address' as `0x${string}`)).toThrow()
  })

  it('embedded creation bytecode is 486 bytes (matches Base mainnet factory)', () => {
    const len = (SAFE_PROXY_CREATION_CODE_V1_3_0.length - 2) / 2
    expect(len).toBe(486)
    expect(SAFE_PROXY_CREATION_CODE_V1_3_0.startsWith('0x60806040523480156100')).toBe(true)
  })
})
