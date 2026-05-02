import { describe, expect, it } from 'vitest'
import { deriveViewKeyStub, STEALTH_DERIVATION_MESSAGE } from '@/lib/stealth-stub'

describe('STEALTH_DERIVATION_MESSAGE', () => {
  it('matches the Plan 3 v1 derivation message', () => {
    expect(STEALTH_DERIVATION_MESSAGE).toBe(
      'gabhru.eth: derive stealth keys for agent on Base mainnet (v1)',
    )
  })
})

describe('deriveViewKeyStub', () => {
  it('returns a 32-byte hex string for any signature input', () => {
    const out = deriveViewKeyStub('0xdeadbeef')
    expect(out).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('is deterministic — same signature → same key', () => {
    const sig = '0x' + 'ab'.repeat(65)
    const a = deriveViewKeyStub(sig)
    const b = deriveViewKeyStub(sig)
    expect(a).toBe(b)
  })

  it('is signature-sensitive — different signatures → different keys', () => {
    const a = deriveViewKeyStub('0x' + 'ab'.repeat(65))
    const b = deriveViewKeyStub('0x' + 'cd'.repeat(65))
    expect(a).not.toBe(b)
  })

  it('throws on a non-hex input', () => {
    expect(() => deriveViewKeyStub('not-hex')).toThrow()
  })
})
