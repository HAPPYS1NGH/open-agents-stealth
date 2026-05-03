import { describe, expect, it } from 'vitest'
import {
  deriveStealthKeysFromSignatureBrowser,
  STEALTH_DERIVATION_MESSAGE,
} from '@/lib/stealth-derive-client'

const FAKE_SIG = '0x' + 'aa'.repeat(64) + '1b'

describe('STEALTH_DERIVATION_MESSAGE re-export', () => {
  it('matches the Plan 3 / Plan 4 fixed message', () => {
    expect(STEALTH_DERIVATION_MESSAGE).toBe(
      'gabhru.eth: derive stealth keys for agent on Base mainnet (v1)',
    )
  })
})

describe('deriveStealthKeysFromSignatureBrowser', () => {
  it('returns the full triple', () => {
    const out = deriveStealthKeysFromSignatureBrowser(FAKE_SIG as `0x${string}`)
    expect(out.spendPrivKey).toMatch(/^0x[0-9a-f]{64}$/)
    expect(out.viewPrivKey).toMatch(/^0x[0-9a-f]{64}$/)
    expect(out.stealthMetaAddress).toMatch(/^0x[0-9a-f]{132}$/)
  })

  it('is deterministic per signature', () => {
    const a = deriveStealthKeysFromSignatureBrowser(FAKE_SIG as `0x${string}`)
    const b = deriveStealthKeysFromSignatureBrowser(FAKE_SIG as `0x${string}`)
    expect(a).toEqual(b)
  })

  it('throws on a too-short signature', () => {
    expect(() =>
      deriveStealthKeysFromSignatureBrowser('0xdeadbeef' as `0x${string}`),
    ).toThrow()
  })
})
