import { describe, expect, it } from 'vitest'
import { deriveViewKeyStub, STEALTH_DERIVATION_MESSAGE } from '@/lib/stealth-stub'

describe('STEALTH_DERIVATION_MESSAGE (re-exported from @open-agents/crypto)', () => {
  it('still matches the canonical string', () => {
    expect(STEALTH_DERIVATION_MESSAGE).toBe(
      'gabhru.eth: derive stealth keys for agent on Base mainnet (v1)',
    )
  })
})

describe('deriveViewKeyStub — deprecated in Plan 4', () => {
  it('throws to surface accidental imports', () => {
    expect(() => deriveViewKeyStub('0xdeadbeef')).toThrow(/deprecated/i)
  })
})
